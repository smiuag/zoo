// Tanda puntual: el bird entrenado EN SOLITARIO (weights-bird-solo.json,
// ver soloSelfPlay.ts/trainCoreSolo.ts) sentado con los otros 3 "mejores"
// actuales (land/aquatic/general de producción, recién entrenados), la
// misma composición de mesa que usa el entrenamiento real (playOneGame en
// trainCore.ts: 1 de cada variante). 15 rondas fijas, igual que la última
// tanda de 8 jugadores con la que se compara.
//
// Uso: npx vite-node scripts/rl/birdSoloVsBest.ts [partidas=1000]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deserializeWeights, type RlWeights } from '../../src/bots/rl/network';
import { createRlBot } from '../../src/bots/rlBot';
import type { Bot } from '../../src/bots/types';
import { applyAction, autoResolvePendingDiscard, createGame, getActivePlayer } from '../../src/engine';
import { getCard } from '../../src/cards/registry';
import type { Card } from '../../src/cards/schema';
import { scoreGame } from '../../src/scoring';

const GAMES = Number(process.argv[2] ?? 1000);
const MAX_ROUNDS = 15;
const MAX_ACTIONS_PER_GAME = 800;

function buildStarterDeck(): Card[] {
  const coin1 = getCard('coin-1');
  const sloth = getCard('sloth');
  return [...Array.from({ length: 7 }, () => coin1), ...Array.from({ length: 3 }, () => sloth)];
}

function loadWeights(path: string): RlWeights {
  return deserializeWeights(readFileSync(path, 'utf-8'));
}

function prodPath(file: string): string {
  return fileURLToPath(new URL(`../../src/bots/rl/${file}`, import.meta.url));
}
function soloPath(file: string): string {
  return fileURLToPath(new URL(`../../src/bots/rl/${file}`, import.meta.url));
}

interface Contestant {
  label: string;
  bot: Bot;
}

const contestants: Contestant[] = [
  { label: 'bird-prod', bot: createRlBot({ weights: loadWeights(soloPath('weights-bird.json')), habitatFilter: 'bird' }) },
  { label: 'land', bot: createRlBot({ weights: loadWeights(prodPath('weights-land.json')), habitatFilter: 'land' }) },
  { label: 'aquatic', bot: createRlBot({ weights: loadWeights(prodPath('weights-aquatic.json')), habitatFilter: 'aquatic' }) },
  { label: 'general', bot: createRlBot({ weights: loadWeights(prodPath('weights.json')) }) },
];

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

console.log(`Tanda de ${GAMES} partidas, bird-solo vs land/aquatic/general de producción, 15 rondas fijas.\n`);
console.log('Victorias:');
for (const c of contestants) {
  const w = wins.get(c.label) ?? 0;
  const avg = (totalScore.get(c.label) ?? 0) / GAMES;
  console.log(`  ${c.label.padEnd(12)} — ${w} victorias / ${GAMES}  (${((w / GAMES) * 100).toFixed(1)}%)  score medio ${avg.toFixed(1)}`);
}
console.log(`  empates (varios ganadores igualados): ${ties}`);
