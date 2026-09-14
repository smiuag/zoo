// Herramienta de análisis puntual (no forma parte del pipeline de
// entrenamiento): enfrenta las 4 variantes de rlBot ENTRE SÍ (general vs
// land vs bird vs aquatic, una en cada silla, tal cual se usan de verdad en
// la app — greedy, temperature 0) para medir su fuerza relativa real, en
// vez de fiarse de winrate_vs_heuristic (que compara cada una por separado
// contra un rival fijo, no entre ellas).
// Uso: npx vite-node scripts/rl/variantArena.ts [partidas]
import { aquaticRlBot, birdRlBot, landRlBot, rlBot } from '../../src/bots/rlBot';
import { getCard } from '../../src/cards/registry';
import type { Bot } from '../../src/bots/types';
import { applyAction, autoResolvePendingDiscard, createGame, getActivePlayer, type Action } from '../../src/engine';
import { scoreGame } from '../../src/scoring';

const GAMES = Number(process.argv[2] ?? 200);
const MAX_ACTIONS_PER_GAME = 400;
const REALISTIC_ROUND_LIMITS = [10, 15, 20] as const;
function randomMaxRounds(): number {
  return REALISTIC_ROUND_LIMITS[Math.floor(Math.random() * REALISTIC_ROUND_LIMITS.length)];
}

function buildStarterDeck() {
  const coin1 = getCard('coin-1');
  const sloth = getCard('sloth');
  return [...Array.from({ length: 7 }, () => coin1), ...Array.from({ length: 3 }, () => sloth)];
}

const VARIANTS: [string, Bot][] = [
  ['general', rlBot],
  ['land', landRlBot],
  ['bird', birdRlBot],
  ['aquatic', aquaticRlBot],
];

const wins = new Map<string, number>(VARIANTS.map(([label]) => [label, 0]));
const totalScore = new Map<string, number>(VARIANTS.map(([label]) => [label, 0]));

for (let g = 0; g < GAMES; g++) {
  // Rota qué variante ocupa cada silla para que el orden de turno no sesgue.
  const rotation = g % 4;
  const seats = VARIANTS.map((_, i) => VARIANTS[(i + rotation) % 4]);

  const playerConfigs = seats.map(([label], i) => ({ id: `p${i}`, name: label, deck: buildStarterDeck() }));
  const state = createGame(playerConfigs, { maxRounds: randomMaxRounds() });

  let guard = 0;
  while (!state.gameOver && guard < MAX_ACTIONS_PER_GAME) {
    if (autoResolvePendingDiscard(state)) {
      guard++;
      continue;
    }
    const player = getActivePlayer(state);
    const seatIndex = playerConfigs.findIndex((c) => c.id === player.id);
    const bot = seats[seatIndex][1];
    const action: Action = bot.chooseAction(state, player.id);
    applyAction(state, player.id, action);
    guard++;
  }

  const scores = scoreGame(state);
  const bestScore = Math.max(...scores.map((s) => s.score));
  const winnerIds = scores.filter((s) => s.score === bestScore).map((s) => s.playerId);

  for (const cfg of playerConfigs) {
    const seatIndex = playerConfigs.indexOf(cfg);
    const label = seats[seatIndex][0];
    const score = scores.find((s) => s.playerId === cfg.id)?.score ?? 0;
    totalScore.set(label, (totalScore.get(label) ?? 0) + score);
    if (winnerIds.includes(cfg.id)) {
      wins.set(label, (wins.get(label) ?? 0) + 1 / winnerIds.length);
    }
  }
}

console.log(`\n=== Torneo 4 variantes (${GAMES} partidas, sillas rotadas) ===`);
for (const [label] of VARIANTS) {
  const w = wins.get(label) ?? 0;
  const avgScore = (totalScore.get(label) ?? 0) / GAMES;
  console.log(`  ${label.padEnd(10)} winrate=${(w / GAMES).toFixed(3)}  avg_score=${avgScore.toFixed(1)}`);
}
