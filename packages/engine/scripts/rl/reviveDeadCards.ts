// Rescate de "cartas muertas" (2026-09-16): ajuste supervisado corto sobre
// los pesos YA entrenados de cada variante para que ninguna compra de
// animal quede puntuada por debajo de "terminar el turno sin comprar".
//
// Por qué hace falta: el muestreo del entrenamiento (softmax a temperatura
// 1) no vuelve a elegir nunca una carta cuyo score cae decenas de puntos
// por detrás, así que su score deja de recibir corrección para siempre —
// el Tucán llegó a −44 en el bot general (endTurn: −16) y no se compró ni
// una vez en 653 ocasiones. Ahora el entrenamiento lleva epsilon y un suelo
// blando (ver EPSILON/FLOOR_WEIGHT en trainCore.ts) para que no vuelva a
// pasar, pero recuperar desde −44 a base de muestras forzadas tardaría
// cientos de batches: esto lo deja "en la conversación" en minutos.
//
// Qué hace, por variante: juega N partidas con los pesos actuales (aprendiz
// greedy contra 3 heuristicBot) y recoge, en cada decisión de compra, el
// vector de features y el score de TODAS las candidatas. Objetivo de cada
// buyAnimal por debajo del score de endTurn: ese score de endTurn; el resto
// (incluido endTurn) se ancla a su propio score actual para no mover lo que
// la red ya sabe. Regresión MSE con SGD hasta que el déficit medio de las
// cartas hundidas baje de un umbral, y guarda los pesos (ya migrados a
// FEATURE_DIM columnas si venían de una disposición anterior, ver
// weightsIo.ts). No toca el crítico. Las métricas descuentan el
// desplazamiento global medio de los scores (un +k igual para todas las
// candidatas no cambia ningún argmax ni ningún softmax): solo cuenta lo
// relativo.
//
// Uso: npx vite-node scripts/rl/reviveDeadCards.ts [partidas=60] [maxEpocas=400]
import { fileURLToPath } from 'node:url';
import { filterActionsByHabitat, filterUpgradeChoicesForRl, legalActionsForBot } from '../../src/bots/actionPriority';
import { heuristicBot } from '../../src/bots/heuristicBot';
import { encodeAction, encodeActionsForPlayer, FEATURE_DIM } from '../../src/bots/rl/features';
import { forward, type RlWeights } from '../../src/bots/rl/network';
import { getCard } from '../../src/cards/registry';
import { applyAction, autoResolvePendingDiscard, createGame, getActivePlayer, type Action } from '../../src/engine';
import { accumulateGrad, applyGrad, scaleGrad, zeroGrad } from './train';
import { buildStarterDeck, MAX_ACTIONS_PER_GAME, randomMaxRounds } from './trainCore';
import { loadOrInitWeights, saveWeightsWithRetry } from './weightsIo';

const GAMES_PER_VARIANT = Number(process.argv[2] ?? 60);
const MAX_EPOCHS = Number(process.argv[3] ?? 400);
// SGD plano, no Adam: la primera versión (Adam, lr 0.01, 300 épocas) dejó
// al bot general con |w1| 11 -> 50 y el 63% de las unidades tanh saturadas
// (Adam mueve TODOS los pesos ~lr por época aunque su gradiente sea
// mínimo). Con SGD solo se mueven los pesos que de verdad reducen el error.
const LEARNING_RATE = Number(process.env.RL_REVIVE_LR ?? 0.01);
// Déficit medio (puntos de score por debajo del suelo) a partir del cual se
// da por rescatada la variante.
const TARGET_SHORTFALL = 0.5;
// Debe coincidir con HIDDEN_SIZE en selfPlay.ts (solo se usa si no hay
// pesos válidos que cargar, que no debería pasar aquí).
const HIDDEN_SIZE = 48;

type Habitat = 'land' | 'bird' | 'aquatic';
const VARIANTS: { label: string; file: string; habitat?: Habitat }[] = [
  { label: 'general', file: 'weights.json' },
  { label: 'land', file: 'weights-land.json', habitat: 'land' },
  { label: 'bird', file: 'weights-bird.json', habitat: 'bird' },
  { label: 'aquatic', file: 'weights-aquatic.json', habitat: 'aquatic' },
];

interface Sample {
  features: number[];
  target: number;
  // true si es una carta hundida que se está subiendo (para las métricas);
  // false si es un ancla.
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
    const state = createGame(playerConfigs, { maxRounds: randomMaxRounds() });

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

// Desplazamiento global (media de score − objetivo sobre las anclas): un
// mismo +k para todas las candidatas no cambia ninguna decisión, así que se
// descuenta. Devuelve el déficit medio de las hundidas (cuánto siguen por
// debajo de su suelo, ya descontado el desplazamiento) y la deriva media
// absoluta de las anclas respecto a ese mismo desplazamiento (cuánto se ha
// movido de verdad lo que no debía moverse).
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

const norm = (a: ArrayLike<number>) => Math.sqrt(Array.from(a).reduce((s, v) => s + v * v, 0));
function printNorms(label: string, weights: RlWeights): void {
  const w1 = norm(weights.w1.flatMap((row) => Array.from(row)));
  console.log(`  normas (${label}): |w1|=${w1.toFixed(1)} |w2|=${norm(weights.w2).toFixed(1)}`);
}

function regress(weights: RlWeights, samples: Sample[]): void {
  for (let epoch = 0; epoch < MAX_EPOCHS; epoch++) {
    const grad = zeroGrad(weights.featureDim, weights.hiddenSize);
    for (const s of samples) {
      const { hidden, score } = forward(weights, s.features);
      // accumulateGrad acumula ASCENSO de score·delta: con delta = objetivo −
      // score es descenso del error cuadrático (objetivo − score)².
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

// Estado de referencia (la captura que destapó el problema): mazo de 38
// cartas con 11 animales de coste 5+, ronda 15/15, para ver el score de
// Tucán/Tigre/Mono/endTurn antes y después.
function referenceState() {
  const inst = (id: string, n: string | number) => ({ ...getCard(id), instanceId: `${id}#${n}` });
  const state = createGame(
    [
      { id: 'p0', name: 'P0', deck: buildStarterDeck() },
      { id: 'p1', name: 'P1', deck: buildStarterDeck() },
    ],
    { maxRounds: 15 }
  );
  state.round = 15;
  state.turn = 30;
  const player = getActivePlayer(state);
  player.deck = [];
  player.hand = [];
  player.discard = [];
  player.playedThisTurn = [];
  const collection: Record<string, number> = {
    sloth: 1, goldfish: 2, turtle: 2, spider: 3, squirrel: 3, platypus: 4, hyena: 2, monkey: 3,
    crocodile: 2, hippopotamus: 2, albatross: 1, elephant: 2, orca: 1, 'polar-bear': 3,
  };
  let k = 0;
  for (const [id, n] of Object.entries(collection)) for (let i = 0; i < n; i++) player.discard.push(inst(id, k++));
  for (const [id, n] of Object.entries({ 'coin-1': 5, 'coin-2': 2 })) for (let i = 0; i < n; i++) player.hand.push(inst(id, k++));
  state.animalTrack = ['toucan', 'tiger', 'monkey', 'turtle'].map((id) => inst(id, 'm'));
  return state;
}

function printReference(label: string, weights: RlWeights): void {
  const state = referenceState();
  const player = getActivePlayer(state);
  const parts = state.animalTrack.map((a) => {
    const score = forward(weights, encodeAction(state, player.id, { type: 'buyAnimal', trackInstanceId: a.instanceId })).score;
    return `${a.id}=${score.toFixed(1)}`;
  });
  const endTurn = forward(weights, encodeAction(state, player.id, { type: 'endTurn' })).score;
  console.log(`  referencia (${label}): ${parts.join(' ')} endTurn=${endTurn.toFixed(1)}`);
}

async function main(): Promise<void> {
  for (const variant of VARIANTS) {
    const path = fileURLToPath(new URL(`../../src/bots/rl/${variant.file}`, import.meta.url));
    const weights = loadOrInitWeights(path, FEATURE_DIM, HIDDEN_SIZE);
    console.log(`\n=== ${variant.label} (${variant.file}) ===`);
    printReference('antes', weights);
    printNorms('antes', weights);

    const { samples, decisions, sunk } = collectSamples(weights, variant.habitat, GAMES_PER_VARIANT);
    console.log(`  ${GAMES_PER_VARIANT} partidas, ${decisions} decisiones de compra, ${samples.length} candidatas, ${sunk} compras por debajo de endTurn`);
    if (sunk > 0) regress(weights, samples);

    printReference('después', weights);
    printNorms('después', weights);
    await saveWeightsWithRetry(weights, path);
    console.log(`  guardado ${path} (featureDim=${weights.featureDim})`);
  }
}

main();
