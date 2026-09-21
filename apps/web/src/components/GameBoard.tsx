import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
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
  // falta la cifra, para el badge flotante de móvil de más abajo — ver
  // .money-float en styles.css.
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
  const eligibleDiscardCards = owedDiscard
    ? human.hand.filter((c) => resolveDiscardActionFor(legalActions, c.instanceId))
    : [];
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
  // En móvil (.layout a una sola columna, ver styles.css) el mercado queda
  // debajo de la mesa/mano y es muy vertical: pedido explícito del usuario,
  // justo después de comprar (nunca de jugar una carta) la pantalla sube
  // sola hasta el mercado para seguir comprando sin buscar dónde estaba, o
  // hasta "Terminar turno" si ya no queda nada que puedas pagar. En
  // escritorio (todo visible a la vez) scrollIntoView con block:'nearest'
  // no hace nada si ya está a la vista, así que esto no molesta ahí.
  const marketPanelRef = useRef<HTMLDivElement>(null);
  const endTurnButtonRef = useRef<HTMLButtonElement>(null);
  const scrollAfterBuyRef = useRef(false);
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
  const sortedAnimalTrack = [...state.animalTrack].sort(
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

  // `legalActions` ya refleja el estado DESPUÉS de la compra (llega de
  // App.tsx recalculado en cada render): si scrollAfterBuyRef quedó
  // marcado por runAction, aquí es donde se sabe de verdad si todavía se
  // puede pagar algo más o no.
  useEffect(() => {
    if (!scrollAfterBuyRef.current) return;
    scrollAfterBuyRef.current = false;
    const canBuyMore = legalActions.some((a) => a.type === 'buyAnimal' || a.type === 'buyCoin');
    const target = canBuyMore ? marketPanelRef.current : endTurnButtonRef.current;
    target?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [legalActions]);

  function runAction(action: Action | undefined) {
    if (!action) return;
    if (action.type === 'buyAnimal' || action.type === 'buyCoin') scrollAfterBuyRef.current = true;
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

  return (
    <div className="app">
      {!state.gameOver && (
        // Solo visible en móvil (ver .money-float en styles.css): en
        // pantalla ancha "Mesa de X" ya se ve a la vez que el mercado, pero
        // en una columna sola el mercado queda muy por debajo — pedido
        // explícito del usuario, poder ver el dinero disponible sin tener
        // que volver a subir hasta la mesa mientras compras.
        <p
          className="money-float"
          title={`Valor de compra de ${displayName(activePlayer, humanIds, botAlgorithms)}: ${purchasingPower} disponibles de ${purchasingPowerPeak} que ha llegado a tener este turno`}
        >
          💰 {purchasingPower}/{purchasingPowerPeak}
        </p>
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
          <div className="panel">
            <div className="status-row">
              {state.gameOver ? (
                <span className="status-pill status-pill--over">Partida terminada</span>
              ) : owedDiscard ? (
                <span className="status-pill status-pill--discard">
                  {discardVerb} {owedDiscard.amount} carta{owedDiscard.amount === 1 ? '' : 's'} — {state.pendingDecision!.sourceCardName}
                </span>
              ) : (
                <span className="status-pill">
                  {/* Recta final: el contador de ronda pasa a rojo en las 5
                      últimas rondas, para que se vea de un vistazo que la
                      partida se acaba (y compense ya comprar PV en vez de
                      economía). */}
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
              )}
              {onNewGame && (
                <button className="btn btn--ghost btn--new-game" onClick={onNewGame} title="Nueva partida">
                  ↺ <span className="btn__label">Nueva partida</span>
                </button>
              )}
            </div>

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
          </div>

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

          {human.hand.length > 0 && (
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
          )}

          {isOwnTurn && (
            <div className="panel">
              <div className="turn-controls">
                <button
                  ref={endTurnButtonRef}
                  className="btn btn--primary"
                  disabled={!legalActions.some((a) => a.type === 'endTurn')}
                  onClick={() => {
                    if (hasUnusedTurnActions) {
                      setConfirmEndTurn(true);
                      return;
                    }
                    runAction(legalActions.find((a) => a.type === 'endTurn'));
                  }}
                >
                  Terminar turno
                </button>
                {onRestartTurn && (
                  <button className="btn btn--ghost" disabled={!canRestartTurn} onClick={handleRestartTurn}>
                    ↺ Reiniciar turno
                  </button>
                )}
              </div>
            </div>
          )}

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
          <div className="panel" ref={marketPanelRef}>
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

      <div className="panel">
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
              {owedDiscard.amount === 1 ? 'una carta' : `${owedDiscard.amount} cartas`} de tu mano.
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
                <CardView
                  key={card.instanceId}
                  card={card}
                  onClick={() => runAction(resolveDiscardActionFor(legalActions, card.instanceId))}
                  hideType
                />
              ))}
            </div>
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
                  runAction(legalActions.find((a) => a.type === 'endTurn'));
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
