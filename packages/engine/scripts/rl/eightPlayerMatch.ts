// Tanda puntual de partidas de 8 jugadores: las 4 variantes de rlBot
// ACTUALES (src/bots/rl/weights*.json, recién entrenadas) contra las 4
// mismas variantes de la versión anterior committeada, todas en la misma
// mesa, duración FIJA de 15 rondas (a diferencia de arena.ts/
// sixPlayerMatch.ts, que sortean 10/15/20 — aquí el usuario pidió 15 fijo).
//
// Uso: npx vite-node scripts/rl/eightPlayerMatch.ts <general.json> <land.json> <bird.json> <aquatic.json> [partidas=1000]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deserializeWeights, type RlWeights } from '../../src/bots/rl/network';
import { createRlBot } from '../../src/bots/rlBot';
import type { Bot } from '../../src/bots/types';
import { applyAction, autoResolvePendingDiscard, createGame, getActivePlayer } from '../../src/engine';
import { getCard } from '../../src/cards/registry';
import type { Card } from '../../src/cards/schema';
import { scoreGame } from '../../src/scoring';

const GAMES = Number(process.argv[6] ?? 1000);
const MAX_ROUNDS = 15;
const MAX_ACTIONS_PER_GAME = 800;

type Variant = 'general' | 'land' | 'bird' | 'aquatic';
const VARIANTS: Variant[] = ['general', 'land', 'bird', 'aquatic'];
const oldPaths: Record<Variant, string> = {
  general: process.argv[2],
  land: process.argv[3],
  bird: process.argv[4],
  aquatic: process.argv[5],
};

function buildStarterDeck(): Card[] {
  const coin1 = getCard('coin-1');
  const sloth = getCard('sloth');
  return [...Array.from({ length: 7 }, () => coin1), ...Array.from({ length: 3 }, () => sloth)];
}

function currentPath(variant: Variant): string {
  const file = variant === 'general' ? 'weights.json' : `weights-${variant}.json`;
  return fileURLToPath(new URL(`../../src/bots/rl/${file}`, import.meta.url));
}

function loadWeights(path: string): RlWeights {
  return deserializeWeights(readFileSync(path, 'utf-8'));
}

interface Contestant {
  label: string;
  bot: Bot;
}

const contestants: Contestant[] = [];
for (const variant of VARIANTS) {
  const habitatFilter = variant === 'general' ? undefined : variant;
  const newWeights = loadWeights(currentPath(variant));
  const oldWeights = loadWeights(oldPaths[variant]);
  contestants.push({ label: `nuevo-${variant}`, bot: createRlBot({ weights: newWeights, habitatFilter }) });
  contestants.push({ label: `anterior-${variant}`, bot: createRlBot({ weights: oldWeights, habitatFilter }) });
}

const wins = new Map<string, number>(contestants.map((c) => [c.label, 0]));
const totalScore = new Map<string, number>(contestants.map((c) => [c.label, 0]));
let ties = 0;

for (let g = 0; g < GAMES; g++) {
  const rotation = g % contestants.length;
  const seats = contestants.map((_, i) => contestants[(i + rotation) % contestants.length]);
  const configs = seats.map((c, i) => ({ id: `p${i}`, name: c.label, deck: buildStarterDeck() }));
  const state = createGame(configs, { maxRounds: MAX_ROUNDS });

  let guard = 0;
  while (!state.gameOver && guard < MAX_ACTIONS_PER_GAME) {
    if (autoResolvePendingDiscard(state)) {
      guard++;
      continue;
    }
    const player = getActivePlayer(state);
    const seatIndex = configs.findIndex((c) => c.id === player.id);
    const action = seats[seatIndex].bot.chooseAction(state, player.id);
    applyAction(state, player.id, action);
    guard++;
  }

  const scores = scoreGame(state);
  const bestScore = Math.max(...scores.map((s) => s.score));
  const winners = scores.filter((s) => s.score === bestScore);
  for (const s of scores) {
    const seatIndex = configs.findIndex((c) => c.id === s.playerId);
    const label = seats[seatIndex].label;
    totalScore.set(label, (totalScore.get(label) ?? 0) + s.score);
  }
  if (winners.length === 1) {
    const seatIndex = configs.findIndex((c) => c.id === winners[0].playerId);
    const label = seats[seatIndex].label;
    wins.set(label, (wins.get(label) ?? 0) + 1);
  } else {
    ties++;
  }
}

console.log(`Tanda de ${GAMES} partidas, 8 jugadores (4 variantes nuevas vs las mismas 4 de la versión anterior committeada), 15 rondas fijas.\n`);
console.log('Victorias:');
for (const c of contestants) {
  const w = wins.get(c.label) ?? 0;
  const avg = (totalScore.get(c.label) ?? 0) / GAMES;
  console.log(`  ${c.label.padEnd(20)} — ${w} victorias / ${GAMES}  (${((w / GAMES) * 100).toFixed(1)}%)  score medio ${avg.toFixed(1)}`);
}
console.log(`  empates (varios ganadores igualados): ${ties}`);
