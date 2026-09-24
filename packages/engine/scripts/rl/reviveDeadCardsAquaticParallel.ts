// Rescate de cartas hundidas SOLO para el especialista ACUÁTICO de la
// completa (2026-09-24, pedido explícito del usuario: no tocar general/land/
// bird), con la recogida de partidas repartida en paralelo entre varios
// procesos worker (reviveWorkerAquatic.ts) en vez de secuencial como
// reviveDeadCardsFull.ts — para poder permitirse muchas más partidas (2000
// en vez de 60) en un tiempo razonable. La regresión final se hace una sola
// vez, en este proceso, sobre TODAS las muestras juntas.
// Uso: npx vite-node scripts/rl/reviveDeadCardsAquaticParallel.ts [partidas=2000] [hilos=10] [maxEpocas=400]
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { encodeAction, FEATURE_DIM_FULL } from '../../src/bots/rl/featuresFull';
import { forward, serializeWeights, type RlWeights } from '../../src/bots/rl/network';
import { getCard } from '../../src/cards/registry';
import { createGame, getActivePlayer } from '../../src/engine';
import { accumulateGrad, applyGrad, scaleGrad, zeroGrad } from './train';
import { buildStarterDeck } from './trainCore';
import { loadOrInitWeights, saveWeightsWithRetry } from './weightsIo';

const GAMES = Number(process.argv[2] ?? 2000);
const THREADS = Number(process.argv[3] ?? 10);
const MAX_EPOCHS = Number(process.argv[4] ?? 400);
const LEARNING_RATE = Number(process.env.RL_REVIVE_LR ?? 0.01);
const TARGET_SHORTFALL = 0.5;
const HIDDEN_SIZE = 48;

const WEIGHTS_PATH = fileURLToPath(new URL('../../src/bots/rl/weights-full-aquatic.json', import.meta.url));
const VITE_NODE_ENTRY = fileURLToPath(new URL('../../../../node_modules/vite-node/vite-node.mjs', import.meta.url));
const ENGINE_DIR = fileURLToPath(new URL('../../', import.meta.url));

interface Sample {
  features: number[];
  target: number;
  raised: boolean;
}
interface WorkerResult {
  samples: Sample[];
  decisions: number;
  sunk: number;
}

function splitEvenly(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const rest = total % parts;
  return Array.from({ length: parts }, (_, i) => base + (i < rest ? 1 : 0));
}

function runWorker(weights: RlWeights, games: number): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [VITE_NODE_ENTRY, 'scripts/rl/reviveWorkerAquatic.ts'], {
      cwd: ENGINE_DIR,
      env: process.env,
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    const lineReader = createInterface({ input: child.stdout });
    lineReader.on('line', (line) => {
      resolve(JSON.parse(line) as WorkerResult);
      child.kill();
    });
    child.on('exit', (code, signal) => {
      reject(new Error(`Worker de rescate terminó inesperadamente (code=${code}, signal=${signal})`));
    });
    child.stdin.write(`${JSON.stringify({ weights: JSON.parse(serializeWeights(weights)), games })}\n`);
  });
}

function measure(weights: RlWeights, samples: Sample[]): { shortfall: number; drift: number; shift: number } {
  const scores = samples.map((s) => forward(weights, s.features).score);
  let shiftSum = 0;
  let anchorCount = 0;
  samples.forEach((s, i) => {
    if (!s.raised) {
      shiftSum += scores[i] - s.target;
      anchorCount++;
    }
  });
  const shift = anchorCount ? shiftSum / anchorCount : 0;
  let shortfall = 0;
  let raisedCount = 0;
  let drift = 0;
  samples.forEach((s, i) => {
    if (s.raised) {
      shortfall += Math.max(0, s.target + shift - scores[i]);
      raisedCount++;
    } else {
      drift += Math.abs(scores[i] - s.target - shift);
    }
  });
  return { shortfall: raisedCount ? shortfall / raisedCount : 0, drift: anchorCount ? drift / anchorCount : 0, shift };
}

function regress(weights: RlWeights, samples: Sample[]): void {
  for (let epoch = 0; epoch < MAX_EPOCHS; epoch++) {
    const grad = zeroGrad(weights.featureDim, weights.hiddenSize);
    for (const s of samples) {
      const { hidden, score } = forward(weights, s.features);
      accumulateGrad(grad, s.features, hidden, weights.w2, s.target - score);
    }
    scaleGrad(grad, 1 / samples.length);
    applyGrad(weights, grad, LEARNING_RATE);

    if (epoch % 20 === 0 || epoch === MAX_EPOCHS - 1) {
      const { shortfall, drift, shift } = measure(weights, samples);
      console.log(`  época ${epoch}: déficit medio hundidas=${shortfall.toFixed(2)} deriva media anclas=${drift.toFixed(2)} (desplazamiento global ${shift.toFixed(1)})`);
      if (shortfall < TARGET_SHORTFALL) break;
    }
  }
}

function referenceState() {
  const inst = (id: string, n: string | number) => ({ ...getCard(id), instanceId: `${id}#${n}` });
  const state = createGame(
    [
      { id: 'p0', name: 'P0', deck: buildStarterDeck() },
      { id: 'p1', name: 'P1', deck: buildStarterDeck() },
    ],
    { maxRounds: 15, edition: 'full' }
  );
  const player = getActivePlayer(state);
  player.hand = [inst('coin-1', 'a'), inst('coin-1', 'b'), inst('coin-1', 'c'), inst('coin-1', 'd')];
  player.deck = [];
  player.discard = [];
  return state;
}

const WATCH_SPECIES = ['golden-fish', 'seal', 'penguin', 'dolphin', 'platypus', 'otter'];

function printReference(label: string, weights: RlWeights): void {
  const state = referenceState();
  const player = getActivePlayer(state);
  const parts = WATCH_SPECIES.map((species) => {
    const card = state.animalTrack.find((a) => a.species === species);
    if (!card) return `${species}=?`;
    const score = forward(weights, encodeAction(state, player.id, { type: 'buyAnimal', trackInstanceId: card.instanceId })).score;
    return `${species}=${score.toFixed(1)}`;
  });
  const endTurn = forward(weights, encodeAction(state, player.id, { type: 'endTurn' })).score;
  console.log(`  referencia (${label}): ${parts.join(' ')} endTurn=${endTurn.toFixed(1)}`);
}

async function main(): Promise<void> {
  const weights = loadOrInitWeights(WEIGHTS_PATH, FEATURE_DIM_FULL, HIDDEN_SIZE);
  console.log(`=== aquatic (weights-full-aquatic.json) — ${GAMES} partidas en ${THREADS} hilos ===`);
  printReference('antes', weights);

  const shares = splitEvenly(GAMES, THREADS);
  const results = await Promise.all(shares.map((share) => runWorker(weights, share)));

  const samples = results.flatMap((r) => r.samples);
  const decisions = results.reduce((sum, r) => sum + r.decisions, 0);
  const sunk = results.reduce((sum, r) => sum + r.sunk, 0);
  console.log(`  ${GAMES} partidas, ${decisions} decisiones de compra, ${samples.length} candidatas, ${sunk} compras por debajo de endTurn`);

  if (sunk > 0) regress(weights, samples);

  printReference('después', weights);
  await saveWeightsWithRetry(weights, WEIGHTS_PATH);
  console.log(`  guardado ${WEIGHTS_PATH} (featureDim=${weights.featureDim})`);
}

main();
