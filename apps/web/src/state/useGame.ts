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
import { defaultGameConfig, type BotAlgorithm, type GameConfig } from '../lib/gameConfig';

export type { BotAlgorithm, GameConfig, RoundLimit } from '../lib/gameConfig';
export { DEFAULT_ROUND_LIMIT, MAX_BOTS, MAX_HUMANS, MIN_BOTS, MIN_HUMANS, MIN_TOTAL_PLAYERS, ROUND_LIMIT_OPTIONS } from '../lib/gameConfig';

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

// Nombre por defecto de cada jugador humano: con 1 solo (el caso más común,
// antes el único posible), "Tú"; con varios —turno rotatorio en el mismo
// dispositivo, ver el "pase y juega" en App.tsx— numerados para
// distinguirlos en el marcador.
function humanName(index: number, total: number): string {
  return total === 1 ? 'Tú' : `Jugador ${index + 1}`;
}

function newGame(config: GameConfig): GameState {
  const humans = Array.from({ length: config.numHumans }, (_, i) => ({
    id: `human-${i}`,
    name: humanName(i, config.numHumans),
    deck: buildStarterDeck(),
  }));
  const bots = config.botAlgorithms.map((_, i) => ({
    id: `bot-${i}`,
    name: `Bot ${i + 1}`,
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
  humanTurn: boolean;
  legalActions: Action[];
  scores: PlayerScore[];
  canRestartTurn: boolean;
  botAlgorithms: Record<string, BotAlgorithm>;
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
  const [tick, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);
  const [botAlgorithms, setBotAlgorithms] = useState<Record<string, BotAlgorithm>>({});

  const state = stateRef.current;

  // El motor muta el GameState en el sitio; después de cada acción (propia
  // o de un bot) forzamos un re-render. Este efecto, sin dependencias, se
  // reevalúa tras cada render: mientras el turno activo sea de un bot,
  // encadena sus acciones automáticamente hasta que vuelva a tocarle a algún
  // humano o termine la partida. No hace nada mientras se está en el
  // formulario de creación (phase 'setup'): el placeholder de arriba nunca
  // debe jugarse solo.
  useEffect(() => {
    if (phase !== 'playing' || state.gameOver) return;

    if (humanIds.includes(getActivePlayer(state).id)) {
      // Justo al empezar el turno de un humano (todavía sin ninguna acción
      // suya aplicada) se guarda la foto para poder volver aquí.
      if (turnSnapshotRef.current?.turn !== state.turn) {
        turnSnapshotRef.current = { turn: state.turn, snapshot: structuredClone(state) };
      }
      return;
    }

    let guard = 0;
    let acted = false;
    while (!state.gameOver && !humanIds.includes(getActivePlayer(state).id) && guard < 1000) {
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
    if (guard >= 1000 && !state.gameOver && !humanIds.includes(getActivePlayer(state).id)) {
      const warning = '[bot] Límite global de 1000 acciones encadenadas alcanzado: se corta el autoplay para revisar.';
      // eslint-disable-next-line no-console
      console.warn(warning);
      postGameLog([warning]);
    }
    if (acted) rerender();
  });

  const humanTurn = phase === 'playing' && !state.gameOver && humanIds.includes(getActivePlayer(state).id);
  const legalActions = humanTurn ? getLegalActions(state, getActivePlayer(state).id) : [];
  const scores = scoreGame(state);
  const canRestartTurn = humanTurn && turnSnapshotRef.current?.turn === state.turn;

  function doAction(action: Action) {
    if (!humanTurn) return;
    const player = getActivePlayer(state);
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
    humanTurn,
    legalActions,
    scores,
    canRestartTurn,
    botAlgorithms,
    tick,
    startGame,
    doAction,
    restart,
    restartTurn,
    setBotAlgorithm,
  };
}
