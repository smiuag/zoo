// Tanda de partidas de 6 jugadores: los 3 especialistas de hábitat ACTUALES
// (src/bots/rl/weights-{land,bird,aquatic}.json, FEATURE_DIM=96, entrenados
// con la escasez de mercado + coinCardCount) contra los 3 especialistas
// VIEJOS (pre_marketscarcity_backup/weights-{land,bird,aquatic}.json,
// FEATURE_DIM=86, puntuados con legacyFeatures86.ts — el encoder que de
// verdad vieron durante su entrenamiento). Un one-off para ver el reparto
// real de victorias en partidas mixtas, no 1 contra 1 como arena.ts.
//
// Uso: npm run -w packages/engine six-player-match
// Variables: RL_SIX_GAMES (por defecto 100).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deserializeWeights, forward, type RlWeights } from '../../src/bots/rl/network';
import { encodeAction, FEATURE_DIM } from '../../src/bots/rl/features';
import { legacyEncodeAction86, LEGACY_FEATURE_DIM_86 } from './legacyFeatures86';
import {
  applyAction,
  autoResolvePendingDiscard,
  createGame,
  getActivePlayer,
  type Action,
} from '../../src/engine';
import { legalActionsForBot } from '../../src/bots/actionPriority';
import { getCard } from '../../src/cards/registry';
import type { Card } from '../../src/cards/schema';
import type { GameState } from '../../src/model/state';
import { scoreGame } from '../../src/scoring';

const GAMES = Number(process.env.RL_SIX_GAMES ?? 100);
const MAX_ACTIONS_PER_GAME = 800;
const REALISTIC_ROUND_LIMITS = [10, 15, 20] as const;

function randomMaxRounds(): number {
  return REALISTIC_ROUND_LIMITS[Math.floor(Math.random() * REALISTIC_ROUND_LIMITS.length)];
}

function buildStarterDeck(): Card[] {
  const coin1 = getCard('coin-1');
  const sloth = getCard('sloth');
  return [...Array.from({ length: 7 }, () => coin1), ...Array.from({ length: 3 }, () => sloth)];
}

type Habitat = 'land' | 'bird' | 'aquatic';
type Generation = 'new' | 'old';

interface Contestant {
  id: string;
  generation: Generation;
  habitat: Habitat;
  weights: RlWeights;
  encode: (state: GameState, playerId: string, action: Action) => number[];
}

function loadWeights(path: string, expectedDim: number): RlWeights {
  const weights = deserializeWeights(readFileSync(path, 'utf-8'));
  if (weights.featureDim !== expectedDim) {
    throw new Error(`${path}: featureDim ${weights.featureDim} no coincide con el esperado ${expectedDim}`);
  }
  return weights;
}

function newPath(habitat: Habitat): string {
  return fileURLToPath(new URL(`../../src/bots/rl/weights-${habitat}.json`, import.meta.url));
}

function oldPath(habitat: Habitat): string {
  return fileURLToPath(new URL(`../../src/bots/rl/pre_marketscarcity_backup/weights-${habitat}.json`, import.meta.url));
}

const HABITATS: Habitat[] = ['land', 'bird', 'aquatic'];

function buildContestants(): Contestant[] {
  const contestants: Contestant[] = [];
  for (const habitat of HABITATS) {
    contestants.push({
      id: `new-${habitat}`,
      generation: 'new',
      habitat,
      weights: loadWeights(newPath(habitat), FEATURE_DIM),
      encode: encodeAction,
    });
    contestants.push({
      id: `old-${habitat}`,
      generation: 'old',
      habitat,
      weights: loadWeights(oldPath(habitat), LEGACY_FEATURE_DIM_86),
      encode: legacyEncodeAction86,
    });
  }
  return contestants;
}

function filterForHabitat(state: GameState, actions: Action[], habitat: Habitat): Action[] {
  return actions.filter((a) => {
    if (a.type !== 'buyAnimal') return true;
    const animal = state.animalTrack.find((c) => c.instanceId === a.trackInstanceId);
    return (animal?.habitats as string[] | undefined)?.includes(habitat) ?? false;
  });
}

// Greedy (temperature 0), igual que en tiempo de juego real: sin exploración.
function chooseGreedy(state: GameState, playerId: string, c: Contestant): Action {
  const actions = filterForHabitat(state, legalActionsForBot(state, playerId), c.habitat);
  if (actions.length === 0) return { type: 'endTurn' };
  const scores = actions.map((a) => {
    const s = forward(c.weights, c.encode(state, playerId, a)).score;
    return Number.isFinite(s) ? s : -Infinity;
  });
  const best = Math.max(...scores);
  const bestIdx = actions.map((_, i) => i).filter((i) => scores[i] >= best - 1e-9);
  return actions[bestIdx[Math.floor(Math.random() * bestIdx.length)]];
}

function shuffled<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function playGame(contestants: Contestant[]): { winnerId: string | null; scores: Record<string, number> } {
  // Orden de turno aleatorio cada partida: 6 jugadores fijos siempre en el
  // mismo orden sesgaría a quien empieza (ventaja de salida conocida en
  // este motor).
  const order = shuffled(contestants);
  const configs = order.map((c) => ({ id: c.id, name: c.id, deck: buildStarterDeck() }));
  const state = createGame(configs, { maxRounds: randomMaxRounds() });
  const byId = new Map(contestants.map((c) => [c.id, c]));

  let guard = 0;
  while (!state.gameOver && guard < MAX_ACTIONS_PER_GAME) {
    if (autoResolvePendingDiscard(state)) {
      guard++;
      continue;
    }
    const player = getActivePlayer(state);
    const contestant = byId.get(player.id)!;
    const action = chooseGreedy(state, player.id, contestant);
    applyAction(state, player.id, action);
    guard++;
  }

  const scores = scoreGame(state);
  const scoreById: Record<string, number> = {};
  for (const s of scores) scoreById[s.playerId] = s.score;

  const best = Math.max(...Object.values(scoreById));
  const winners = Object.entries(scoreById)
    .filter(([, score]) => score === best)
    .map(([id]) => id);
  // Empate a varios: no se cuenta como victoria de nadie (igual que un
  // empate 1v1 en arena.ts se cuenta a medias, aquí simplemente no suma win
  // para no repartir crédito arbitrariamente entre 2+ jugadores).
  return { winnerId: winners.length === 1 ? winners[0] : null, scores: scoreById };
}

function main(): void {
  const contestants = buildContestants();
  console.log(
    `Tanda de ${GAMES} partidas, 6 jugadores (3 especialistas nuevos vs 3 viejos), duración sorteada entre ${REALISTIC_ROUND_LIMITS.join('/')} rondas.\n`
  );

  const wins: Record<string, number> = Object.fromEntries(contestants.map((c) => [c.id, 0]));
  let ties = 0;
  const totalScore: Record<string, number> = Object.fromEntries(contestants.map((c) => [c.id, 0]));

  for (let i = 0; i < GAMES; i++) {
    const { winnerId, scores } = playGame(contestants);
    if (winnerId) wins[winnerId]++;
    else ties++;
    for (const [id, score] of Object.entries(scores)) totalScore[id] += score;
  }

  console.log('Victorias:');
  for (const c of contestants) {
    const avgScore = (totalScore[c.id] / GAMES).toFixed(1);
    console.log(`  ${c.id.padEnd(12)} (${c.generation}) — ${wins[c.id]} victorias / ${GAMES}  (score medio ${avgScore})`);
  }
  console.log(`  empates (varios ganadores igualados): ${ties}`);

  const newTotal = contestants.filter((c) => c.generation === 'new').reduce((sum, c) => sum + wins[c.id], 0);
  const oldTotal = contestants.filter((c) => c.generation === 'old').reduce((sum, c) => sum + wins[c.id], 0);
  console.log(`\nTotal generación nueva: ${newTotal} / ${GAMES}`);
  console.log(`Total generación vieja:  ${oldTotal} / ${GAMES}`);
}

main();
