// Rescate quirúrgico "por referencia" (2026-09-22, pedido explícito del
// usuario): en vez de compararla contra la mejor alternativa cualquiera de
// cada decisión (reviveCandidateFull.ts), sube una carta hundida hasta
// IGUALAR lo que puntúa OTRA carta de referencia ya sana, en las mismas
// decisiones donde ambas son candidatas a la vez — "ponle a la Foca los
// mismos valores que al Pez Dorado como inicio, a partir de ahí que
// evolucione [con el entrenamiento normal]". Mismas salvaguardas que
// reviveCandidateFull.ts (freno de deriva de anclas, tope de salto por
// llamada): un hueco pequeño se resuelve en una pasada, uno profundo
// necesita varias llamadas seguidas, comprobando después de cada una.
//
// Uso: npx vite-node scripts/rl/matchReferenceCardFull.ts <especie a rescatar> <especie de referencia> <general|land|bird|aquatic> [partidas=80] [maxEpocas=150]
import { fileURLToPath } from 'node:url';
import { filterActionsByHabitat, filterUpgradeChoicesForRl, legalActionsForBot } from '../../src/bots/actionPriority';
import { heuristicBot } from '../../src/bots/heuristicBot';
import { encodeAction, encodeActionsForPlayer, FEATURE_DIM_FULL } from '../../src/bots/rl/featuresFull';
import { forward, type RlWeights } from '../../src/bots/rl/network';
import { getCard } from '../../src/cards/registry';
import { applyAction, autoResolvePendingDiscard, createGame, getActivePlayer } from '../../src/engine';
import { accumulateGrad, applyGrad, scaleGrad, zeroGrad } from './train';
import { buildStarterDeck, randomMaxRounds } from './trainCore';
import { loadOrInitWeights, saveWeightsWithRetry } from './weightsIo';

type Habitat = 'land' | 'bird' | 'aquatic';

const RESCUE_SPECIES = process.argv[2];
const REFERENCE_SPECIES = process.argv[3];
const VARIANT = process.argv[4] as 'general' | Habitat;
const GAMES = Number(process.argv[5] ?? 80);
const MAX_EPOCHS = Number(process.argv[6] ?? 150);
if (!RESCUE_SPECIES || !REFERENCE_SPECIES || !['general', 'land', 'bird', 'aquatic'].includes(VARIANT)) {
  throw new Error(
    'Uso: npx vite-node scripts/rl/matchReferenceCardFull.ts <especie a rescatar> <especie de referencia> <general|land|bird|aquatic> [partidas] [maxEpocas]'
  );
}
const HABITAT: Habitat | undefined = VARIANT === 'general' ? undefined : VARIANT;
const WEIGHTS_FILE = VARIANT === 'general' ? 'weights-full.json' : `weights-full-${VARIANT}.json`;

const MAX_ACTIONS_PER_GAME = 400;
const LEARNING_RATE = Number(process.env.RL_REVIVE_LR ?? 0.01);
const TARGET_SHORTFALL = 0.5;
const MAX_ANCHOR_DRIFT = Number(process.env.RL_REVIVE_MAX_DRIFT ?? 2);
const MAX_TARGET_JUMP = Number(process.env.RL_REVIVE_MAX_JUMP ?? 15);
const HIDDEN_SIZE = 48;

interface Sample {
  features: number[];
  target: number;
  raised: boolean;
}

function collectSamples(weights: RlWeights): { samples: Sample[]; decisionsWithBoth: number; raised: number } {
  const samples: Sample[] = [];
  let decisionsWithBoth = 0;
  let raised = 0;

  for (let g = 0; g < GAMES; g++) {
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

      let actions = legalActionsForBot(state, player.id);
      if (HABITAT) actions = filterActionsByHabitat(state, actions, HABITAT);
      actions = filterUpgradeChoicesForRl(state, player.id, actions);
      if (actions.length === 0) break;
      const allFeatures = encodeActionsForPlayer(state, player.id, actions);
      const scores = allFeatures.map((x) => forward(weights, x).score);

      const rescueIdx = actions.findIndex(
        (a) => a.type === 'buyAnimal' && state.animalTrack.find((c) => c.instanceId === a.trackInstanceId)?.species === RESCUE_SPECIES
      );
      const referenceIdx = actions.findIndex(
        (a) => a.type === 'buyAnimal' && state.animalTrack.find((c) => c.instanceId === a.trackInstanceId)?.species === REFERENCE_SPECIES
      );
      if (rescueIdx !== -1 && referenceIdx !== -1) {
        decisionsWithBoth++;
        const referenceScore = scores[referenceIdx];
        const isRaised = scores[rescueIdx] < referenceScore;
        if (isRaised) raised++;
        const cappedTarget = isRaised ? Math.min(referenceScore, scores[rescueIdx] + MAX_TARGET_JUMP) : scores[rescueIdx];
        for (let k = 0; k < actions.length; k++) {
          const thisIsRescue = k === rescueIdx;
          samples.push({
            features: allFeatures[k],
            target: thisIsRescue ? cappedTarget : scores[k],
            raised: thisIsRescue && isRaised,
          });
        }
      }

      const best = Math.max(...scores);
      const bestIdx = scores.map((_, i) => i).filter((i) => scores[i] >= best - 1e-9);
      applyAction(state, player.id, actions[bestIdx[Math.floor(Math.random() * bestIdx.length)]]);
      guard++;
    }
  }

  return { samples, decisionsWithBoth, raised };
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

    const { shortfall, drift, shift } = measure(weights, samples);
    if (epoch % 10 === 0 || epoch === MAX_EPOCHS - 1) {
      console.log(`  época ${epoch}: déficit medio=${shortfall.toFixed(2)} deriva media anclas=${drift.toFixed(2)} (desplazamiento global ${shift.toFixed(1)})`);
    }
    if (drift > MAX_ANCHOR_DRIFT) {
      console.log(`  ¡deriva de anclas por encima de ${MAX_ANCHOR_DRIFT}! Parando aquí para no desestabilizar el resto.`);
      break;
    }
    if (shortfall < TARGET_SHORTFALL) break;
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

function printReference(label: string, weights: RlWeights): void {
  const state = referenceState();
  const player = getActivePlayer(state);
  const parts = [RESCUE_SPECIES, REFERENCE_SPECIES].map((species) => {
    const card = state.animalTrack.find((a) => a.species === species);
    if (!card) return `${species}=?`;
    const score = forward(weights, encodeAction(state, player.id, { type: 'buyAnimal', trackInstanceId: card.instanceId })).score;
    return `${species}=${score.toFixed(1)}`;
  });
  console.log(`  referencia (${label}): ${parts.join(' ')}`);
}

async function main(): Promise<void> {
  const path = fileURLToPath(new URL(`../../src/bots/rl/${WEIGHTS_FILE}`, import.meta.url));
  const weights = loadOrInitWeights(path, FEATURE_DIM_FULL, HIDDEN_SIZE);
  printReference('antes', weights);

  const { samples, decisionsWithBoth, raised } = collectSamples(weights);
  console.log(
    `${GAMES} partidas (${VARIANT}), ${decisionsWithBoth} decisiones con ${RESCUE_SPECIES} y ${REFERENCE_SPECIES} a la vez, ${raised} donde ${RESCUE_SPECIES} iba por detrás`
  );

  if (raised > 0) regress(weights, samples);
  else console.log(`Nada que rescatar: ${RESCUE_SPECIES} ya iguala o supera a ${REFERENCE_SPECIES} en las decisiones vistas.`);

  printReference('después', weights);
  await saveWeightsWithRetry(weights, path);
  console.log(`Guardado ${path}`);
}

main();
