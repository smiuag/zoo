// Entrenamiento por self-play del rlBot. Se ejecuta con vite-node (no
// node/tsx a secas: cards/registry.ts usa import.meta.glob, una API solo de
// Vite) vía `npm run train:rl -w packages/engine`. Nunca se importa desde
// src/index.ts ni desde apps/web: es una herramienta de desarrollo, no algo
// que la app o el motor necesiten en tiempo de ejecución normal.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { animalBuyerBot } from '../../src/bots/animalBuyerBot';
import { expensiveFirstBot } from '../../src/bots/expensiveFirstBot';
import { heuristicBot } from '../../src/bots/heuristicBot';
import { randomBot } from '../../src/bots/randomBot';
import { encodeAction, FEATURE_DIM } from '../../src/bots/rl/features';
import { createRandomWeights, deserializeWeights, forward, serializeWeights, type RlWeights } from '../../src/bots/rl/network';
import type { Bot } from '../../src/bots/types';
import { getCard } from '../../src/cards/registry';
import type { Card } from '../../src/cards/schema';
import { applyAction, autoResolvePendingDiscard, createGame, getActivePlayer, getLegalActions, type Action } from '../../src/engine';
import type { GameState } from '../../src/model/state';
import { scoreGame, type PlayerScore } from '../../src/scoring';
import { accumulateGrad, applyGrad, softmax, zeroGrad } from './train';
import { computeReturn } from './reward';

const HIDDEN_SIZE = 32;
const LEARNING_RATE = Number(process.env.RL_LR ?? 0.01);
const TRAIN_TEMPERATURE = 1;
const EPISODES_PER_BATCH = Number(process.env.RL_EPISODES ?? 32);
const TOTAL_BATCHES = Number(process.env.RL_BATCHES ?? 2000);
const BASELINE_BETA = 0.02;
const EVAL_EVERY = Number(process.env.RL_EVAL_EVERY ?? 50);
const EVAL_GAMES = Number(process.env.RL_EVAL_GAMES ?? 40);
const MAX_ACTIONS_PER_GAME = 400;

// Entrena un especialista de hábitat (RL_HABITAT=land|bird|aquatic): el
// aprendiz (en self-play Y en curriculum, nunca los oponentes fijos) solo
// puede comprar animales de ese hábitat, en TODAS las partidas de
// entrenamiento y evaluación. Sin la variable, entrena el bot normal sin
// restricciones. Cada especialista guarda sus propios pesos, nunca
// sobrescribe weights.json.
const HABITAT_FILTER = process.env.RL_HABITAT;
if (HABITAT_FILTER && !['land', 'bird', 'aquatic'].includes(HABITAT_FILTER)) {
  throw new Error(`RL_HABITAT inválido: "${HABITAT_FILTER}" (usa land, bird o aquatic)`);
}

const WEIGHTS_FILE = HABITAT_FILTER ? `weights-${HABITAT_FILTER}.json` : 'weights.json';
const WEIGHTS_PATH = fileURLToPath(new URL(`../../src/bots/rl/${WEIGHTS_FILE}`, import.meta.url));

const CURRICULUM_OPPONENTS: Bot[] = [randomBot, heuristicBot, expensiveFirstBot, animalBuyerBot];

function filterActionsForHabitat(state: GameState, actions: Action[]): Action[] {
  if (!HABITAT_FILTER) return actions;
  return actions.filter((a) => {
    if (a.type !== 'buyAnimal') return true;
    const animal = state.animalTrack.find((c) => c.instanceId === a.trackInstanceId);
    return (animal?.habitats as string[] | undefined)?.includes(HABITAT_FILTER) ?? false;
  });
}

// Puntúa y elige, en modo greedy (temperature 0), entre las acciones legales
// ya filtradas por hábitat. Sustituye a createRlBot en este script porque
// createRlBot no conoce el filtro de hábitat (es una restricción exclusiva
// del entrenamiento de especialistas, no del bot que se usa en la app).
function chooseLearnerAction(state: GameState, playerId: string, weights: RlWeights): Action {
  const actions = filterActionsForHabitat(state, getLegalActions(state, playerId));
  if (actions.length === 0) return { type: 'endTurn' };
  const scores = actions.map((a) => forward(weights, encodeAction(state, playerId, a)).score);
  const best = Math.max(...scores);
  const bestIdx = actions.map((_, i) => i).filter((i) => scores[i] >= best - 1e-9);
  return actions[bestIdx[Math.floor(Math.random() * bestIdx.length)]];
}

// Replica tests/helpers.ts / apps/web/src/lib/starterDeck.ts (no exportado
// desde el paquete, así que cada consumidor lo define localmente).
function buildStarterDeck(): Card[] {
  const coin1 = getCard('coin-1');
  const sloth = getCard('sloth');
  return [...Array.from({ length: 7 }, () => coin1), ...Array.from({ length: 3 }, () => sloth)];
}

function sampleIndex(scores: number[], temperature: number): number {
  const probs = softmax(scores.map((s) => s / temperature));
  let roll = Math.random();
  for (let i = 0; i < probs.length; i++) {
    roll -= probs[i];
    if (roll <= 0) return i;
  }
  return probs.length - 1;
}

interface Step {
  allFeatures: number[][];
  allHidden: number[][];
  allScores: number[];
  chosenIndex: number;
}

type Mode = 'selfplay' | 'curriculum';

// 1 de cada 5 partidas se juega contra los bots fijos (uno distinto al azar
// por rival) para variar el estilo de juego contra el que se entrena; el
// resto son self-play puro (los 4 asientos son el mismo aprendiz).
function pickMode(episodeIndex: number): Mode {
  return episodeIndex % 5 === 0 ? 'curriculum' : 'selfplay';
}

// Juega una partida completa y devuelve, por cada asiento que cuenta para
// el gradiente (todos en self-play; solo el asiento que no tiene un bot fijo
// asignado en modo curriculum), su lista de decision points.
function playOneGame(weights: RlWeights, mode: Mode): { trajectories: Map<string, Step[]>; finalScores: PlayerScore[] } {
  const playerConfigs = Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, deck: buildStarterDeck() }));
  const state = createGame(playerConfigs);

  const fixedOpponents = new Map<string, Bot>();
  if (mode === 'curriculum') {
    for (let i = 1; i < playerConfigs.length; i++) {
      const opponent = CURRICULUM_OPPONENTS[Math.floor(Math.random() * CURRICULUM_OPPONENTS.length)];
      fixedOpponents.set(playerConfigs[i].id, opponent);
    }
  }

  const trajectories = new Map<string, Step[]>();
  for (const cfg of playerConfigs) {
    if (!fixedOpponents.has(cfg.id)) trajectories.set(cfg.id, []);
  }

  let guard = 0;
  while (!state.gameOver && guard < MAX_ACTIONS_PER_GAME) {
    // Con un descarte pendiente (Buitre/Mono/Hiena/Murciélago), nadie tiene
    // ninguna acción legal hasta que se resuelva: sin esto, el bucle de
    // abajo vería `actions.length === 0` y cortaría el episodio de
    // entrenamiento en seco cada vez que se juegue una de esas cartas.
    if (autoResolvePendingDiscard(state)) {
      guard++;
      continue;
    }

    const player = getActivePlayer(state);
    const fixedBot = fixedOpponents.get(player.id);

    if (fixedBot) {
      applyAction(state, player.id, fixedBot.chooseAction(state, player.id));
      guard++;
      continue;
    }

    const actions = filterActionsForHabitat(state, getLegalActions(state, player.id));
    if (actions.length === 0) break;

    const allFeatures = actions.map((action) => encodeAction(state, player.id, action));
    const allForward = allFeatures.map((x) => forward(weights, x));
    const allScores = allForward.map((f) => f.score);
    const chosenIndex = sampleIndex(allScores, TRAIN_TEMPERATURE);

    trajectories.get(player.id)?.push({
      allFeatures,
      allHidden: allForward.map((f) => f.hidden),
      allScores,
      chosenIndex,
    });

    applyAction(state, player.id, actions[chosenIndex]);
    guard++;
  }

  return { trajectories, finalScores: scoreGame(state) };
}

function trainBatch(weights: RlWeights, baseline: { value: number }): void {
  const grad = zeroGrad(weights.featureDim, weights.hiddenSize);
  let episodesUsed = 0;

  for (let e = 0; e < EPISODES_PER_BATCH; e++) {
    const { trajectories, finalScores } = playOneGame(weights, pickMode(e));

    for (const [playerId, steps] of trajectories) {
      if (steps.length === 0) continue;

      const returnValue = computeReturn(finalScores, playerId);
      baseline.value += BASELINE_BETA * (returnValue - baseline.value);
      const advantage = returnValue - baseline.value;

      for (const step of steps) {
        const probs = softmax(step.allScores);
        for (let k = 0; k < probs.length; k++) {
          const delta = ((k === step.chosenIndex ? 1 : 0) - probs[k]) * advantage;
          accumulateGrad(grad, step.allFeatures[k], step.allHidden[k], weights.w2, delta);
        }
      }
      episodesUsed++;
    }
  }

  applyGrad(weights, grad, LEARNING_RATE / Math.max(1, episodesUsed));
}

// Partidas 1 contra 1 a temperatura 0 (juego determinista/greedy) para medir
// progreso real, alternando quién empieza para no sesgar por orden de turno.
function evaluate(weights: RlWeights, opponent: Bot, games: number): number {
  let wins = 0;

  for (let i = 0; i < games; i++) {
    const configs = [
      { id: 'learner', name: 'Learner', deck: buildStarterDeck() },
      { id: 'opponent', name: 'Opponent', deck: buildStarterDeck() },
    ];
    if (i % 2 !== 0) configs.reverse();

    const state = createGame(configs);

    let guard = 0;
    while (!state.gameOver && guard < MAX_ACTIONS_PER_GAME) {
      if (autoResolvePendingDiscard(state)) {
        guard++;
        continue;
      }
      const player = getActivePlayer(state);
      const action =
        player.id === 'learner'
          ? chooseLearnerAction(state, player.id, weights)
          : opponent.chooseAction(state, player.id);
      applyAction(state, player.id, action);
      guard++;
    }

    const scores = scoreGame(state);
    const learnerScore = scores.find((s) => s.playerId === 'learner')?.score ?? 0;
    const opponentScore = scores.find((s) => s.playerId === 'opponent')?.score ?? 0;
    if (learnerScore > opponentScore) wins += 1;
    else if (learnerScore === opponentScore) wins += 0.5;
  }

  return wins / games;
}

function loadOrInitWeights(): RlWeights {
  if (existsSync(WEIGHTS_PATH)) {
    try {
      return deserializeWeights(readFileSync(WEIGHTS_PATH, 'utf-8'));
    } catch {
      console.warn('weights.json existente es inválido, se reinicia desde pesos aleatorios.');
    }
  }
  return createRandomWeights(FEATURE_DIM, HIDDEN_SIZE);
}

function main(): void {
  const weights = loadOrInitWeights();
  const baseline = { value: 0 };

  const habitatLabel = HABITAT_FILTER ? ` (especialista: solo compra ${HABITAT_FILTER})` : '';
  console.log(
    `Entrenando rlBot${habitatLabel}: ${TOTAL_BATCHES} batches x ${EPISODES_PER_BATCH} partidas, lr=${LEARNING_RATE}`
  );

  for (let batch = 0; batch < TOTAL_BATCHES; batch++) {
    trainBatch(weights, baseline);

    if (batch % EVAL_EVERY === 0 || batch === TOTAL_BATCHES - 1) {
      const winrateVsHeuristic = evaluate(weights, heuristicBot, EVAL_GAMES);
      const winrateVsRandom = evaluate(weights, randomBot, EVAL_GAMES);
      console.log(
        `batch=${batch} baseline=${baseline.value.toFixed(3)} ` +
          `winrate_vs_heuristic=${winrateVsHeuristic.toFixed(2)} winrate_vs_random=${winrateVsRandom.toFixed(2)}`
      );
      writeFileSync(WEIGHTS_PATH, serializeWeights(weights));
    }
  }

  writeFileSync(WEIGHTS_PATH, serializeWeights(weights));
  console.log('Entrenamiento terminado. Pesos guardados en', WEIGHTS_PATH);
}

main();
