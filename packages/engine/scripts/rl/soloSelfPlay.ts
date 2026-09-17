// Experimento puntual pedido por el usuario (2026-09-17): entrenar un
// especialista (por defecto bird, vía RL_HABITAT) jugando SIEMPRE EN
// SOLITARIO (1 asiento, sin los otros 3 especialistas como rivales fijos —
// ver trainCoreSolo.ts para el porqué y por qué esto vive fuera de
// trainCore.ts/selfPlay.ts). NUNCA toca weights-<habitat>.json ni
// critic-<habitat>.json (los pesos de producción, committeados): guarda en
// weights-<habitat>-solo.json / critic-<habitat>-solo.json, así que este
// experimento no puede corromper ni sustituir sin querer al bot real.
//
// Uso: RL_HABITAT=bird npx vite-node scripts/rl/soloSelfPlay.ts
// Variables: RL_EPISODES (episodios por batch, def. 1000), RL_BATCHES
// (batches, def. 10 -> 10000 episodios totales), RL_WORKERS (def. 10, tal
// como pidió el usuario), resto de variables igual que selfPlay.ts
// (RL_LR, RL_CRITIC_LR, RL_MAX_NORM_W1/W2, RL_OPTIMIZER, RL_SHAPING_WEIGHT,
// RL_EPSILON).
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { heuristicBot } from '../../src/bots/heuristicBot';
import { randomBot } from '../../src/bots/randomBot';
import { CRITIC_FEATURE_DIM, FEATURE_DIM } from '../../src/bots/rl/features';
import { serializeWeights, type RlWeights } from '../../src/bots/rl/network';
import { applyAction, autoResolvePendingDiscard, createGame, getActivePlayer } from '../../src/engine';
import { scoreGame } from '../../src/scoring';
import type { Bot } from '../../src/bots/types';
import { addGrad, applyGrad, applyGradAdam, clampWeightNorms, createAdamState, deserializeGradient, scaleGrad, zeroGrad, type AdamState } from './train';
import { loadOrInitWeights, saveWeightsWithRetry } from './weightsIo';
import { buildStarterDeck, chooseLearnerAction, CURRENT_VARIANT, EPSILON, HABITAT_FILTER, MAX_ACTIONS_PER_GAME, randomMaxRounds, SHAPING_WEIGHT, type EpisodeBatchResult } from './trainCore';
import { runEpisodesSolo } from './trainCoreSolo';

const HIDDEN_SIZE = 48;
const LEARNING_RATE = Number(process.env.RL_LR ?? 0.01);
const EPISODES_PER_BATCH = Number(process.env.RL_EPISODES ?? 1000);
const TOTAL_BATCHES = Number(process.env.RL_BATCHES ?? 10);
const CRITIC_HIDDEN_SIZE = 16;
const CRITIC_LR = Number(process.env.RL_CRITIC_LR ?? 0.02);
const POLICY_OPTIMIZER = process.env.RL_OPTIMIZER === 'adam' ? 'adam' : 'sgd';
const MAX_NORM_W1 = Number(process.env.RL_MAX_NORM_W1 ?? 16);
const MAX_NORM_W2 = Number(process.env.RL_MAX_NORM_W2 ?? 16);
const EVAL_GAMES = Number(process.env.RL_EVAL_GAMES ?? 40);
// Pedido explícito del usuario: 10 hilos en paralelo (selfPlay.ts usa 2 por
// defecto, pensado para correr las 4 variantes de producción a la vez).
const WORKER_COUNT = Number(process.env.RL_WORKERS ?? 10);

// CURRENT_VARIANT (trainCore.ts) es 'general' cuando no hay RL_HABITAT, y el
// propio nombre del hábitat si lo hay — así "general" también tiene su
// weights-general-solo.json/critic-general-solo.json en vez de intentar
// escribir a weights--solo.json.
const WEIGHTS_PATH = fileURLToPath(new URL(`../../src/bots/rl/weights-${CURRENT_VARIANT}-solo.json`, import.meta.url));
const CRITIC_PATH = fileURLToPath(new URL(`./critic-${CURRENT_VARIANT}-solo.json`, import.meta.url));

const VITE_NODE_ENTRY = fileURLToPath(new URL('../../../../node_modules/vite-node/vite-node.mjs', import.meta.url));
const ENGINE_DIR = fileURLToPath(new URL('../../', import.meta.url));

interface WorkerHandle {
  send(msg: { weights: unknown; criticWeights: unknown; episodes: number }): Promise<EpisodeBatchResult>;
  kill(): void;
}

function spawnWorker(): WorkerHandle {
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [VITE_NODE_ENTRY, 'scripts/rl/workerSolo.ts'], {
    cwd: ENGINE_DIR,
    env: process.env,
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  const pending: ((line: string) => void)[] = [];
  const pendingErrors: ((err: Error) => void)[] = [];
  const lineReader = createInterface({ input: child.stdout });
  lineReader.on('line', (line) => {
    const resolve = pending.shift();
    pendingErrors.shift();
    resolve?.(line);
  });
  child.on('exit', (code, signal) => {
    const err = new Error(`Worker RL (solo) terminó inesperadamente (code=${code}, signal=${signal})`);
    while (pendingErrors.length > 0) pendingErrors.shift()?.(err);
  });

  return {
    send(msg) {
      return new Promise((resolve, reject) => {
        pending.push((line) => {
          const raw = JSON.parse(line) as Omit<EpisodeBatchResult, 'grad' | 'criticGrad'> & {
            grad: Parameters<typeof deserializeGradient>[0];
            criticGrad: Parameters<typeof deserializeGradient>[0];
          };
          resolve({ ...raw, grad: deserializeGradient(raw.grad), criticGrad: deserializeGradient(raw.criticGrad) });
        });
        pendingErrors.push(reject);
        child.stdin.write(`${JSON.stringify(msg)}\n`);
      });
    },
    kill() {
      child.stdin.end();
      child.kill();
    },
  };
}

const workers: WorkerHandle[] = Array.from({ length: WORKER_COUNT }, () => spawnWorker());

function splitEvenly(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const remainder = total % parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

function mergeEpisodeResults(results: EpisodeBatchResult[], weights: RlWeights, criticWeights: RlWeights): EpisodeBatchResult {
  const grad = zeroGrad(weights.featureDim, weights.hiddenSize);
  const criticGrad = zeroGrad(criticWeights.featureDim, criticWeights.hiddenSize);
  let episodesUsed = 0;
  let sumAbsAdvantage = 0;
  let sumReturn = 0;
  let stepCount = 0;

  for (const r of results) {
    addGrad(grad, r.grad);
    addGrad(criticGrad, r.criticGrad);
    episodesUsed += r.episodesUsed;
    sumAbsAdvantage += r.sumAbsAdvantage;
    sumReturn += r.sumReturn;
    stepCount += r.stepCount;
  }

  return { grad, criticGrad, sumAbsAdvantage, sumReturn, stepCount, episodesUsed };
}

async function trainBatch(
  weights: RlWeights,
  criticWeights: RlWeights,
  policyAdam: AdamState,
  criticAdam: AdamState
): Promise<{ avgAbsAdvantage: number; avgReturn: number }> {
  const shares = splitEvenly(EPISODES_PER_BATCH, WORKER_COUNT + 1);
  const serializedWeights = serializeWeights(weights);
  const serializedCriticWeights = serializeWeights(criticWeights);

  const workerPromises = workers.map((worker, i) =>
    worker.send({
      weights: JSON.parse(serializedWeights),
      criticWeights: JSON.parse(serializedCriticWeights),
      episodes: shares[i],
    })
  );
  const ownResult = runEpisodesSolo(weights, criticWeights, shares[WORKER_COUNT]);
  const workerResults = await Promise.all(workerPromises);

  const merged = mergeEpisodeResults([ownResult, ...workerResults], weights, criticWeights);

  scaleGrad(merged.grad, 1 / Math.max(1, merged.episodesUsed));
  if (POLICY_OPTIMIZER === 'adam') applyGradAdam(weights, merged.grad, policyAdam, LEARNING_RATE);
  else applyGrad(weights, merged.grad, LEARNING_RATE);
  clampWeightNorms(weights, MAX_NORM_W1, MAX_NORM_W2);
  scaleGrad(merged.criticGrad, 1 / Math.max(1, merged.stepCount));
  applyGradAdam(criticWeights, merged.criticGrad, criticAdam, CRITIC_LR);

  return {
    avgAbsAdvantage: merged.stepCount > 0 ? merged.sumAbsAdvantage / merged.stepCount : 0,
    avgReturn: merged.episodesUsed > 0 ? merged.sumReturn / merged.episodesUsed : 0,
  };
}

// Igual que evaluate() en selfPlay.ts (1v1 greedy contra un rival fijo, no
// solitario: si no, un heuristicBot/randomBot sin rival tampoco tendría con
// qué compararse). Solo para seguimiento de progreso, nunca entra en el
// gradiente.
function evaluate(weights: RlWeights, opponent: Bot, games: number): number {
  let wins = 0;
  for (let i = 0; i < games; i++) {
    const configs = [
      { id: 'learner', name: 'Learner', deck: buildStarterDeck() },
      { id: 'opponent', name: 'Opponent', deck: buildStarterDeck() },
    ];
    if (i % 2 !== 0) configs.reverse();
    const state = createGame(configs, { maxRounds: randomMaxRounds() });
    let guard = 0;
    while (!state.gameOver && guard < MAX_ACTIONS_PER_GAME) {
      if (autoResolvePendingDiscard(state)) {
        guard++;
        continue;
      }
      const player = getActivePlayer(state);
      const action =
        player.id === 'learner' ? chooseLearnerAction(state, player.id, weights) : opponent.chooseAction(state, player.id);
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

function weightNorm(weights: RlWeights): { w1: number; w2: number } {
  let sqW1 = 0;
  for (const row of weights.w1) for (let i = 0; i < row.length; i++) sqW1 += row[i] * row[i];
  let sqW2 = 0;
  for (let j = 0; j < weights.w2.length; j++) sqW2 += weights.w2[j] * weights.w2[j];
  return { w1: Math.sqrt(sqW1), w2: Math.sqrt(sqW2) };
}

async function main(): Promise<void> {
  const weights = loadOrInitWeights(WEIGHTS_PATH, FEATURE_DIM, HIDDEN_SIZE);
  const criticWeights = loadOrInitWeights(CRITIC_PATH, CRITIC_FEATURE_DIM, CRITIC_HIDDEN_SIZE);
  const policyAdam = createAdamState(weights.featureDim, weights.hiddenSize);
  const criticAdam = createAdamState(criticWeights.featureDim, criticWeights.hiddenSize);

  const prodFile = HABITAT_FILTER ? `weights-${HABITAT_FILTER}.json` : 'weights.json';
  console.log(
    `Entrenando rlBot EN SOLITARIO (variante: ${CURRENT_VARIANT}): ${TOTAL_BATCHES} batches x ${EPISODES_PER_BATCH} partidas ` +
      `(${TOTAL_BATCHES * EPISODES_PER_BATCH} episodios totales), optimizador=${POLICY_OPTIMIZER}, max_norm_w1=${MAX_NORM_W1}, ` +
      `max_norm_w2=${MAX_NORM_W2}, lr=${LEARNING_RATE}, critic_lr=${CRITIC_LR}, epsilon=${EPSILON}, shaping=${SHAPING_WEIGHT}, workers=${WORKER_COUNT}\n` +
      `Guardando en ${WEIGHTS_PATH} (NUNCA toca el ${prodFile} de producción).`
  );

  try {
    for (let batch = 0; batch < TOTAL_BATCHES; batch++) {
      const { avgAbsAdvantage, avgReturn } = await trainBatch(weights, criticWeights, policyAdam, criticAdam);

      const winrateVsHeuristic = evaluate(weights, heuristicBot, EVAL_GAMES);
      const winrateVsRandom = evaluate(weights, randomBot, EVAL_GAMES);
      const norm = weightNorm(weights);
      console.log(
        `episodios=${(batch + 1) * EPISODES_PER_BATCH} avg_return=${avgReturn.toFixed(3)} critic_avg_abs_advantage=${avgAbsAdvantage.toFixed(3)} ` +
          `winrate_vs_heuristic=${winrateVsHeuristic.toFixed(2)} winrate_vs_random=${winrateVsRandom.toFixed(2)} |w1|=${norm.w1.toFixed(2)} |w2|=${norm.w2.toFixed(2)}`
      );
      await saveWeightsWithRetry(weights, WEIGHTS_PATH);
      await saveWeightsWithRetry(criticWeights, CRITIC_PATH);
    }

    console.log('Entrenamiento en solitario terminado. Pesos guardados en', WEIGHTS_PATH, 'y', CRITIC_PATH);
  } finally {
    for (const worker of workers) worker.kill();
  }
}

main();
