// Enfrenta los pesos NUEVOS (src/bots/rl/weights*.json) contra los pesos
// VIEJOS congelados en src/bots/rl/baseline/ — la generación de antes de
// añadir el cruce entre variantes de rlBot, la duración de partida
// aleatoria y la feature del destino del Flamenco (ver
// scripts/rl/legacyFeatures64.ts) — para saber si de verdad ha mejorado en
// vez de fiarse de winrate_vs_heuristic/winrate_vs_random, que ya estaban
// casi saturados (0.85-1.00) y no tienen margen para notar una mejora más.
// Nunca se compara contra sí mismo (eso siempre da ~50% por simetría, no
// dice nada): siempre nuevo vs viejo, 1 contra 1, alternando quién empieza.
//
// Uso: npm run arena:rl -w packages/engine
// Variables: RL_ARENA_GAMES (por defecto 200, partidas por variante).
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deserializeWeights, forward, type RlWeights } from '../../src/bots/rl/network';
import { encodeAction, FEATURE_DIM } from '../../src/bots/rl/features';
import { legacyEncodeAction, LEGACY_FEATURE_DIM } from './legacyFeatures64';
import { applyAction, autoResolvePendingDiscard, createGame, getActivePlayer, type Action } from '../../src/engine';
import { legalActionsForBot } from '../../src/bots/actionPriority';
import { getCard } from '../../src/cards/registry';
import type { Card } from '../../src/cards/schema';
import type { GameState } from '../../src/model/state';
import { scoreGame } from '../../src/scoring';

const GAMES = Number(process.env.RL_ARENA_GAMES ?? 200);
const MAX_ACTIONS_PER_GAME = 400;

// Igual que en selfPlay.ts: sortear la duración real (ver ROUND_LIMIT_OPTIONS
// en apps/web/src/lib/gameConfig.ts) en vez de dejar la partida sin límite,
// para que la comparación refleje partidas de verdad.
const REALISTIC_ROUND_LIMITS = [10, 15, 20] as const;
function randomMaxRounds(): number {
  return REALISTIC_ROUND_LIMITS[Math.floor(Math.random() * REALISTIC_ROUND_LIMITS.length)];
}

// Replica tests/helpers.ts / apps/web/src/lib/starterDeck.ts.
function buildStarterDeck(): Card[] {
  const coin1 = getCard('coin-1');
  const sloth = getCard('sloth');
  return [...Array.from({ length: 7 }, () => coin1), ...Array.from({ length: 3 }, () => sloth)];
}

type Variant = 'general' | 'land' | 'bird' | 'aquatic';
const VARIANTS: Variant[] = ['general', 'land', 'bird', 'aquatic'];

function weightsFileName(variant: Variant): string {
  return variant === 'general' ? 'weights.json' : `weights-${variant}.json`;
}

function currentWeightsPath(variant: Variant): string {
  return fileURLToPath(new URL(`../../src/bots/rl/${weightsFileName(variant)}`, import.meta.url));
}

function baselineWeightsPath(variant: Variant): string {
  return fileURLToPath(new URL(`../../src/bots/rl/baseline/${weightsFileName(variant)}`, import.meta.url));
}

function loadWeights(path: string, expectedDim: number): RlWeights {
  const weights = deserializeWeights(readFileSync(path, 'utf-8'));
  if (weights.featureDim !== expectedDim) {
    throw new Error(`${path}: featureDim ${weights.featureDim} no coincide con el esperado ${expectedDim}`);
  }
  return weights;
}

function filterForHabitat(state: GameState, actions: Action[], variant: Variant): Action[] {
  if (variant === 'general') return actions;
  return actions.filter((a) => {
    if (a.type !== 'buyAnimal') return true;
    const animal = state.animalTrack.find((c) => c.instanceId === a.trackInstanceId);
    return (animal?.habitats as string[] | undefined)?.includes(variant) ?? false;
  });
}

// Greedy (temperature 0), igual que createRlBot en tiempo de juego real:
// nada de exploración aquí, queremos la mejor jugada de cada lado.
function chooseGreedy(
  state: GameState,
  playerId: string,
  weights: RlWeights,
  encode: (state: GameState, playerId: string, action: Action) => number[],
  variant: Variant
): Action {
  const actions = filterForHabitat(state, legalActionsForBot(state, playerId), variant);
  if (actions.length === 0) return { type: 'endTurn' };
  const scores = actions.map((a) => {
    const s = forward(weights, encode(state, playerId, a)).score;
    return Number.isFinite(s) ? s : -Infinity;
  });
  const best = Math.max(...scores);
  const bestIdx = actions.map((_, i) => i).filter((i) => scores[i] >= best - 1e-9);
  return actions[bestIdx[Math.floor(Math.random() * bestIdx.length)]];
}

// 1 contra 1 (nunca autoenfrentamiento): 1 = gana el nuevo, 0.5 = empate, 0 = gana el viejo.
function playMatch(newWeights: RlWeights, oldWeights: RlWeights, variant: Variant, newStarts: boolean): number {
  const configs = newStarts
    ? [
        { id: 'new', name: 'New', deck: buildStarterDeck() },
        { id: 'old', name: 'Old', deck: buildStarterDeck() },
      ]
    : [
        { id: 'old', name: 'Old', deck: buildStarterDeck() },
        { id: 'new', name: 'New', deck: buildStarterDeck() },
      ];
  const state = createGame(configs, { maxRounds: randomMaxRounds() });

  let guard = 0;
  while (!state.gameOver && guard < MAX_ACTIONS_PER_GAME) {
    if (autoResolvePendingDiscard(state)) {
      guard++;
      continue;
    }
    const player = getActivePlayer(state);
    const action =
      player.id === 'new'
        ? chooseGreedy(state, player.id, newWeights, encodeAction, variant)
        : chooseGreedy(state, player.id, oldWeights, legacyEncodeAction, variant);
    applyAction(state, player.id, action);
    guard++;
  }

  const scores = scoreGame(state);
  const newScore = scores.find((s) => s.playerId === 'new')?.score ?? 0;
  const oldScore = scores.find((s) => s.playerId === 'old')?.score ?? 0;
  if (newScore > oldScore) return 1;
  if (newScore === oldScore) return 0.5;
  return 0;
}

function runArena(variant: Variant): void {
  const oldPath = baselineWeightsPath(variant);
  if (!existsSync(oldPath)) {
    console.log(`[${variant}] sin baseline en ${oldPath} — omitido (ver README de este script)`);
    return;
  }
  const newWeights = loadWeights(currentWeightsPath(variant), FEATURE_DIM);
  const oldWeights = loadWeights(oldPath, LEGACY_FEATURE_DIM);

  let wins = 0;
  for (let i = 0; i < GAMES; i++) {
    wins += playMatch(newWeights, oldWeights, variant, i % 2 === 0);
  }
  const winrate = wins / GAMES;
  const verdict = winrate > 0.55 ? 'MEJORA' : winrate < 0.45 ? 'EMPEORA' : 'SIN CAMBIO CLARO';
  console.log(`[${variant}] nuevo vs antiguo: ${(winrate * 100).toFixed(1)}% (${GAMES} partidas) -> ${verdict}`);
}

function main(): void {
  console.log(
    `Arena: ${GAMES} partidas por variante, 1 contra 1, duración sorteada entre ${REALISTIC_ROUND_LIMITS.join('/')} rondas.\n`
  );
  for (const variant of VARIANTS) {
    runArena(variant);
  }
}

main();
