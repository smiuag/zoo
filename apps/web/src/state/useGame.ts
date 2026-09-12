import { useEffect, useRef, useState } from 'react';
import {
  animalBuyerBot,
  applyAction,
  aquaticRlBot,
  birdRlBot,
  createGame,
  expensiveFirstBot,
  getActivePlayer,
  heuristicBot,
  landRlBot,
  pickDefaultDiscard,
  randomBot,
  rlBot,
  scoreGame,
  type Action,
  type Bot,
  type GameState,
  type PlayerScore,
} from '@zoo/engine';
import { FLIGHT_TOTAL_MS } from '../components/FlyingCard';
import { buildStarterDeck } from '../lib/starterDeck';
import { DEFAULT_BOT_ALGORITHM, MAX_NICK_LENGTH, defaultGameConfig, type BotAlgorithm, type GameConfig } from '../lib/gameConfig';

export type { BotAlgorithm, GameConfig, RoundLimit } from '../lib/gameConfig';
export { DEFAULT_BOT_ALGORITHM, DEFAULT_ROUND_LIMIT, MAX_BOTS, MAX_HUMANS, MIN_BOTS, MIN_HUMANS, MIN_TOTAL_PLAYERS, ROUND_LIMIT_OPTIONS } from '../lib/gameConfig';

const BOT_REGISTRY: Record<BotAlgorithm, Bot> = {
  rl: rlBot,
  rlLand: landRlBot,
  rlBird: birdRlBot,
  rlAquatic: aquaticRlBot,
  heuristic: heuristicBot,
  random: randomBot,
  expensiveFirst: expensiveFirstBot,
  animalBuyer: animalBuyerBot,
};

// Red de seguridad: un bot mal entrenado puede quedarse atrapado en un
// bucle que no da PV de más (p. ej. jugar una y otra vez el mismo animal ya
// adquirido, que solo cicla entre mano/descarte/mazo vía su propio robo, sin
// aumentar la colección real) y cuya política nunca elige terminar turno por
// su cuenta. Se cuentan las acciones de ESTE turno (se reinicia en cuanto
// cambia state.turn) y, superado el límite, se le fuerza a terminar turno.
const MAX_ACTIONS_PER_BOT_TURN = 300;

// Ritmo al que se ve actuar a un bot: jugar una carta, comprar (animal o
// moneda) o terminar turno esperan este tiempo antes de aplicarse — así se
// compran de una en una en vez de todas de golpe, y se ve un instante lo
// último que se hizo antes de pasar al siguiente jugador. Solo resolver un
// descarte pendiente no se retrasa.
const BOT_STEP_DELAY_MS = 1000;
const BOT_PACED_ACTION_TYPES = new Set<Action['type']>(['playCard', 'buyAnimal', 'buyCoin', 'endTurn']);

function describeAction(action: Action): string {
  return JSON.stringify(action);
}

// Vuelca líneas al archivo apps/web/game.log vía el middleware de
// vite.config.ts (solo existe en `vite dev`, nunca en el build de
// producción): permite revisar una partida entera turno a turno después de
// jugarla, sin depender de la consola del navegador (que no persiste entre
// sesiones ni es accesible fuera del propio navegador). Mejor esfuerzo: si
// el middleware no está (build de producción, fetch bloqueado, etc.) falla
// en silencio, nunca debe romper la partida real.
//
// Las peticiones se encadenan en esta cola (en vez de lanzarse sueltas en
// paralelo): así llegan al servidor en el mismo orden en que se generaron
// aunque cada fetch tarde un tiempo distinto en resolver, sin bloquear el
// bucle de turnos de los bots esperando la respuesta de cada una.
let gameLogQueue: Promise<void> = Promise.resolve();

function postGameLog(lines: string[], clear = false): void {
  if (!import.meta.env.DEV) return;
  if (!clear && lines.length === 0) return;
  gameLogQueue = gameLogQueue.then(() =>
    fetch('/__game-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines, clear }),
      keepalive: true,
    })
      .then(() => undefined)
      .catch(() => undefined)
  );
}

// Nombre de cada jugador humano. El local (human-0) usa el nick que haya
// escrito en el formulario (ver GameConfig.nick); sin nick, "Tú" si juega
// solo o "J1" si hay varios. El resto de humanos —turno rotatorio en el
// mismo dispositivo o invitados online— van numerados "J2", "J3"... Todo
// deliberadamente corto (igual que "B1", "B2" para los bots) para que el
// marcador quepa en una sola línea en el móvil con 5 jugadores.
function humanName(index: number, total: number, nick: string): string {
  if (index === 0 && nick) return nick;
  return total === 1 ? 'Tú' : `J${index + 1}`;
}

function newGame(config: GameConfig): GameState {
  const humans = Array.from({ length: config.numHumans }, (_, i) => ({
    id: `human-${i}`,
    name: humanName(i, config.numHumans, config.nick.trim().slice(0, MAX_NICK_LENGTH)),
    deck: buildStarterDeck(),
  }));
  const bots = config.botAlgorithms.map((_, i) => ({
    id: `bot-${i}`,
    name: `B${i + 1}`,
    deck: buildStarterDeck(),
  }));
  return createGame([...humans, ...bots], { maxRounds: config.roundLimit });
}

export interface UseGame {
  // 'setup': todavía no hay partida real en curso, App.tsx muestra el
  // formulario de creación (nº de humanos/bots y su tipo). 'playing': hay
  // una partida en curso (o recién terminada, hasta pulsar "Nueva partida").
  phase: 'setup' | 'playing';
  state: GameState;
  // Todos los jugadores humanos de la partida en curso (1 si es solitario
  // contra bots, más si es "pase y juega" local). Sustituye al antiguo
  // HUMAN_ID fijo.
  humanIds: string[];
  // Qué humano tiene agencia AHORA MISMO: normalmente el humano con el
  // turno activo, pero mientras haya un descarte forzoso pendiente (Buitre/
  // Mono/Hiena/Murciélago) puede ser un humano DISTINTO al que tiene el
  // turno (el afectado, no quien jugó la carta) — ver PendingDiscardDecision
  // en el motor. undefined si ahora mismo no le toca actuar a ningún
  // humano (turno de un bot, o partida terminada). App.tsx lo usa para
  // saber a quién mostrar en pase-y-juega local, y para calcular las
  // acciones legales de cada visor (getLegalActions(state, actingHumanId)).
  actingHumanId: string | undefined;
  scores: PlayerScore[];
  canRestartTurn: boolean;
  botAlgorithms: Record<string, BotAlgorithm>;
  // Decidido al crear ESTA partida (ver GameConfig): si está desactivado,
  // los bots actúan sin ningún retraso artificial y no hay animación de
  // "vuelo" de compra — GameBoard.tsx lo usa para no generar esos vuelos.
  animationsEnabled: boolean;
  // Sube cada vez que `state` cambia de verdad (tras cualquier acción, propia
  // o de un bot). El propio `GameState` vive en un ref mutado en el sitio
  // (ver stateRef más abajo), así que no sirve como dependencia de efecto por
  // referencia; este contador sí. Lo usa la sala online (useHostRoom) para
  // saber cuándo retransmitir el estado a los invitados sin acoplarse a cómo
  // useGame decide re-renderizar.
  tick: number;
  startGame: (config: GameConfig) => void;
  doAction: (action: Action) => void;
  // Vuelve a mostrar el formulario de creación de partida (no crea la
  // partida nueva por su cuenta: eso lo hace startGame cuando el jugador
  // confirma el formulario).
  restart: () => void;
  restartTurn: () => void;
  setBotAlgorithm: (botId: string, algorithm: BotAlgorithm) => void;
}

export function useGame(): UseGame {
  // Placeholder hasta el primer startGame(): nunca se juega ni se muestra
  // (App.tsx renderiza el formulario mientras phase === 'setup'), pero
  // mantener `state` siempre no-nulo evita comprobaciones null por todo
  // App.tsx.
  const stateRef = useRef<GameState>(newGame(defaultGameConfig()));
  const [phase, setPhase] = useState<'setup' | 'playing'>('setup');
  const [humanIds, setHumanIds] = useState<string[]>(['human-0']);
  // Foto del estado tal cual estaba al EMPEZAR el turno humano actual (antes
  // de cualquier acción suya), para poder deshacerlo entero con "reiniciar
  // turno". Se clona (no solo se guarda la referencia) porque el motor muta
  // el GameState en el sitio: si no se clonara, la propia foto se iría
  // corrompiendo según el jugador actúa.
  const turnSnapshotRef = useRef<{ turn: number; snapshot: GameState } | null>(null);
  // Cuenta las acciones ya tomadas en el turno de bot actual, para la red de
  // seguridad de MAX_ACTIONS_PER_BOT_TURN (ver más abajo).
  const botTurnActionCountRef = useRef<{ turn: number; count: number }>({ turn: -1, count: 0 });
  // Qué acción fue la última que aplicó un bot en su turno actual: si acaba
  // de comprar un animal y lo siguiente es terminar turno, hay que esperar
  // a que la animación de vuelo al descarte (ver FlyingCard.tsx) se vea
  // entera antes de pasar de jugador, no solo el retraso normal entre
  // pasos — ver el cálculo de delayMs más abajo.
  const lastBotActionTypeRef = useRef<Action['type'] | null>(null);
  const [tick, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);
  const [botAlgorithms, setBotAlgorithms] = useState<Record<string, BotAlgorithm>>({});
  // Fijado al crear la partida (ver startGame): no cambia a mitad de
  // partida, así que no hace falta que sea un useState (no hay setter
  // expuesto para esto, a diferencia de botAlgorithms).
  const animationsEnabledRef = useRef(true);

  const state = stateRef.current;

  // A quién le toca actuar AHORA MISMO entre los humanos: normalmente el
  // humano con el turno activo, pero mientras haya un descarte forzoso
  // pendiente (Buitre/Mono/Hiena/Murciélago) puede tocarle a un humano
  // DISTINTO — el afectado, que puede no tener el turno — ver
  // PendingDiscardDecision en el motor. undefined si nadie humano puede
  // actuar ahora (turno de un bot, o partida terminada/sin empezar).
  function findActingHuman(): string | undefined {
    if (phase !== 'playing' || state.gameOver) return undefined;
    if (state.pendingDecision) {
      return Object.keys(state.pendingDecision.owed).find((id) => humanIds.includes(id));
    }
    const activeId = getActivePlayer(state).id;
    return humanIds.includes(activeId) ? activeId : undefined;
  }

  // Solo true cuando el humano activo (el que tiene el turno de verdad, no
  // un afectado por un descarte pendiente) puede actuar sin nada bloqueando
  // — es la única situación en la que tiene sentido tomar la foto de
  // "reiniciar turno" o permitir usarla (ver canRestartTurn más abajo).
  const isActiveHumanTurn =
    phase === 'playing' && !state.gameOver && !state.pendingDecision && humanIds.includes(getActivePlayer(state).id);

  // El motor muta el GameState en el sitio; tras cada acción de un bot (o
  // de un descarte pendiente que le toque a uno) forzamos un re-render.
  // Este efecto se reevalúa cada vez que `tick` cambia — es decir, justo
  // después de la acción anterior — y agenda UN único paso más con
  // setTimeout: así se puede ver a los bots jugar carta a carta en vez de
  // resolver el turno entero de golpe, y también se ve un instante lo
  // último que hicieron antes de pasar al siguiente jugador (ver
  // BOT_PACED_ACTION_TYPES: jugar una carta y terminar turno se retrasan;
  // comprar o resolver un descarte pendiente no). Al no ser ya un bucle
  // síncrono, tampoco puede congelar la
  // pestaña aunque un bot se quede enganchado en un bucle (por eso ya no
  // hace falta el antiguo tope global de "1000 acciones seguidas": cada
  // paso cede el control al navegador entre medias). No hace nada mientras
  // se está en el formulario de creación (phase 'setup'): el placeholder de
  // arriba nunca debe jugarse solo.
  useEffect(() => {
    if (phase !== 'playing' || state.gameOver) return;

    if (isActiveHumanTurn) {
      // Justo al empezar el turno de un humano (todavía sin ninguna acción
      // suya aplicada) se guarda la foto para poder volver aquí.
      if (turnSnapshotRef.current?.turn !== state.turn) {
        turnSnapshotRef.current = { turn: state.turn, snapshot: structuredClone(state) };
      }
    }
    if (findActingHuman() !== undefined) return; // un humano tiene agencia: que actúe él

    // Decide el siguiente paso de un bot (o de un descarte pendiente que le
    // toque a uno) SIN aplicarlo todavía, para saber cuánto retraso darle.
    let delayMs = 0;
    let applyStep: () => void;

    if (state.pendingDecision) {
      // En este punto solo puede deberlo un bot (si lo debiera algún
      // humano, findActingHuman() no habría devuelto undefined) — se
      // resuelve con la misma heurística "se queda con la peor" que antes
      // decidía el propio motor.
      const owedBotId = Object.keys(state.pendingDecision.owed)[0];
      const owed = state.pendingDecision.owed[owedBotId];
      const botPlayer = state.players.find((p) => p.id === owedBotId);
      const instanceId = botPlayer
        ? pickDefaultDiscard(
            botPlayer.hand,
            owed.eligibleInstanceIds,
            state.pendingDecision.kind === 'discard',
            state.pendingDecision.bonusDrawPerCoin
          )
        : null;
      applyStep = () => {
        if (instanceId && botPlayer) {
          const action: Action = { type: 'resolveDiscard', instanceId };
          const sourceCardName = state.pendingDecision?.sourceCardName ?? '';
          applyAction(state, owedBotId, action);
          postGameLog([`T${state.turn} | ${botPlayer.name} | ${describeAction(action)} (descarte: ${sourceCardName})`]);
        }
        rerender();
      };
    } else {
      const bot = getActivePlayer(state);

      if (botTurnActionCountRef.current.turn !== state.turn) {
        botTurnActionCountRef.current = { turn: state.turn, count: 0 };
        lastBotActionTypeRef.current = null;
      }
      botTurnActionCountRef.current.count++;

      const algorithm = botAlgorithms[bot.id] ?? DEFAULT_BOT_ALGORITHM;
      const turnBeforeAction = state.turn;
      let action: Action;
      if (botTurnActionCountRef.current.count > MAX_ACTIONS_PER_BOT_TURN) {
        const warning = `[bot] ${bot.name} (${algorithm}) superó ${MAX_ACTIONS_PER_BOT_TURN} acciones en su turno: se le fuerza a terminarlo.`;
        // eslint-disable-next-line no-console
        console.warn(warning);
        postGameLog([`T${turnBeforeAction} | ${bot.name} (${algorithm}) | !! ${warning}`]);
        action = { type: 'endTurn' };
      } else {
        action = BOT_REGISTRY[algorithm].chooseAction(state, bot.id);
      }

      // Justo tras comprar un animal, terminar turno espera además lo que
      // dure entera la animación de vuelo al descarte (ver
      // FlyingCard.tsx): así el cambio de jugador nunca corta la animación
      // a medias. Con las animaciones desactivadas (ver GameConfig), nada
      // de esto se retrasa: los bots actúan al instante.
      const justBoughtAnimal = lastBotActionTypeRef.current === 'buyAnimal';
      delayMs = !animationsEnabledRef.current
        ? 0
        : action.type === 'endTurn' && justBoughtAnimal
          ? FLIGHT_TOTAL_MS + BOT_STEP_DELAY_MS
          : BOT_PACED_ACTION_TYPES.has(action.type)
            ? BOT_STEP_DELAY_MS
            : 0;
      applyStep = () => {
        // eslint-disable-next-line no-console
        console.log(`[bot] ${bot.name} (${algorithm}):`, action);
        const logLenBefore = state.log.length;
        applyAction(state, bot.id, action);
        lastBotActionTypeRef.current = action.type;
        const engineLines = state.log.slice(logLenBefore);
        postGameLog([
          `T${turnBeforeAction} | ${bot.name} (${algorithm}) | ${describeAction(action)}`,
          ...engineLines.map((l) => `    -> ${l}`),
        ]);
        rerender();
      };
    }

    const timeoutId = window.setTimeout(applyStep, delayMs);
    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, phase]);

  const actingHumanId = findActingHuman();
  const scores = scoreGame(state);
  const canRestartTurn = isActiveHumanTurn && turnSnapshotRef.current?.turn === state.turn;

  // El actor de una acción NO es siempre "el jugador activo": un
  // resolveDiscard lo resuelve el jugador afectado, que puede ser distinto
  // (ver PendingDiscardDecision) — se deduce de quién tiene de verdad esa
  // carta en la mano ahora mismo, en vez de asumir getActivePlayer(state).
  // El resto de acciones (playCard/buyAnimal/buyCoin/endTurn) solo puede
  // hacerlas el jugador activo, como siempre.
  function actorForAction(action: Action): string | undefined {
    if (action.type === 'resolveDiscard') {
      return state.players.find((p) => p.hand.some((c) => c.instanceId === action.instanceId))?.id;
    }
    return getActivePlayer(state).id;
  }

  function doAction(action: Action) {
    const actorId = actorForAction(action);
    if (!actorId || !humanIds.includes(actorId)) return;
    const player = state.players.find((p) => p.id === actorId)!;
    const turnBeforeAction = state.turn;
    const logLenBefore = state.log.length;
    applyAction(state, player.id, action);
    const engineLines = state.log.slice(logLenBefore);
    postGameLog([
      `T${turnBeforeAction} | ${player.name} | ${describeAction(action)}`,
      ...engineLines.map((l) => `    -> ${l}`),
    ]);
    rerender();
  }

  function startGame(config: GameConfig) {
    stateRef.current = newGame(config);
    turnSnapshotRef.current = null;
    botTurnActionCountRef.current = { turn: -1, count: 0 };
    lastBotActionTypeRef.current = null;
    animationsEnabledRef.current = config.animationsEnabled;
    setHumanIds(Array.from({ length: config.numHumans }, (_, i) => `human-${i}`));
    const nextBotAlgorithms: Record<string, BotAlgorithm> = {};
    config.botAlgorithms.forEach((algorithm, i) => {
      nextBotAlgorithms[`bot-${i}`] = algorithm;
    });
    setBotAlgorithms(nextBotAlgorithms);
    setPhase('playing');
    postGameLog(['=== Nueva partida ==='], true);
    rerender();
  }

  // Vuelve al formulario de creación en vez de lanzar directamente otra
  // partida con la misma configuración: así el jugador puede cambiar nº de
  // humanos/bots y su tipo cada vez, tal como pide el enunciado ("que al
  // crear la partida lo primero que te pregunte sea..."). startGame() se
  // encarga de crear la partida de verdad cuando confirme el formulario.
  function restart() {
    setPhase('setup');
  }

  function restartTurn() {
    if (!canRestartTurn || !turnSnapshotRef.current) return;
    // Se clona también al restaurar: la foto guardada debe seguir intacta
    // por si el jugador la usa varias veces en el mismo turno.
    stateRef.current = structuredClone(turnSnapshotRef.current.snapshot);
    rerender();
  }

  // No se resetea al volver al formulario: la elección de algoritmo por
  // hueco de bot hecha a mitad de partida (desplegable del panel "Bots") es
  // una preferencia de la sesión, pero cada startGame() la vuelve a fijar
  // según lo elegido en el formulario, así que este setter solo importa
  // mientras hay una partida en curso.
  function setBotAlgorithm(botId: string, algorithm: BotAlgorithm) {
    setBotAlgorithms((prev) => ({ ...prev, [botId]: algorithm }));
  }

  return {
    phase,
    state,
    humanIds,
    actingHumanId,
    scores,
    canRestartTurn,
    botAlgorithms,
    animationsEnabled: animationsEnabledRef.current,
    tick,
    startGame,
    doAction,
    restart,
    restartTurn,
    setBotAlgorithm,
  };
}
