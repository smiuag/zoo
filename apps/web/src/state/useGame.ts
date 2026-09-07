import { useEffect, useRef, useState } from 'react';
import {
  animalBuyerBot,
  applyAction,
  aquaticRlBot,
  birdRlBot,
  createGame,
  expensiveFirstBot,
  getActivePlayer,
  getLegalActions,
  heuristicBot,
  landRlBot,
  randomBot,
  rlBot,
  scoreGame,
  type Action,
  type Bot,
  type GameState,
  type PlayerScore,
} from '@zoo/engine';
import { buildStarterDeck } from '../lib/starterDeck';

export const HUMAN_ID = 'human';
const BOT_COUNT = 4;

// Los 8 algoritmos de IA disponibles para cada hueco de bot: rl es el
// generalista sin restricciones entrenado por self-play (packages/engine/
// scripts/rl), rlLand/rlBird/rlAquatic son especialistas entrenados con la
// misma red pero restringidos a comprar solo animales de un hábitat, y el
// resto son los bots heurísticos/aleatorios ya existentes.
export type BotAlgorithm =
  | 'rl'
  | 'rlLand'
  | 'rlBird'
  | 'rlAquatic'
  | 'heuristic'
  | 'random'
  | 'expensiveFirst'
  | 'animalBuyer';

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

const DEFAULT_BOT_ALGORITHM: BotAlgorithm = 'rl';

// Duraciones de partida seleccionables (en rondas: 1 turno de cada
// jugador). No hay opción "sin límite" a propósito: el motor siempre
// termina, como mucho, al agotarse 5 mazos compartidos (ver
// FINAL_ROUND_EMPTY_DECK_THRESHOLD en engine.ts), pero eso puede tardar
// mucho — esto le da al jugador control real sobre cuánto dura.
export const ROUND_LIMIT_OPTIONS = [15, 30, 50] as const;
export type RoundLimit = (typeof ROUND_LIMIT_OPTIONS)[number];
const DEFAULT_ROUND_LIMIT: RoundLimit = 30;

// Por defecto, cada hueco es un bot RL distinto (el generalista + los 3
// especialistas de hábitat): una partida nueva ya enfrenta a los 4 sin
// tener que tocar los desplegables.
const DEFAULT_BOT_ALGORITHMS_BY_SEAT: BotAlgorithm[] = ['rl', 'rlLand', 'rlBird', 'rlAquatic'];

function defaultBotAlgorithms(): Record<string, BotAlgorithm> {
  return Object.fromEntries(
    Array.from({ length: BOT_COUNT }, (_, i) => [`bot-${i}`, DEFAULT_BOT_ALGORITHMS_BY_SEAT[i] ?? DEFAULT_BOT_ALGORITHM])
  );
}

// Red de seguridad: un bot mal entrenado puede quedarse atrapado en un
// bucle que no da PV de más (p. ej. jugar una y otra vez el mismo animal ya
// adquirido, que solo cicla entre mano/descarte/mazo vía su propio robo, sin
// aumentar la colección real) y cuya política nunca elige terminar turno por
// su cuenta. Sin este límite, el bucle sin dependencias de abajo seguiría
// reintentando para siempre en cada render y congelaría la pestaña. Se
// cuentan las acciones de ESTE turno (se reinicia en cuanto cambia
// state.turn) y, superado el límite, se le fuerza a terminar turno.
const MAX_ACTIONS_PER_BOT_TURN = 300;

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

function newGame(maxRounds: RoundLimit): GameState {
  return createGame(
    [
      { id: HUMAN_ID, name: 'Tú', deck: buildStarterDeck() },
      ...Array.from({ length: BOT_COUNT }, (_, i) => ({
        id: `bot-${i}`,
        name: `Bot ${i + 1}`,
        deck: buildStarterDeck(),
      })),
    ],
    { maxRounds }
  );
}

export interface UseGame {
  state: GameState;
  humanId: string;
  humanTurn: boolean;
  legalActions: Action[];
  scores: PlayerScore[];
  canRestartTurn: boolean;
  botAlgorithms: Record<string, BotAlgorithm>;
  roundLimit: RoundLimit;
  doAction: (action: Action) => void;
  restart: () => void;
  restartTurn: () => void;
  setBotAlgorithm: (botId: string, algorithm: BotAlgorithm) => void;
  // Solo cambia la duración elegida para la PRÓXIMA partida nueva (no
  // afecta a la que está en curso: cambiar `state.maxRounds` a mitad de
  // partida podría dejarla ya "caducada" de golpe si ya se jugaron más
  // rondas que el nuevo límite).
  setRoundLimit: (rounds: RoundLimit) => void;
}

export function useGame(): UseGame {
  const stateRef = useRef<GameState>(newGame(DEFAULT_ROUND_LIMIT));
  // Foto del estado tal cual estaba al EMPEZAR el turno humano actual (antes
  // de cualquier acción suya), para poder deshacerlo entero con "reiniciar
  // turno". Se clona (no solo se guarda la referencia) porque el motor muta
  // el GameState en el sitio: si no se clonara, la propia foto se iría
  // corrompiendo según el jugador actúa.
  const turnSnapshotRef = useRef<{ turn: number; snapshot: GameState } | null>(null);
  // Cuenta las acciones ya tomadas en el turno de bot actual, para la red de
  // seguridad de MAX_ACTIONS_PER_BOT_TURN (ver más abajo).
  const botTurnActionCountRef = useRef<{ turn: number; count: number }>({ turn: -1, count: 0 });
  const [, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);
  const [botAlgorithms, setBotAlgorithms] = useState<Record<string, BotAlgorithm>>(defaultBotAlgorithms);
  const [roundLimit, setRoundLimit] = useState<RoundLimit>(DEFAULT_ROUND_LIMIT);

  const state = stateRef.current;

  // Arranca el archivo game.log en blanco para la partida inicial de esta
  // sesión (restart() lo vuelve a limpiar para partidas posteriores).
  useEffect(() => {
    postGameLog(['=== Nueva partida ==='], true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // El motor muta el GameState en el sitio; después de cada acción (propia
  // o de un bot) forzamos un re-render. Este efecto, sin dependencias, se
  // reevalúa tras cada render: mientras el turno activo sea de un bot,
  // encadena sus acciones automáticamente hasta que vuelva a tocarle al
  // humano o termine la partida.
  useEffect(() => {
    if (state.gameOver) return;

    if (getActivePlayer(state).id === HUMAN_ID) {
      // Justo al empezar el turno humano (todavía sin ninguna acción suya
      // aplicada) se guarda la foto para poder volver aquí.
      if (turnSnapshotRef.current?.turn !== state.turn) {
        turnSnapshotRef.current = { turn: state.turn, snapshot: structuredClone(state) };
      }
      return;
    }

    let guard = 0;
    let acted = false;
    while (!state.gameOver && getActivePlayer(state).id !== HUMAN_ID && guard < 1000) {
      const bot = getActivePlayer(state);

      if (botTurnActionCountRef.current.turn !== state.turn) {
        botTurnActionCountRef.current = { turn: state.turn, count: 0 };
      }
      botTurnActionCountRef.current.count++;

      const algorithm = botAlgorithms[bot.id] ?? DEFAULT_BOT_ALGORITHM;
      const turnBeforeAction = state.turn;
      const logLenBefore = state.log.length;
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

      // eslint-disable-next-line no-console
      console.log(`[bot] ${bot.name} (${algorithm}):`, action);
      applyAction(state, bot.id, action);
      const engineLines = state.log.slice(logLenBefore);
      postGameLog([
        `T${turnBeforeAction} | ${bot.name} (${algorithm}) | ${describeAction(action)}`,
        ...engineLines.map((l) => `    -> ${l}`),
      ]);
      guard++;
      acted = true;
    }
    if (guard >= 1000 && !state.gameOver && getActivePlayer(state).id !== HUMAN_ID) {
      const warning = '[bot] Límite global de 1000 acciones encadenadas alcanzado: se corta el autoplay para revisar.';
      // eslint-disable-next-line no-console
      console.warn(warning);
      postGameLog([warning]);
    }
    if (acted) rerender();
  });

  const humanTurn = !state.gameOver && getActivePlayer(state).id === HUMAN_ID;
  const legalActions = humanTurn ? getLegalActions(state, HUMAN_ID) : [];
  const scores = scoreGame(state);
  const canRestartTurn = humanTurn && turnSnapshotRef.current?.turn === state.turn;

  function doAction(action: Action) {
    if (!humanTurn) return;
    const turnBeforeAction = state.turn;
    const logLenBefore = state.log.length;
    applyAction(state, HUMAN_ID, action);
    const engineLines = state.log.slice(logLenBefore);
    postGameLog([
      `T${turnBeforeAction} | Tú | ${describeAction(action)}`,
      ...engineLines.map((l) => `    -> ${l}`),
    ]);
    rerender();
  }

  function restart() {
    stateRef.current = newGame(roundLimit);
    turnSnapshotRef.current = null;
    postGameLog(['=== Nueva partida (reinicio) ==='], true);
    rerender();
  }

  function restartTurn() {
    if (!canRestartTurn || !turnSnapshotRef.current) return;
    // Se clona también al restaurar: la foto guardada debe seguir intacta
    // por si el jugador la usa varias veces en el mismo turno.
    stateRef.current = structuredClone(turnSnapshotRef.current.snapshot);
    rerender();
  }

  // No se resetea en restart(): la elección de algoritmo por hueco de bot es
  // una preferencia de la sesión, no del estado de una partida concreta.
  function setBotAlgorithm(botId: string, algorithm: BotAlgorithm) {
    setBotAlgorithms((prev) => ({ ...prev, [botId]: algorithm }));
  }

  return {
    state,
    humanId: HUMAN_ID,
    humanTurn,
    legalActions,
    scores,
    canRestartTurn,
    botAlgorithms,
    roundLimit,
    doAction,
    restart,
    restartTurn,
    setBotAlgorithm,
    setRoundLimit,
  };
}
