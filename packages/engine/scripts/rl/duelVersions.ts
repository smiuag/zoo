// Herramienta puntual (no forma parte del pipeline): compara los pesos
// NUEVOS recién entrenados (src/bots/rl/weights*.json en el working tree)
// contra la versión anterior committeada (pasada como archivo) y contra
// heuristicBot, para las 4 variantes. Uso:
// npx vite-node scripts/rl/duelVersions.ts <general.json> <land.json> <bird.json> <aquatic.json> [partidas=200]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deserializeWeights, type RlWeights } from '../../src/bots/rl/network';
import { createRlBot } from '../../src/bots/rlBot';
import { heuristicBot } from '../../src/bots/heuristicBot';
import type { Bot } from '../../src/bots/types';
import { applyAction, autoResolvePendingDiscard, createGame, getActivePlayer } from '../../src/engine';
import { scoreGame } from '../../src/scoring';
import { buildStarterDeck, MAX_ACTIONS_PER_GAME, randomMaxRounds } from './trainCore';

const GAMES = Number(process.argv[6] ?? 200);

type Variant = 'general' | 'land' | 'bird' | 'aquatic';
const VARIANTS: Variant[] = ['general', 'land', 'bird', 'aquatic'];
const oldPaths: Record<Variant, string> = {
  general: process.argv[2],
  land: process.argv[3],
  bird: process.argv[4],
  aquatic: process.argv[5],
};

function currentPath(variant: Variant): string {
  const file = variant === 'general' ? 'weights.json' : `weights-${variant}.json`;
  return fileURLToPath(new URL(`../../src/bots/rl/${file}`, import.meta.url));
}

function loadWeights(path: string): RlWeights {
  return deserializeWeights(readFileSync(path, 'utf-8'));
}

function duel(a: Bot, b: Bot, games: number): { aWins: number; aScoreTotal: number; bScoreTotal: number } {
  let aWins = 0;
  let aScoreTotal = 0;
  let bScoreTotal = 0;
  for (let g = 0; g < games; g++) {
    const aFirst = g % 2 === 0;
    const configs = aFirst
      ? [{ id: 'a', name: 'a', deck: buildStarterDeck() }, { id: 'b', name: 'b', deck: buildStarterDeck() }]
      : [{ id: 'b', name: 'b', deck: buildStarterDeck() }, { id: 'a', name: 'a', deck: buildStarterDeck() }];
    const bots: Record<string, Bot> = { a, b };
    const state = createGame(configs, { maxRounds: randomMaxRounds() });
    let guard = 0;
    while (!state.gameOver && guard < MAX_ACTIONS_PER_GAME) {
      if (autoResolvePendingDiscard(state)) {
        guard++;
        continue;
      }
      const player = getActivePlayer(state);
      const action = bots[player.id].chooseAction(state, player.id);
      applyAction(state, player.id, action);
      guard++;
    }
    const scores = scoreGame(state);
    const aScore = scores.find((s) => s.playerId === 'a')!.score;
    const bScore = scores.find((s) => s.playerId === 'b')!.score;
    aScoreTotal += aScore;
    bScoreTotal += bScore;
    if (aScore > bScore) aWins++;
    else if (aScore === bScore) aWins += 0.5;
  }
  return { aWins, aScoreTotal, bScoreTotal };
}

for (const variant of VARIANTS) {
  const habitatFilter = variant === 'general' ? undefined : variant;
  const newWeights = loadWeights(currentPath(variant));
  const oldWeights = loadWeights(oldPaths[variant]);
  const newBot = createRlBot({ weights: newWeights, habitatFilter });
  const oldBot = createRlBot({ weights: oldWeights, habitatFilter });

  const vsOld = duel(newBot, oldBot, GAMES);
  const vsHeuristic = duel(newBot, heuristicBot, GAMES);

  console.log(
    `${variant}: nuevo vs anterior -> ${vsOld.aWins}/${GAMES} (${((vsOld.aWins / GAMES) * 100).toFixed(1)}%), PV medio ${(vsOld.aScoreTotal / GAMES).toFixed(1)} vs ${(vsOld.bScoreTotal / GAMES).toFixed(1)}`
  );
  console.log(
    `${variant}: nuevo vs heuristico -> ${vsHeuristic.aWins}/${GAMES} (${((vsHeuristic.aWins / GAMES) * 100).toFixed(1)}%)`
  );
}
