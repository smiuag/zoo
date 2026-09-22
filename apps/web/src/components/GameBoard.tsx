import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  effectiveMarketCost,
  getActivePlayer,
  getCard,
  hasCoinAtLeast,
  hasUpgradableCoin,
  scoreCardContributions,
  type Action,
  type CardInstance,
  type GameState,
  type Player,
  type PlayerScore,
} from '@zoo/engine';
import { ActivePlayerBoard, useActivePlayerMoney } from './ActivePlayerBoard';
import { CardView } from './CardView';
import { FlyingCard, type FlightSpec } from './FlyingCard';
import {
  buyAnimalActionFor,
  buyCoinActionFor,
  playCardActionsFor,
  resolveDiscardActionFor,
  useDiscardedAnimalAbilityActionsFor,
} from '../lib/actionQuery';
import { BOT_ALGORITHM_OPTIONS, displayName } from '../lib/botAlgorithms';
import { buildTargetChoice, type PendingChoice } from '../lib/pendingChoice';
import { currencyLabel, useArtStyle } from '../lib/artStyle';
import type { BotAlgorithm } from '../lib/gameConfig';
import type { ReplayStatus } from '../online/protocol';

// Cuántas rondas del final se consideran "recta final" (contador de ronda
// en rojo, ver .status-pill__round--final).
const FINAL_ROUNDS_WARNING = 5;

const PURCHASABLE_COIN_IDS = ['coin-2', 'coin-3', 'coin-5'];

// "Repetir partida" (botón en el resumen de fin de partida, ver más abajo):
// 'local' (pase-y-juega en este mismo dispositivo, o solitario contra
// bots) reinicia con un solo clic — todos los humanos ya están delante de
// la misma pantalla, pedido explícito del usuario ("un solo clic vale").
// 'online' necesita el acuerdo real de cada humano por separado, en su
// propio dispositivo — ver ReplayStatus en online/protocol.ts, mantenido
// por el host (useHostRoom.ts) y repartido a todos en cada StateSyncMessage.
export type ReplayProps =
  | { mode: 'local'; onReplay: () => void }
  | {
      mode: 'online';
      status: ReplayStatus | null;
      viewerSeatId: string;
      // false si algún invitado humano ha cerrado la pestaña o perdido la
      // conexión (ver useHostRoom.ts) — proponer o aceptar repetir con
      // alguien desconectado no serviría de nada, así que el botón lo refleja
      // en vez de fallar en silencio al pulsarlo.
      allGuestsConnected: boolean;
      onPropose: () => void;
      onRespond: (accept: boolean) => void;
    };

export interface GameBoardProps {
  state: GameState;
  humanIds: string[];
  // Qué asiento es "el mío" en esta pantalla: pase-y-juega local lo va
  // recalculando (el humano activo, con memoria del último mientras juegan
  // los bots — ver App.tsx); online (host o invitado) es siempre el mismo
  // asiento fijo durante toda la partida.
  viewerPlayerId: string;
  legalActions: Action[];
  scores: PlayerScore[];
  botAlgorithms: Record<string, BotAlgorithm>;
  // Decidido al crear la partida (ver GameConfig): con esto desactivado no
  // se genera la animación de "vuelo" de compra (ver FlyingCard.tsx) — el
  // ritmo de 1s entre acciones de los bots se controla aparte, en
  // useGame.ts, con el mismo valor.
  animationsEnabled: boolean;
  canRestartTurn: boolean;
  // Ver turnRestartCount en useGame.ts: se pasa tal cual a useActivePlayerMoney
  // (aquí y en ActivePlayerBoard) para que "reiniciar turno" también
  // reinicie el general acumulado, no solo el disponible actual.
  turnRestartCount: number;
  doAction: (action: Action) => void;
  // Ausentes = ocultan el control correspondiente: online no ofrece
  // reiniciar turno (no hay foto local que restaurar) ni cambiar el
  // algoritmo de un bot desde una pestaña invitada.
  onNewGame?: () => void;
  onRestartTurn?: () => void;
  onSetBotAlgorithm?: (botId: string, algorithm: BotAlgorithm) => void;
  // Ausente = sin botón de "Repetir partida" (no debería pasar en el flujo
  // normal, pero por si acaso — ver App.tsx/GuestApp.tsx, que siempre lo
  // pasan).
  replay?: ReplayProps;
}

export function GameBoard({
  state,
  humanIds,
  viewerPlayerId,
  legalActions,
  scores,
  botAlgorithms,
  animationsEnabled,
  canRestartTurn,
  turnRestartCount,
  doAction,
  onNewGame,
  onRestartTurn,
  onSetBotAlgorithm,
  replay,
}: GameBoardProps) {
  const activePlayer = getActivePlayer(state);
  // Mismo cálculo que ActivePlayerBoard (comparten el hook): aquí solo hace
  // falta la cifra, para la barra inferior de más abajo — ver .bottom-bar
  // en styles.css.
  const { purchasingPower, peak: purchasingPowerPeak } = useActivePlayerMoney(state, turnRestartCount);
  const human = state.players.find((p) => p.id === viewerPlayerId) ?? state.players[0];
  const bots = state.players.filter((p) => !humanIds.includes(p.id));
  // Para una carta del MERCADO (todavía no es tuya): cuánto valdría YA
  // MISMO si la compraras ahora — se simula añadiéndola a una copia de tu
  // colección actual (scoreCardContributions no muta nada) y se lee su
  // propia entrada. Así, si ya tienes 2 Águilas y hay una 3ª en el
  // mercado, el paréntesis cuenta las 3 juntas, no la 3ª aislada.
  function marketCardPreviewPoints(card: CardInstance): number {
    const preview = { ...human, hand: [...human.hand, card] };
    return scoreCardContributions(preview).get(card.instanceId) ?? card.victoryPoints;
  }
  // Coste real de comprarla YA MISMO (ver effectiveMarketCost en el motor):
  // a diferencia de marketCardPreviewPoints (que mira TU propia colección,
  // tenga sentido o no en un momento dado), el descuento por dinosaurio
  // solo lo puede gastar quien de verdad puede comprar ahora mismo — así
  // que se calcula para activePlayer (de quien es el turno), no para
  // human (quien mira la pantalla).
  function marketCardLiveCost(card: CardInstance): number {
    return effectiveMarketCost(activePlayer, card);
  }
  const scoreFor = (playerId: string) => scores.find((s) => s.playerId === playerId)?.score ?? 0;
  // En el marcador de arriba, un bot se identifica por el código corto de su
  // algoritmo (ES/TT/AI/FO/...) en vez de su nombre corto interno (B1, B2...
  // ver useGame.ts): así se ve de un vistazo qué juega cada uno sin tener
  // que bajar al panel "Bots". Los humanos siguen mostrando su nombre/nick.
  function scoreboardName(p: Player): string {
    return displayName(p, humanIds, botAlgorithms);
  }

  // legalActions siempre son LAS DE ESTE VISOR concreto (ver App.tsx/
  // GuestApp.tsx): si tiene alguna, puede actuar ahora mismo, sea porque es
  // su turno o porque le toca resolver un descarte forzoso pendiente (ver
  // PendingDiscardDecision) aunque no tenga el turno. Nunca hay una mezcla
  // de ambos tipos de acción a la vez (ver el motor: un descarte pendiente
  // deja sin ninguna acción normal al jugador activo).
  const canAct = legalActions.length > 0;
  const owedDiscard = state.pendingDecision?.owed[viewerPlayerId];
  // kind 'destroy': la carta elegida se elimina de la partida para siempre
  // (sin ninguna carta que lo use ahora mismo, ver scorePerDestroyedCard en
  // effects/registry.ts — se deja el mecanismo por si vuelve a hacer
  // falta). kind 'giveToPlayer' (Pato): pasa a la mano de quien jugó la
  // carta — en ambos casos solo cambia el texto mostrado, la mecánica de
  // elegir es idéntica al descarte forzoso normal.
  const isDestroy = state.pendingDecision?.kind === 'destroy';
  const isGiveToPlayer = state.pendingDecision?.kind === 'giveToPlayer';
  const discardVerb = isDestroy ? 'Elimina' : isGiveToPlayer ? 'Entrega' : 'Descarta';
  // Cartas de tu propia mano que puedes elegir ahora mismo para el
  // descarte pendiente (se muestran en el popup de abajo): se derivan de
  // legalActions, nunca de owedDiscard.eligibleInstanceIds directamente,
  // para que sea SIEMPRE justo lo que de verdad se puede pulsar.
  // También las de tu MESA (animales dejados ahí con el Perro/Gallina/
  // Colibrí, ver player.table): "cada oponente elimina un animal..." las
  // alcanza igual que a las de la mano. Antes solo se miraba la mano, y si la
  // ÚNICA elegible estaba sobre la mesa este aviso salía sin ninguna carta
  // que pulsar y sin forma de cerrarlo — la partida se quedaba bloqueada
  // (reportado por el usuario 2026-09-21, con un Pteranodon rival).
  const tableInstanceIds = new Set((human.table ?? []).map((c) => c.instanceId));
  const eligibleDiscardCards = owedDiscard
    ? [...human.hand, ...(human.table ?? [])].filter((c) => resolveDiscardActionFor(legalActions, c.instanceId))
    : [];
  const eligibleOnTable = eligibleDiscardCards.filter((c) => tableInstanceIds.has(c.instanceId));
  const eligibleOnlyOnTable = eligibleDiscardCards.length > 0 && eligibleOnTable.length === eligibleDiscardCards.length;
  // Perezoso: si aparece entre las elegibles, descartarlo cubre TODA la
  // entrega él solo (ver resolveDiscard en el motor) — se avisa en el modal
  // porque si no, no es evidente que sustituya a las demás en vez de contar
  // como 1 carta más.
  const hasSlothSubstitute = eligibleDiscardCards.some((c) => c.id === 'sloth');
  const discardSourcePlayerName = state.pendingDecision
    ? (state.players.find((p) => p.id === state.pendingDecision!.sourcePlayerId)?.name ?? '')
    : '';
  // Serpiente: si el visor es quien la jugó y toca elegir qué habilidad
  // usar (ver pendingAnimalAbilityChoice en el motor), resuelve cada
  // candidato a su CardInstance real allá donde esté (siguen en el
  // descarte de quien los entregó, puede ser cualquier jugador) para
  // poder mostrarlos con CardView en el popup de abajo.
  const animalAbilityChoice =
    state.pendingAnimalAbilityChoice?.sourcePlayerId === viewerPlayerId ? state.pendingAnimalAbilityChoice : undefined;
  const animalAbilityCandidates = animalAbilityChoice
    ? animalAbilityChoice.candidateInstanceIds
        .map((id) => state.players.flatMap((p) => p.discard).find((c) => c.instanceId === id))
        .filter((c): c is CardInstance => Boolean(c))
    : [];
  // Si el visor tiene el turno ahora mismo: decide dónde se ven el
  // mazo/descarte del jugador activo (que en ese caso es el propio visor) y
  // si tiene sentido mostrar los controles de turno (Terminar/Reiniciar) —
  // ver más abajo y ActivePlayerBoard.tsx.
  const isOwnTurn = activePlayer.id === viewerPlayerId;

  // --- Animación "vuelo" de compra: mercado -> descarte ------------------
  // Recuerda la última posición en pantalla de cada carta del mercado
  // mientras siga montada (ref-callback en cada render): al desaparecer
  // (comprada), esa última posición conocida se queda un instante en el
  // mapa, justo lo que hace falta para saber "de dónde viene volando".
  const marketRectsRef = useRef<Map<string, DOMRect>>(new Map());
  const discardPileRef = useRef<HTMLDivElement>(null);
  // Tras comprar NO se toca el scroll (ni en móvil ni en escritorio): hubo
  // un scrollIntoView automático al mercado / a "Terminar turno" después de
  // cada compra y el usuario lo quitó del todo el 2026-09-22 ("se pone a
  // bailar, sube y baja y redimensiona sin sentido"). El único scroll
  // automático que queda en la partida es el del panel de elección
  // (pendingChoice, más abajo), que solo aparece al jugar una carta con
  // opciones.
  const [flights, setFlights] = useState<FlightSpec[]>([]);
  // Vuelos que ya "han aterrizado" de verdad (ver settleFlight/onSettle más
  // abajo) pero cuyo fantasma sigue en pantalla desvaneciéndose: sin esto,
  // hiddenDiscardCount seguía contando el vuelo entero hasta que el
  // fantasma terminaba de desvanecerse del todo (onTransitionEnd), así que
  // durante esos últimos ~350ms el fantasma se iba haciendo transparente
  // sobre la pila de descarte de VERDAD, que todavía mostraba la carta
  // ANTERIOR debajo — un parpadeo visible de "vuelve la carta vieja, luego
  // reaparece la nueva de golpe". Al asentarse en cuanto empieza a
  // desvanecerse (no cuando termina), la pila real ya enseña la carta
  // nueva ANTES de que el fantasma se vuelva transparente, así que debajo
  // del fantasma desvaneciéndose siempre hay la misma carta.
  const [settledFlightKeys, setSettledFlightKeys] = useState<Set<string>>(new Set());
  // Qué instanceId había en el descarte del jugador ACTIVO la última vez
  // (y de quién): para detectar cuáles son nuevos de un render a otro sin
  // comparar entre turnos de jugadores distintos.
  const prevActiveDiscardRef = useRef<{ playerId: string; ids: Set<string> } | null>(null);

  // useLayoutEffect (no useEffect): tiene que registrar el vuelo ANTES de
  // que el navegador pinte, para que el descarte de verdad nunca llegue a
  // mostrarse ni un solo fotograma antes de que el fantasma "llegue" (ver
  // hiddenCount en PlayerPiles.tsx) — con useEffect normal (que se dispara
  // DESPUÉS de pintar) se veía un parpadeo de un fotograma con la carta ya
  // puesta antes de ocultarse de nuevo.
  useLayoutEffect(() => {
    if (!animationsEnabled) return;
    const prev = prevActiveDiscardRef.current;
    if (prev && prev.playerId === activePlayer.id) {
      const newlyDiscarded = activePlayer.discard.filter((c) => !prev.ids.has(c.instanceId));
      if (newlyDiscarded.length > 0 && discardPileRef.current) {
        const toRect = discardPileRef.current.getBoundingClientRect();
        const toCenter = { x: toRect.left + toRect.width / 2, y: toRect.top + toRect.height / 2 };
        const newFlights: FlightSpec[] = [];
        for (const card of newlyDiscarded) {
          // Solo si de verdad la vimos hace un instante en el mercado (p.
          // ej. un descarte forzoso que aterriza en el descarte no debe
          // "volar" desde ningún sitio): sin posición conocida, sin animación.
          const fromRect = marketRectsRef.current.get(card.instanceId);
          if (!fromRect) continue;
          newFlights.push({
            key: `${card.instanceId}-${activePlayer.discard.length}`,
            card,
            toPlayerId: activePlayer.id,
            fromCenter: { x: fromRect.left + fromRect.width / 2, y: fromRect.top + fromRect.height / 2 },
            toCenter,
          });
        }
        if (newFlights.length > 0) setFlights((f) => [...f, ...newFlights]);
      }
    }
    prevActiveDiscardRef.current = { playerId: activePlayer.id, ids: new Set(activePlayer.discard.map((c) => c.instanceId)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlayer.id, activePlayer.discard.length]);

  function settleFlight(key: string) {
    setSettledFlightKeys((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }

  function removeFlight(key: string) {
    setFlights((f) => f.filter((fl) => fl.key !== key));
    setSettledFlightKeys((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }

  // Mientras la partida sigue en curso, el mazo de CUALQUIER otro jugador
  // —humano o bot— es información privada: solo se puede "ver el mazo"
  // del propio jugador que mira esta pantalla, o de cualquiera una vez
  // terminada la partida (el resumen final es público a propósito). Antes
  // los bots eran "libro abierto" en todo momento; se quitó esa excepción
  // a petición del usuario ("no se debe poder ver nunca ningún mazo salvo
  // el tuyo, salvo al final de la partida").
  function canViewPlayer(p: Player): boolean {
    return state.gameOver || p.id === viewerPlayerId;
  }
  const sortedByCost = [...state.animalTrack].sort(
    (a, b) => (a.marketCost ?? 0) - (b.marketCost ?? 0) || a.name.localeCompare(b.name)
  );

  // Solo para decidir si los menús de elección y el resumen final dicen
  // "bellota" o "moneda" (ver currencyLabel/bellotaText.ts) — puramente de
  // presentación, no afecta a ninguna acción real.
  const [artStyle] = useArtStyle();
  const [pendingChoice, setPendingChoice] = useState<PendingChoice | null>(null);
  const [viewedPlayerId, setViewedPlayerId] = useState<string | null>(null);
  const [confirmEndTurn, setConfirmEndTurn] = useState(false);
  // Solo lo usa replay?.mode === 'local': un clic en "Repetir partida" abre
  // esta confirmación de un solo paso (nadie más que confirmar, ver
  // ReplayProps arriba) antes de llamar a replay.onReplay().
  const [confirmLocalReplay, setConfirmLocalReplay] = useState(false);
  // Misma frontera que ".bottom-bar" en styles.css (@media max-width:860px):
  // decide en JS (no solo CSS) qué contenido monta la barra inferior, para
  // no duplicar el botón "Terminar turno" dos veces
  // en el DOM a la vez — pedido explícito del usuario 2026-09-21: en
  // pantalla grande la barra reúne también el marcador y la ronda
  // (eliminando el panel de arriba que los mostraba aparte); en móvil se
  // queda tal cual estaba.
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 861px)').matches);
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 861px)');
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);
  // En móvil el mercado queda justo ENCIMA de la mesa y la mano (ver el
  // orden de paneles en styles.css, @media max-width:860px), y se lee de
  // abajo arriba: las baratas al final, pegadas a la mesa, y las caras
  // arriba — pedido explícito del usuario 2026-09-22 ("el mercado también
  // cambiado de orden"). En escritorio, de más barata a más cara como
  // siempre.
  const sortedAnimalTrack = isDesktop ? sortedByCost : sortedByCost.reverse();
  const choiceRef = useRef<HTMLDivElement>(null);
  const viewedPlayer = state.players.find((p) => p.id === viewedPlayerId) ?? null;
  // Terminar turno "a lo tonto" (con animales por jugar o monedas por
  // gastar en la mano) normalmente es un despiste, no algo querido — pero
  // solo cuando de verdad queda algo QUE HACER, no por cualquier carta que
  // siga en la mano:
  // - Un animal sin ningún efecto (Perezoso, Pez de colores, Periquito: solo
  //   suman a la colección/PV, sin acción alguna al jugarlos) nunca cuenta
  //   como "pendiente" — jugarlo o no antes de terminar el turno da igual.
  // - La Tortuga (único efecto: subir de nivel una moneda) tampoco cuenta si
  //   no hay ninguna moneda subible en la mano: jugarla no haría nada. Mismo
  //   trato para el Cerdo/Nutria (descartan una moneda de cierto valor
  //   mínimo) y el Pez Dorado (descarta cualquiera): sin ninguna moneda que
  //   llegue al mínimo exigido, jugarlas no hace nada.
  // - Las monedas en mano solo cuentan si con lo que hay ahora mismo se
  //   podría comprar algo de verdad (mirando legalActions): si no llegan
  //   para nada, avisar no sirve de nada — ese dinero se pierde igual al
  //   pasar el turno, se avise o no.
  const COIN_GATED_EFFECT_TYPES = new Set([
    'discardCoinMinValueToDrawCards',
    'discardCoinMinValueToPeekAndKeep',
    'exchangeCoinForFixed',
  ]);
  function isUselessToPlay(card: CardInstance): boolean {
    if (card.type !== 'animal') return false;
    if (card.effects.length === 0) return true;
    if (card.effects.length === 1 && card.effects[0].type === 'upgradeCoin') return !hasUpgradableCoin(human);
    if (card.effects.length === 1 && COIN_GATED_EFFECT_TYPES.has(card.effects[0].type)) {
      const minValue = typeof card.effects[0].params?.minValue === 'number' ? card.effects[0].params.minValue : 0;
      return !hasCoinAtLeast(human, minValue);
    }
    return false;
  }
  const hasUnplayedAnimals = human.hand.some((c) => c.type === 'animal' && !isUselessToPlay(c));
  const hasSpendableCoins =
    human.hand.some((c) => c.type === 'coin') &&
    legalActions.some((a) => a.type === 'buyAnimal' || a.type === 'buyCoin');
  const hasUnusedTurnActions = hasUnplayedAnimals || hasSpendableCoins;

  useEffect(() => {
    setPendingChoice(null);
    setViewedPlayerId(null);
    setConfirmEndTurn(false);
  }, [state.turn]);

  useEffect(() => {
    if (pendingChoice) choiceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [pendingChoice]);

  // Terminar turno: en móvil, además, baja del todo para dejar a la vista
  // la mesa (justo encima de la mano fija) — pedido explícito del usuario
  // 2026-09-22; es el ÚNICO scroll automático ligado a una acción de
  // partida (el de después de comprar se quitó ese mismo día). Un instante
  // después de la acción, para que la página ya tenga su altura nueva.
  function endTurn() {
    runAction(legalActions.find((a) => a.type === 'endTurn'));
    if (isDesktop) return;
    window.setTimeout(() => {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
    }, 60);
  }

  function runAction(action: Action | undefined) {
    if (!action) return;
    doAction(action);
    setPendingChoice(null);
  }

  function chooseOption(option: { action?: Action; next?: PendingChoice }) {
    if (option.next) {
      setPendingChoice(option.next);
      return;
    }
    runAction(option.action);
  }

  function handleRestartTurn() {
    onRestartTurn?.();
    setPendingChoice(null);
  }

  function handleHandCardClick(card: CardInstance) {
    // Un descarte forzoso pendiente tiene prioridad y aplica a CUALQUIER
    // tipo de carta, monedas incluidas (p. ej. el Buitre deja elegir
    // cualquier carta de la mano) — se comprueba antes que nada, ni
    // siquiera el "las monedas nunca se juegan" de abajo debe bloquearlo.
    const discardAction = resolveDiscardActionFor(legalActions, card.instanceId);
    if (discardAction) {
      runAction(discardAction);
      return;
    }

    if (card.type === 'coin') return; // las monedas nunca se JUEGAN: se gastan solas al pagar

    const acts = playCardActionsFor(legalActions, card.instanceId);
    if (acts.length === 0) return;
    if (acts.length === 1) {
      runAction(acts[0]);
      return;
    }
    setPendingChoice(buildTargetChoice(acts, state, human, card, artStyle));
  }

  // Serpiente: elegir uno de los animales recién descartados por "cada
  // jugador" para usar su habilidad. Igual que handleHandCardClick, salvo
  // que aquí SIEMPRE hay alguna variante (el modal no se abre si no la
  // hubiera) — si la habilidad no necesita elegir nada (la mayoría) solo hay
  // 1 y se aplica directa; si necesita objetivo(s) (Elefante/Araña/Jirafa/
  // Murciélago, Flamenco, Tigre) abre el mismo menú contextual que jugar la
  // carta de verdad.
  function handleAnimalAbilityCandidateClick(card: CardInstance) {
    const acts = useDiscardedAnimalAbilityActionsFor(legalActions, card.instanceId);
    if (acts.length === 0) return;
    if (acts.length === 1) {
      runAction(acts[0]);
      return;
    }
    setPendingChoice(buildTargetChoice(acts, state, human, card, artStyle));
  }

  function isHandCardClickable(card: CardInstance): boolean {
    if (resolveDiscardActionFor(legalActions, card.instanceId)) return true;
    if (card.type === 'coin') return false;
    return playCardActionsFor(legalActions, card.instanceId).length > 0;
  }

  function handleMarketCardClick(card: CardInstance) {
    runAction(buyAnimalActionFor(legalActions, card.instanceId));
  }

  function isMarketCardClickable(card: CardInstance): boolean {
    return Boolean(buyAnimalActionFor(legalActions, card.instanceId));
  }

  function handleBuyCoinClick(coinId: string) {
    runAction(buyCoinActionFor(legalActions, coinId));
  }

  function isCoinShopClickable(coinId: string): boolean {
    return Boolean(buyCoinActionFor(legalActions, coinId));
  }

  function groupedCollection(
    player: (typeof state.players)[number]
  ): { card: CardInstance; count: number; perCardPoints: number[] }[] {
    const all = [...player.deck, ...player.hand, ...player.discard, ...player.playedThisTurn, ...(player.table ?? [])];
    const contributions = scoreCardContributions(player);
    const byId = new Map<string, { card: CardInstance; count: number; perCardPoints: number[] }>();
    for (const card of all) {
      const points = contributions.get(card.instanceId) ?? 0;
      const entry = byId.get(card.id);
      if (entry) {
        entry.count += 1;
        entry.perCardPoints.push(points);
      } else {
        byId.set(card.id, { card, count: 1, perCardPoints: [points] });
      }
    }
    return [...byId.values()].sort(
      (a, b) => (a.card.marketCost ?? 0) - (b.card.marketCost ?? 0) || a.card.name.localeCompare(b.card.name)
    );
  }

  function groupedDestroyed(player: (typeof state.players)[number]): { card: CardInstance; count: number }[] {
    const byId = new Map<string, { card: CardInstance; count: number }>();
    for (const card of player.destroyedCards) {
      const entry = byId.get(card.id);
      if (entry) entry.count += 1;
      else byId.set(card.id, { card, count: 1 });
    }
    return [...byId.values()].sort(
      (a, b) => (a.card.marketCost ?? 0) - (b.card.marketCost ?? 0) || a.card.name.localeCompare(b.card.name)
    );
  }

  function pointsLabel(count: number, perCardPoints: number[]): string {
    const [first, ...rest] = perCardPoints;
    const allEqual = rest.every((p) => p === first);
    if (count > 1 && allEqual) return `${count}× ${first} PV`;
    const total = perCardPoints.reduce((sum, p) => sum + p, 0);
    return `${total} PV`;
  }

  function habitatCounts(player: (typeof state.players)[number]): { land: number; bird: number; aquatic: number } {
    const all = [...player.deck, ...player.hand, ...player.discard, ...player.playedThisTurn, ...(player.table ?? [])].filter(
      (c) => c.type === 'animal'
    );
    return {
      land: all.filter((c) => c.habitats?.includes('land')).length,
      bird: all.filter((c) => c.habitats?.includes('bird')).length,
      aquatic: all.filter((c) => c.habitats?.includes('aquatic')).length,
    };
  }

  function deckValue(player: (typeof state.players)[number]): number {
    return [...player.deck, ...player.hand, ...player.discard, ...player.playedThisTurn, ...(player.table ?? [])].reduce(
      (sum, c) => sum + (c.marketCost ?? 0),
      0
    );
  }

  // Compartido entre el panel de arriba (móvil) y la barra inferior
  // (escritorio, ver el comentario junto a isDesktop más arriba) — misma
  // lógica, dos sitios distintos donde puede aparecer.
  function renderStatusPill() {
    if (state.gameOver) {
      return <span className="status-pill status-pill--over">Partida terminada</span>;
    }
    if (owedDiscard) {
      return (
        <span className="status-pill status-pill--discard">
          {discardVerb} {owedDiscard.amount} carta{owedDiscard.amount === 1 ? '' : 's'} — {state.pendingDecision!.sourceCardName}
        </span>
      );
    }
    return (
      <span className="status-pill">
        {/* Recta final: el contador de ronda pasa a rojo en las 5 últimas
            rondas, para que se vea de un vistazo que la partida se acaba (y
            compense ya comprar PV en vez de economía). */}
        <span
          className={
            state.maxRounds != null && state.round > state.maxRounds - FINAL_ROUNDS_WARNING
              ? 'status-pill__round status-pill__round--final'
              : 'status-pill__round'
          }
        >
          Ronda {state.round}/{state.maxRounds ?? '∞'}
        </span>{' '}
        {canAct && ` — turno de ${displayName(activePlayer, humanIds, botAlgorithms)}`}
      </span>
    );
  }

  // Barra de escritorio: el marcador va en medio, entre el dinero y
  // ronda/"Nueva partida", SOLO si cabe entero en una línea. Si no (muchos
  // jugadores, ventana estrecha), baja a una segunda fila propia, en
  // horizontal, debajo de ronda/"Nueva partida" — pedido explícito del
  // usuario 2026-09-21; antes se partía en varias líneas dentro del hueco
  // central. Hay que medirlo: CSS solo no sabe "si no cabe, que baje ESTE
  // elemento y no el último". Se mide el ancho natural de cada hijo (no el
  // del <ul>, que ya está encogido por el propio layout).
  const barMidRef = useRef<HTMLDivElement>(null);
  const [scoreboardBelow, setScoreboardBelow] = useState(false);
  useLayoutEffect(() => {
    const mid = barMidRef.current;
    if (!mid) return;
    const measure = () => {
      const list = mid.querySelector<HTMLElement>('.scoreboard');
      if (!list) return;
      const gapOf = (el: Element) => parseFloat(getComputedStyle(el).columnGap) || 0;
      const items = Array.from(list.children) as HTMLElement[];
      const scoreboardWidth = items.reduce((sum, li) => sum + li.offsetWidth, 0) + gapOf(list) * Math.max(0, items.length - 1);
      const others = (Array.from(mid.children) as HTMLElement[]).filter((el) => !el.classList.contains('bottom-bar__scoreboard'));
      const othersWidth = others.reduce((sum, el) => sum + el.offsetWidth, 0);
      const needed = scoreboardWidth + othersWidth + gapOf(mid) * others.length;
      setScoreboardBelow(needed > mid.clientWidth);
    };
    measure();
    // Solo se vuelve a medir cuando cambia el ANCHO del hueco (ventana
    // redimensionada), nunca por un cambio de solo altura: bajar/subir el
    // marcador cambia la altura de este mismo elemento, y si eso volviera a
    // disparar la medición se podría entrar en un bucle barra-alta /
    // barra-baja (la página "bailando" arriba y abajo). Y comparar contra la
    // última decisión evita re-renders inútiles aunque el ancho sea el mismo.
    let lastWidth = mid.clientWidth;
    const observer = new ResizeObserver(() => {
      if (mid.clientWidth === lastWidth) return;
      lastWidth = mid.clientWidth;
      measure();
    });
    observer.observe(mid);
    return () => observer.disconnect();
  });

  function renderScoreboard() {
    return (
      <ul className="scoreboard">
        {state.players.map((p) => {
          const clickable = canViewPlayer(p);
          return (
            <li
              key={p.id}
              className={[
                p.id === viewerPlayerId && 'scoreboard__me',
                p.id === activePlayer.id && 'scoreboard__active-turn',
                clickable && 'scoreboard__clickable',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={clickable ? () => setViewedPlayerId(p.id) : undefined}
              title={`${p.name}${humanIds.includes(p.id) ? '' : ` (${BOT_ALGORITHM_OPTIONS.find((o) => o.value === botAlgorithms[p.id])?.label ?? ''})`}: ${scoreFor(p.id)} PV${clickable ? ' · ver mazo' : ' · mazo privado hasta que termine la partida'}`}
            >
              <strong>{scoreboardName(p)}</strong>
              <span className="scoreboard__pv">
                {scoreFor(p.id)}
                <small>PV</small>
              </span>
            </li>
          );
        })}
      </ul>
    );
  }

  // Muelle fijo de móvil (mano + barra de turno, ver el JSX de más abajo):
  // su altura cambia (mano con 5 o más cartas, barra de una o dos filas,
  // sin barra al acabar la partida), así que se mide y se publica como
  // --dock-h en <html>: .app reserva ese hueco abajo (para poder hacer
  // scroll hasta el final del mercado sin que el muelle lo tape) y
  // scroll-padding-bottom hace que un scrollIntoView (panel de elección)
  // no lo deje escondido detrás. En escritorio no hay muelle y se limpia.
  const dockRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const dock = dockRef.current;
    if (isDesktop || !dock) {
      root.style.removeProperty('--dock-h');
      return;
    }
    const apply = () => root.style.setProperty('--dock-h', `${dock.offsetHeight}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(dock);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--dock-h');
    };
  }, [isDesktop]);

  // Panel "Tu mano": en escritorio va en la columna izquierda, debajo de
  // la mesa; en móvil se monta dentro del muelle fijo de abajo (ver
  // dockRef / .mobile-dock), justo encima de la barra de turno.
  const handPanel = human.hand.length > 0 && (
    <div className="panel">
      <div className="panel__header">
        <h2>Tu mano</h2>
        <span className="panel__hint">
          🂠 {human.deck.length} en el mazo · 🗑️ {human.discard.length} en el descarte
          {(human.table?.length ?? 0) > 0 ? ` · 🐕 ${human.table.length} sobre la mesa` : ''}
        </span>
      </div>
      <div className="card-row card-row--hand">
        {human.hand.map((card) => (
          <CardView
            key={card.instanceId}
            card={card}
            // Sin nada que hacer ahora mismo (no es tu turno y no
            // debes ningún descarte), ninguna carta se marca
            // "disabled": ese aspecto semitransparente es para "esto
            // en concreto no se puede, aunque otras cosas sí" — no
            // para "ahora mismo no te toca nada", que no es un estado
            // roto, solo de espera. Las monedas, aparte, NUNCA se
            // marcan disabled ni en tu propio turno: no son "carta que
            // no se puede jugar ahora", son cartas que nunca se juegan
            // (se gastan solas al pagar) — deben verse normales
            // aunque no reaccionen al clic, salvo que un descarte
            // pendiente sí las haga elegibles.
            onClick={isHandCardClickable(card) ? () => handleHandCardClick(card) : undefined}
            disabled={canAct && card.type !== 'coin' && !isHandCardClickable(card)}
            hideType
          />
        ))}
      </div>
    </div>
  );

  return (
    <div className="app">
      {isDesktop ? (
        // En pantalla grande la barra reúne TODO lo de arriba a la vez
        // (acciones de turno, marcador y ronda) y sustituye por completo al
        // panel de más abajo que antes los mostraba aparte — pedido
        // explícito del usuario 2026-09-21: "terminar turno a la izquierda
        // del todo, a su derecha reiniciar turno y el dinero, en medio los
        // marcadores y a la derecha del todo la ronda (solo en pantalla
        // grande)". Por eso, a diferencia de la versión móvil de abajo, se
        // muestra SIEMPRE (incluso con la partida terminada): si no, el
        // marcador/ronda desaparecerían del todo en vez de quedarse en su
        // sitio de siempre.
        <div className="bottom-bar bottom-bar--desktop">
          {/* Misma plantilla de columnas que ".layout" de más abajo (ver
              styles.css), a propósito: pedido explícito del usuario
              2026-09-21, "que ocupen tanto como la zona de la izquierda de
              la mesa" — Terminar/Reiniciar turno se reparten a partes
              iguales TODO el ancho de esa columna, cuyo borde derecho coincide
              con el del panel de la mesa de debajo (ver --bar-inset en
              styles.css). */}
          <div className="bottom-bar__left">
            {!state.gameOver && isOwnTurn && (
              <>
                <button
                  className="btn btn--primary"
                  disabled={!legalActions.some((a) => a.type === 'endTurn')}
                  onClick={() => {
                    if (hasUnusedTurnActions) {
                      setConfirmEndTurn(true);
                      return;
                    }
                    endTurn();
                  }}
                >
                  Terminar turno
                </button>
                {onRestartTurn && (
                  <button className="btn btn--ghost" disabled={!canRestartTurn} onClick={handleRestartTurn}>
                    ↺ Reiniciar turno
                  </button>
                )}
              </>
            )}
          </div>
          <div ref={barMidRef} className={`bottom-bar__mid${scoreboardBelow ? ' bottom-bar__mid--stacked' : ''}`}>
            {/* Sin el dinero aquí (quitado a petición del usuario 2026-09-21): en
                pantalla grande ya se ve justo debajo, en "Valor de compra" del
                panel de la mesa. La barra de móvil sí lo conserva, porque allí
                ese panel queda fuera de la vista al bajar al mercado. */}
            <div className="bottom-bar__scoreboard">{renderScoreboard()}</div>
            <div className="bottom-bar__right">
              {renderStatusPill()}
              {onNewGame && (
                <button className="btn btn--ghost btn--new-game" onClick={onNewGame} title="Nueva partida">
                  ↺ <span className="btn__label">Nueva partida</span>
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        // Móvil: "muelle" fijo abajo del todo (.mobile-dock en styles.css)
        // con la mano justo ENCIMA de la barra de turno/dinero/acciones, de
        // modo que solo la mesa y el mercado hacen scroll — pedido explícito
        // del usuario 2026-09-22. Se monta siempre, aunque quede vacío, para
        // que la medición de su altura (--dock-h, ver dockRef arriba) siga
        // viva. El marcador y la ronda se quedan en el panel de siempre, más
        // abajo en el layout.
        <div className="mobile-dock" ref={dockRef}>
          {handPanel}
          {!state.gameOver && (
            <div className="bottom-bar">
              <span className="bottom-bar__turn">
                Ronda {state.round}/{state.maxRounds ?? '∞'}
                {!isOwnTurn && ` · turno de ${displayName(activePlayer, humanIds, botAlgorithms)}`}
              </span>
              <span
                className="bottom-bar__money"
                title={`Valor de compra de ${displayName(activePlayer, humanIds, botAlgorithms)}: ${purchasingPower} disponibles; ${purchasingPowerPeak} en total este turno contando lo ya gastado`}
              >
                💰 {purchasingPower}/{purchasingPowerPeak}
              </span>
              {isOwnTurn && (
                // Reiniciar a la izquierda y Terminar a la derecha (al revés
                // que en la barra de escritorio) — pedido explícito del
                // usuario 2026-09-22. En vertical los dos botones van solos en
                // su propia fila, al 50% cada uno (ver .bottom-bar__actions en
                // styles.css); en horizontal caben con el resto y quedan a su
                // tamaño natural.
                <div className="bottom-bar__actions">
                  {onRestartTurn && (
                    <button className="btn btn--ghost" disabled={!canRestartTurn} onClick={handleRestartTurn}>
                      ↺ Reiniciar turno
                    </button>
                  )}
                  <button
                    className="btn btn--primary"
                    disabled={!legalActions.some((a) => a.type === 'endTurn')}
                    onClick={() => {
                      if (hasUnusedTurnActions) {
                        setConfirmEndTurn(true);
                        return;
                      }
                      endTurn();
                    }}
                  >
                    Terminar turno
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {state.gameOver && (
        <div className="panel">
          <div className="panel__header">
            <h2>Resumen de la partida</h2>
          </div>
          <p>
            {(() => {
              const best = Math.max(...scores.map((s) => s.score));
              const winners = state.players.filter((p) => scoreFor(p.id) === best);
              return winners.length > 1
                ? `Empate entre ${winners.map((w) => scoreboardName(w)).join(' y ')} con ${best} PV.`
                : `${scoreboardName(winners[0])} gana con ${best} PV.`;
            })()}
          </p>
          <div className="summary-table-wrap">
            <table className="summary-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Jugador</th>
                  <th>PV</th>
                  <th>Valor baraja</th>
                  <th>Compras</th>
                  <th>Terrestres</th>
                  <th>Voladores</th>
                  <th>Acuáticos</th>
                  <th>Turno con más dinero</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {[...state.players]
                  .sort((a, b) => scoreFor(b.id) - scoreFor(a.id))
                  .map((p, index, ranked) => {
                    const habitats = habitatCounts(p);
                    // Solo cosmético, sin ninguna lógica de negocio detrás:
                    // el último de la tabla se lleva la broma EN VEZ de una
                    // medalla (así en partidas de 2-3 jugadores el "último"
                    // no se queda sin nada ni compite con un 2º/3º puesto
                    // que sí medalla de verdad).
                    const isLast = index === ranked.length - 1 && ranked.length > 1;
                    const badge = isLast ? '💩' : index === 0 ? '🏆' : index === 1 ? '🥈' : index === 2 ? '🥉' : '';
                    return (
                      <tr key={p.id}>
                        <td aria-hidden="true">{badge}</td>
                        <td>
                          <strong>{scoreboardName(p)}</strong>
                        </td>
                        <td>{scoreFor(p.id)}</td>
                        <td>{deckValue(p)}</td>
                        <td>{p.purchasesCount}</td>
                        <td>{habitats.land}</td>
                        <td>{habitats.bird}</td>
                        <td>{habitats.aquatic}</td>
                        <td>
                          {p.richestTurn
                            ? `Ronda ${p.richestTurn.round} · ${p.richestTurn.amount} ${currencyLabel(artStyle, p.richestTurn.amount)}`
                            : '—'}
                        </td>
                        <td>
                          <button className="btn btn--ghost" onClick={() => setViewedPlayerId(p.id)}>
                            Ver mazo →
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

          {replay && (
            <div className="replay-box">
              {replay.mode === 'local' ? (
                confirmLocalReplay ? (
                  <div className="replay-pending">
                    <span className="setup-hint">¿Repetir con la misma configuración?</span>
                    <button className="btn btn--ghost" onClick={() => setConfirmLocalReplay(false)}>
                      Cancelar
                    </button>
                    <button
                      className="btn btn--primary"
                      onClick={() => {
                        setConfirmLocalReplay(false);
                        replay.onReplay();
                      }}
                    >
                      Sí, repetir
                    </button>
                  </div>
                ) : (
                  <button className="btn btn--primary" onClick={() => setConfirmLocalReplay(true)}>
                    🔁 Repetir partida
                  </button>
                )
              ) : replay.status === null ? (
                <div className="replay-pending">
                  <button
                    className="btn btn--primary"
                    disabled={!replay.allGuestsConnected}
                    title={replay.allGuestsConnected ? undefined : 'Algún invitado se ha desconectado'}
                    onClick={replay.onPropose}
                  >
                    🔁 Repetir partida
                  </button>
                  {!replay.allGuestsConnected && (
                    <span className="setup-hint">Algún invitado se ha desconectado</span>
                  )}
                </div>
              ) : replay.status.acceptedSeatIds.includes(replay.viewerSeatId) ? (
                <div className="replay-pending">
                  <span className="setup-hint">
                    Esperando a los demás para repetir ({replay.status.acceptedSeatIds.length}/
                    {replay.status.totalHumanSeats})...
                  </span>
                  <button className="btn btn--ghost" onClick={() => replay.onRespond(false)}>
                    Cancelar
                  </button>
                </div>
              ) : (
                <div className="replay-pending">
                  <span className="setup-hint">
                    {replay.status.proposedByName} propone repetir la partida ({replay.status.acceptedSeatIds.length}/
                    {replay.status.totalHumanSeats} aceptado)
                  </span>
                  <button className="btn btn--ghost" onClick={() => replay.onRespond(false)}>
                    Rechazar
                  </button>
                  <button className="btn btn--primary" onClick={() => replay.onRespond(true)}>
                    Aceptar
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="layout">
        <div className="layout__left">
          {!isDesktop && (
            // En escritorio esto vive ahora en la barra de arriba (ver
            // isDesktop más arriba) — aquí se queda solo para móvil, igual
            // que siempre.
            <div className="panel panel--status">
              <div className="status-row">
                {renderStatusPill()}
                {onNewGame && (
                  <button className="btn btn--ghost btn--new-game" onClick={onNewGame} title="Nueva partida">
                    ↺ <span className="btn__label">Nueva partida</span>
                  </button>
                )}
              </div>

              {renderScoreboard()}
            </div>
          )}

          <ActivePlayerBoard
            state={state}
            turnRestartCount={turnRestartCount}
            humanIds={humanIds}
            botAlgorithms={botAlgorithms}
            discardPileRef={discardPileRef}
            hiddenDiscardCount={
              flights.filter((f) => f.toPlayerId === activePlayer.id && !settledFlightKeys.has(f.key)).length
            }
          />

          {isDesktop && handPanel}

          {pendingChoice && (
            <div className="panel panel--choice" ref={choiceRef}>
              <div className="panel__header">
                <h2>{pendingChoice.title}</h2>
                <button className="btn btn--ghost" onClick={() => setPendingChoice(null)}>
                  ✕ cancelar
                </button>
              </div>
              <div className="action-list">
                {pendingChoice.options.map((opt, i) => (
                  <button
                    key={i}
                    className={['btn', 'btn--primary', opt.accentClassName].filter(Boolean).join(' ')}
                    disabled={!opt.action && !opt.next}
                    onClick={() => chooseOption(opt)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="layout__right">
          <div className="panel panel--market">
            <div className="card-row card-row--market">
              {sortedAnimalTrack.map((card) => (
                <div
                  key={card.instanceId}
                  ref={(el) => {
                    if (el) marketRectsRef.current.set(card.instanceId, el.getBoundingClientRect());
                  }}
                >
                  <CardView
                    card={card}
                    onClick={() => handleMarketCardClick(card)}
                    disabled={!isMarketCardClickable(card)}
                    remainingLabel={String((state.sharedDecks[card.species ?? ''] ?? []).length + 1)}
                    livePoints={marketCardPreviewPoints(card)}
                    liveCost={marketCardLiveCost(card)}
                  />
                </div>
              ))}
              {PURCHASABLE_COIN_IDS.map((coinId) => {
                const card = { ...getCard(coinId), instanceId: coinId } as CardInstance;
                return (
                  <CardView
                    key={coinId}
                    card={card}
                    onClick={() => handleBuyCoinClick(coinId)}
                    disabled={!isCoinShopClickable(coinId)}
                    remainingLabel="∞"
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <details className="log-details" open>
        <summary>Log de la partida</summary>
        <pre>{state.log.slice(-40).join('\n')}</pre>
      </details>

      <div className="panel panel--bots">
        <div className="panel__header">
          <h2>Bots</h2>
        </div>
        <div className="player-strip">
          {bots.map((bot) => (
            <span key={bot.id} className="chip">
              <strong>{bot.name}</strong> · mano: {bot.hand.length} · descarte: {bot.discard.length}
              {(bot.table?.length ?? 0) > 0 ? ` · mesa: ${bot.table.length}` : ''}
              {onSetBotAlgorithm ? (
                <select
                  className="bot-algorithm-select"
                  value={botAlgorithms[bot.id] ?? 'general'}
                  onChange={(e) => onSetBotAlgorithm(bot.id, e.target.value as BotAlgorithm)}
                >
                  {BOT_ALGORITHM_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="chip__hint">
                  {' '}
                  · {BOT_ALGORITHM_OPTIONS.find((o) => o.value === botAlgorithms[bot.id])?.label ?? botAlgorithms[bot.id]}
                </span>
              )}
            </span>
          ))}
        </div>
      </div>

      {owedDiscard && (
        // Sin onClick en el backdrop ni botón de cerrar a propósito: un
        // descarte forzoso no se puede cancelar, hay que elegir sí o sí.
        <div className="modal-backdrop">
          <div className="modal modal--discard">
            <div className="panel__header">
              <h2>
                {discardVerb} {owedDiscard.amount} carta{owedDiscard.amount === 1 ? '' : 's'}
              </h2>
            </div>
            <p className="modal__message">
              {discardSourcePlayerName} ha jugado <strong>{state.pendingDecision?.sourceCardName}</strong>: tienes
              que {isDestroy ? 'eliminar de la partida' : isGiveToPlayer ? `darle a ${discardSourcePlayerName}` : 'descartar'}{' '}
              {owedDiscard.amount === 1 ? 'una carta' : `${owedDiscard.amount} cartas`}{' '}
              {eligibleOnlyOnTable ? 'de las que tienes sobre la mesa' : eligibleOnTable.length > 0 ? 'de tu mano o de tu mesa' : 'de tu mano'}.
              Elige cuál{owedDiscard.amount === 1 ? '' : 'es'}.
              {hasSlothSubstitute && (
                <>
                  {' '}
                  <strong>Truco:</strong> descartar tu Perezoso cubre toda la entrega él solo.
                </>
              )}
            </p>
            <div className="card-row">
              {eligibleDiscardCards.map((card) => (
                <div key={card.instanceId} className="discard-option">
                  <CardView
                    card={card}
                    onClick={() => runAction(resolveDiscardActionFor(legalActions, card.instanceId))}
                    hideType
                  />
                  {tableInstanceIds.has(card.instanceId) && <span className="discard-option__where">sobre la mesa</span>}
                </div>
              ))}
            </div>
            {eligibleDiscardCards.length === 0 && (
              // Red de seguridad: este aviso no se puede cerrar, así que NUNCA debe quedarse sin
              // salida. Si el motor dice que debes algo pero aquí no hay ninguna carta que ofrecer
              // (un caso que no debería darse), se explica y se deja seguir la partida en vez de
              // bloquearla para todos.
              <p className="modal__message">
                No encuentro ninguna carta que puedas entregar, así que no hay nada que elegir. Esto no debería pasar:
                si lo ves, cuéntamelo con una captura.
              </p>
            )}
          </div>
        </div>
      )}

      {animalAbilityChoice && !pendingChoice && (
        // Igual que el popup de descarte forzoso: sin forma de cancelar, hay
        // que elegir uno sí o sí (ya se sabe que hay al menos 1 candidato,
        // ver pendingAnimalAbilityChoice: solo arranca si se descartó algo).
        // Se oculta mientras pendingChoice esté abierto (ver
        // handleAnimalAbilityCandidateClick): si la habilidad elegida
        // necesita objetivo (Elefante/Araña/Flamenco...), este modal de
        // pantalla completa taparía el panel de "elige el objetivo", que no
        // es un modal fijo — cancelar ese panel vuelve a mostrar este.
        <div className="modal-backdrop">
          <div className="modal modal--discard">
            <div className="panel__header">
              <h2>Elige una habilidad</h2>
            </div>
            <p className="modal__message">
              Tu <strong>{animalAbilityChoice.sourceCardName}</strong> hizo que cada jugador descartara un animal.
              Elige uno de ellos para usar su habilidad como si lo hubieras jugado tú (se queda donde está, en el
              descarte de quien lo entregó).
            </p>
            <div className="card-row">
              {animalAbilityCandidates.map((card) => (
                <CardView
                  key={card.instanceId}
                  card={card}
                  onClick={() => handleAnimalAbilityCandidateClick(card)}
                  hideType
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {confirmEndTurn && (
        <div className="modal-backdrop" onClick={() => setConfirmEndTurn(false)}>
          <div className="modal modal--confirm" onClick={(e) => e.stopPropagation()}>
            <div className="panel__header">
              <h2>¿Terminar turno?</h2>
            </div>
            <p className="modal__message">
              Todavía tienes animales por jugar o dinero por gastar. ¿Seguro que quieres terminar el turno?
            </p>
            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={() => setConfirmEndTurn(false)}>
                Cancelar
              </button>
              <button
                className="btn btn--primary"
                onClick={() => {
                  setConfirmEndTurn(false);
                  endTurn();
                }}
              >
                Sí, terminar turno
              </button>
            </div>
          </div>
        </div>
      )}

      {viewedPlayer && (
        <div className="modal-backdrop" onClick={() => setViewedPlayerId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel__header">
              <h2>
                Mazo de {scoreboardName(viewedPlayer)} · {groupedCollection(viewedPlayer).reduce((n, e) => n + e.count, 0)}{' '}
                cartas · {scoreFor(viewedPlayer.id)} PV
              </h2>
              <button className="btn btn--ghost" onClick={() => setViewedPlayerId(null)}>
                ✕ cerrar
              </button>
            </div>
            <div className="card-row">
              {groupedCollection(viewedPlayer).map(({ card, count, perCardPoints }) => {
                const total = perCardPoints.reduce((sum, p) => sum + p, 0);
                return (
                  <div key={card.id} className="collection-entry">
                    <CardView card={card} hideType />
                    {count > 1 && <span className="collection-entry__count">×{count}</span>}
                    <div
                      className={['collection-entry__points', total < 0 && 'collection-entry__points--negative']
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {pointsLabel(count, perCardPoints)}
                    </div>
                  </div>
                );
              })}
            </div>
            {viewedPlayer.destroyedCards.length > 0 && (
              <div className="collection-destroyed">
                <p className="collection-destroyed__title">
                  🗑️ Eliminadas ({viewedPlayer.destroyedCards.length}, fuera de la colección para siempre — no
                  puntúan)
                </p>
                <div className="card-row">
                  {groupedDestroyed(viewedPlayer).map(({ card, count }) => (
                    <div key={card.id} className="collection-entry">
                      <CardView card={card} destroyed hideType />
                      {count > 1 && <span className="collection-entry__count">×{count}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {flights.map((flight) => (
        <FlyingCard
          key={flight.key}
          flight={flight}
          onSettle={() => settleFlight(flight.key)}
          onDone={() => removeFlight(flight.key)}
        />
      ))}
    </div>
  );
}
