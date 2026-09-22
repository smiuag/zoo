// Versión de reviveDeadCards.ts para la EDICIÓN COMPLETA — pedido explícito
// del usuario 2026-09-22, a raíz del Pez Dorado muerto en el especialista
// acuático (0% de compras en 200 partidas) mientras el generalista, con la
// MISMA fórmula de recompensa, lo compraba el 10.59% de las veces: mismo
// diagnóstico que el Tucán en su día (rescate supervisado corto sobre los
// pesos ya entrenados), pero con el codificador/pesos de la completa.
// Ver reviveDeadCards.ts para la explicación completa del método —
// idéntico aquí, solo cambia el codificador (featuresFull) y los bots/pesos
// (rlBotFull-family).
//
// Uso: npx vite-node scripts/rl/reviveDeadCardsFull.ts [partidas=60] [maxEpocas=400]
import { fileURLToPath } from 'node:url';
import { filterActionsByHabitat, filterUpgradeChoicesForRl, legalActionsForBot } from '../../src/bots/actionPriority';
import { heuristicBot } from '../../src/bots/heuristicBot';
import { encodeAction, encodeActionsForPlayer, FEATURE_DIM_FULL } from '../../src/bots/rl/featuresFull';
import { forward, type RlWeights } from '../../src/bots/rl/network';
import { getCard } from '../../src/cards/registry';
import { applyAction, autoResolvePendingDiscard, createGame, getActivePlayer, type Action } from '../../src/engine';
import { accumulateGrad, applyGrad, scaleGrad, zeroGrad } from './train';
import { buildStarterDeck, randomMaxRounds } from './trainCore';
import { loadOrInitWeights, saveWeightsWithRetry } from './weightsIo';

const GAMES_PER_VARIANT = Number(process.argv[2] ?? 60);
const MAX_EPOCHS = Number(process.argv[3] ?? 400);
const MAX_ACTIONS_PER_GAME = 400;
const LEARNING_RATE = Number(process.env.RL_REVIVE_LR ?? 0.01);
const TARGET_SHORTFALL = 0.5;
const HIDDEN_SIZE = 48;

type Habitat = 'land' | 'bird' | 'aquatic';
const VARIANTS: { label: string; file: string; habitat?: Habitat }[] = [
  { label: 'general', file: 'weights-full.json' },
  { label: 'land', file: 'weights-full-land.json', habitat: 'land' },
  { label: 'bird', file: 'weights-full-bird.json', habitat: 'bird' },
  { label: 'aquatic', file: 'weights-full-aquatic.json', habitat: 'aquatic' },
];

interface Sample {
  features: number[];
  target: number;
  raised: boolean;
}

function learnerActions(state: ReturnType<typeof createGame>, playerId: string, habitat?: Habitat): Action[] {
  let actions = legalActionsForBot(state, playerId);
  if (habitat) actions = filterActionsByHabitat(state, actions, habitat);
  return filterUpgradeChoicesForRl(state, playerId, actions);
}

function collectSamples(weights: RlWeights, habitat: Habitat | undefined, games: number): { samples: Sample[]; decisions: number; sunk: number } {
  const samples: Sample[] = [];
  let decisions = 0;
  let sunk = 0;

  for (let g = 0; g < games; g++) {
    const seatId = `p${g % 4}`;
    const playerConfigs = Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, deck: buildStarterDeck() }));
    const state = createGame(playerConfigs, { maxRounds: randomMaxRounds(), edition: 'full' });

    let guard = 0;
    while (!state.gameOver && guard < MAX_ACTIONS_PER_GAME) {
      if (autoResolvePendingDiscard(state)) {
        guard++;
        continue;
      }
      const player = getActivePlayer(state);
      if (player.id !== seatId) {
        applyAction(state, player.id, heuristicBot.chooseAction(state, player.id));
        guard++;
        continue;
      }

      const actions = learnerActions(state, player.id, habitat);
      if (actions.length === 0) break;
      const allFeatures = encodeActionsForPlayer(state, player.id, actions);
      const scores = allFeatures.map((x) => forward(weights, x).score);

      const endTurnIndex = actions.findIndex((a) => a.type === 'endTurn');
      if (endTurnIndex !== -1) {
        decisions++;
        const floor = scores[endTurnIndex];
        for (let k = 0; k < actions.length; k++) {
          const raised = actions[k].type === 'buyAnimal' && scores[k] < floor;
          if (raised) sunk++;
          samples.push({ features: allFeatures[k], target: raised ? floor : scores[k], raised });
        }
      }

      const best = Math.max(...scores);
      const bestIdx = scores.map((_, i) => i).filter((i) => scores[i] >= best - 1e-9);
      applyAction(state, player.id, actions[bestIdx[Math.floor(Math.random() * bestIdx.length)]]);
      guard++;
    }
  }

  return { samples, decisions, sunk };
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

// Referencia: turno temprano, solo Bronces en mano — el estado exacto donde
// el Pez Dorado debería brillar (ver diagnóstico 2026-09-22).
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
  for (const variant of VARIANTS) {
    const path = fileURLToPath(new URL(`../../src/bots/rl/${variant.file}`, import.meta.url));
    const weights = loadOrInitWeights(path, FEATURE_DIM_FULL, HIDDEN_SIZE);
    console.log(`\n=== ${variant.label} (${variant.file}) ===`);
    printReference('antes', weights);

    const { samples, decisions, sunk } = collectSamples(weights, variant.habitat, GAMES_PER_VARIANT);
    console.log(`  ${GAMES_PER_VARIANT} partidas, ${decisions} decisiones de compra, ${samples.length} candidatas, ${sunk} compras por debajo de endTurn`);
    if (sunk > 0) regress(weights, samples);

    printReference('después', weights);
    await saveWeightsWithRetry(weights, path);
    console.log(`  guardado ${path} (featureDim=${weights.featureDim})`);
  }
}

main();
