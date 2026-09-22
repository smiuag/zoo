// Rescate quirúrgico de UNA especie concreta para una variante de la
// completa (2026-09-22, a raíz del Pez Dorado muerto en el especialista
// acuático). El rescate genérico "sube lo que puntúa peor que terminar el
// turno" (reviveDeadCardsFull.ts) no sirve para este tipo de problema: la
// carta no puntúa peor que endTurn, puntúa peor que sus RIVALES directos a
// igual coste — y forzar el ancla genérica al primer intento (para el
// Tucán clásico, o el Pez Dorado con este mismo método) desestabilizó toda
// la red del generalista (deriva de anclas de +39 puntos, todo se
// desplomó). Aquí el objetivo es mucho más estrecho: solo las filas donde
// la especie elegida es una candidata se pueden mover, y solo hasta quedar
// COMPETITIVAS con la mejor alternativa de esa misma decisión (no forzarlas
// a ser siempre la mejor) — todo lo demás se ancla a su propio valor
// actual. Con una salvaguarda que el genérico no tenía: si la deriva media
// de las anclas se dispara, para YA aunque el déficit no haya bajado del
// todo (mejor un rescate parcial que desestabilizar el resto) — sin esto,
// el intento de rescatar la Foca (94.6% de decisiones "hundidas", mucho más
// agresivo que el Pez Dorado) empeoró su posición relativa en vez de
// mejorarla. Si el freno salta enseguida, revisa el resultado con cuidado
// antes de darlo por bueno — puede necesitar un LEARNING_RATE más bajo en
// vez de simplemente aceptarlo.
//
// Uso: npx vite-node scripts/rl/reviveCandidateFull.ts <especie> <general|land|bird|aquatic> [partidas=80] [maxEpocas=150]
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
const VARIANT = process.argv[3] as 'general' | Habitat;
const GAMES = Number(process.argv[4] ?? 80);
const MAX_EPOCHS = Number(process.argv[5] ?? 150);
if (!RESCUE_SPECIES || !['general', 'land', 'bird', 'aquatic'].includes(VARIANT)) {
  throw new Error('Uso: npx vite-node scripts/rl/reviveCandidateFull.ts <especie> <general|land|bird|aquatic> [partidas] [maxEpocas]');
}
const HABITAT: Habitat | undefined = VARIANT === 'general' ? undefined : VARIANT;
const WEIGHTS_FILE = VARIANT === 'general' ? 'weights-full.json' : `weights-full-${VARIANT}.json`;

const MAX_ACTIONS_PER_GAME = 400;
const LEARNING_RATE = Number(process.env.RL_REVIVE_LR ?? 0.01);
const TARGET_SHORTFALL = 0.5;
// Salvaguarda (no existía en la versión genérica, y se hubiera necesitado):
// si la deriva media de las anclas se dispara por encima de esto, se para
// YA aunque el déficit de la carta rescatada no haya bajado del todo.
const MAX_ANCHOR_DRIFT = Number(process.env.RL_REVIVE_MAX_DRIFT ?? 2);
// Cuánto por detrás de la mejor alternativa de esa decisión se considera ya
// "competitiva" (no hace falta que sea literalmente la mejor).
const COMPETITIVE_MARGIN = Number(process.env.RL_REVIVE_MARGIN ?? 3);
// Salto máximo por LLAMADA respecto al score ACTUAL de la carta (pedido
// explícito del usuario 2026-09-22, tras el intento con el Águila: con un
// déficit de 83-112 puntos —mucho más profunda que el Pez Dorado—, pedirle
// a la regresión que la suba de golpe hasta ser "competitiva" generaba un
// gradiente tan grande que rompía el freno de deriva en la primera época,
// sin importar lo bajo que fuera LEARNING_RATE (el tamaño del paso depende
// del error, no solo de la tasa). Limitando el objetivo a como mucho esto
// por encima del score actual, un pozo profundo necesita varias llamadas
// seguidas (comprobando después de cada una) en vez de un solo salto — más
// lento, pero seguro.
const MAX_TARGET_JUMP = Number(process.env.RL_REVIVE_MAX_JUMP ?? 15);
const HIDDEN_SIZE = 48;

interface Sample {
  features: number[];
  target: number;
  raised: boolean;
}

function collectSamples(weights: RlWeights): { samples: Sample[]; decisionsWithTarget: number; raised: number } {
  const samples: Sample[] = [];
  let decisionsWithTarget = 0;
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

      const targetIdx = actions.findIndex(
        (a) => a.type === 'buyAnimal' && state.animalTrack.find((c) => c.instanceId === a.trackInstanceId)?.species === RESCUE_SPECIES
      );
      if (targetIdx !== -1) {
        const otherBuyScores = actions
          .map((a, i) => (a.type === 'buyAnimal' && i !== targetIdx ? scores[i] : -Infinity))
          .filter((s) => Number.isFinite(s));
        if (otherBuyScores.length > 0) {
          decisionsWithTarget++;
          const bestOther = Math.max(...otherBuyScores);
          const floor = bestOther - COMPETITIVE_MARGIN;
          const isRaised = scores[targetIdx] < floor;
          if (isRaised) raised++;
          const cappedTarget = isRaised ? Math.min(floor, scores[targetIdx] + MAX_TARGET_JUMP) : scores[targetIdx];
          for (let k = 0; k < actions.length; k++) {
            const thisIsTarget = k === targetIdx;
            samples.push({
              features: allFeatures[k],
              target: thisIsTarget ? cappedTarget : scores[k],
              raised: thisIsTarget && isRaised,
            });
          }
        }
      }

      const best = Math.max(...scores);
      const bestIdx = scores.map((_, i) => i).filter((i) => scores[i] >= best - 1e-9);
      applyAction(state, player.id, actions[bestIdx[Math.floor(Math.random() * bestIdx.length)]]);
      guard++;
    }
  }

  return { samples, decisionsWithTarget, raised };
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

function printReference(label: string, weights: RlWeights, watchSpecies: string[]): void {
  const state = referenceState();
  const player = getActivePlayer(state);
  const parts = watchSpecies.map((species) => {
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
  printReference('antes', weights, [RESCUE_SPECIES]);

  const { samples, decisionsWithTarget, raised } = collectSamples(weights);
  console.log(
    `${GAMES} partidas (${VARIANT}), ${decisionsWithTarget} decisiones con ${RESCUE_SPECIES} entre las opciones, ${raised} donde iba por detrás de su mejor rival (margen ${COMPETITIVE_MARGIN})`
  );

  if (raised > 0) regress(weights, samples);
  else console.log('Nada que rescatar: ya va competitiva en las decisiones vistas.');

  printReference('después', weights, [RESCUE_SPECIES]);
  await saveWeightsWithRetry(weights, path);
  console.log(`Guardado ${path}`);
}

main();
