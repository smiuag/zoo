// Tanda puntual: cada uno de los 8 contestantes (4 variantes nuevas + las
// mismas 4 de la versión anterior committeada) juega partidas EN SOLITARIO
// (1 jugador, sin rivales) para medir su score medio "libre de mesa", sin
// que otros bots le disputen las cartas del mercado. 15 rondas fijas, igual
// que la última tanda de 8 jugadores (eightPlayerMatch.ts) con la que se
// compara.
//
// Uso: npx vite-node scripts/rl/soloMatch.ts <general.json> <land.json> <bird.json> <aquatic.json> [partidas=200]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deserializeWeights, type RlWeights } from '../../src/bots/rl/network';
import { createRlBot } from '../../src/bots/rlBot';
import type { Bot } from '../../src/bots/types';
import { applyAction, autoResolvePendingDiscard, createGame, getActivePlayer } from '../../src/engine';
import { getCard } from '../../src/cards/registry';
import type { Card } from '../../src/cards/schema';
import { scoreGame } from '../../src/scoring';

const GAMES = Number(process.argv[6] ?? 200);
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

console.log(`Tanda de ${GAMES} partidas EN SOLITARIO por contestante (8 contestantes), 15 rondas fijas.\n`);

for (const c of contestants) {
  let total = 0;
  let best = -Infinity;
  let worst = Infinity;
  for (let g = 0; g < GAMES; g++) {
    const state = createGame([{ id: 'p0', name: c.label, deck: buildStarterDeck() }], { maxRounds: MAX_ROUNDS });
    let guard = 0;
    while (!state.gameOver && guard < MAX_ACTIONS_PER_GAME) {
      if (autoResolvePendingDiscard(state)) {
        guard++;
        continue;
      }
      const player = getActivePlayer(state);
      const action = c.bot.chooseAction(state, player.id);
      applyAction(state, player.id, action);
      guard++;
    }
    const score = scoreGame(state)[0].score;
    total += score;
    if (score > best) best = score;
    if (score < worst) worst = score;
  }
  console.log(`  ${c.label.padEnd(20)} score medio ${(total / GAMES).toFixed(1)}  (min ${worst}, max ${best})`);
}
