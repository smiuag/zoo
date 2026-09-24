// Herramienta puntual (2026-09-24): qué especies compra de verdad el
// especialista acuático de la completa, contra 3 heuristicBot, con el
// checkpoint actual en disco. Desechable.
// Uso: npx vite-node scripts/rl/cardPreferenceFullAquatic.ts [partidas]
import { fullAquaticRlBot } from '../../src/bots/rlBotFull';
import { heuristicBot } from '../../src/bots/heuristicBot';
import { getCard } from '../../src/cards/registry';
import type { Bot } from '../../src/bots/types';
import { applyAction, autoResolvePendingDiscard, createGame, getActivePlayer, type Action } from '../../src/engine';
import { buildStarterDeck, randomMaxRounds, MAX_ACTIONS_PER_GAME } from './trainCore';

const GAMES = Number(process.argv[2] ?? 80);

interface Tally {
  speciesCounts: Map<string, number>;
  coinBuys: number;
  animalBuys: number;
}

function playAndTally(bot: Bot, games: number): Tally {
  const tally: Tally = { speciesCounts: new Map(), coinBuys: 0, animalBuys: 0 };

  for (let g = 0; g < games; g++) {
    const seatId = `p${g % 4}`;
    const playerConfigs = Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, deck: buildStarterDeck() }));
    const state = createGame(playerConfigs, { edition: 'full', maxRounds: randomMaxRounds() });

    let guard = 0;
    while (!state.gameOver && guard < MAX_ACTIONS_PER_GAME) {
      if (autoResolvePendingDiscard(state)) {
        guard++;
        continue;
      }
      const player = getActivePlayer(state);
      const activeBot = player.id === seatId ? bot : heuristicBot;
      const action: Action = activeBot.chooseAction(state, player.id);

      if (player.id === seatId) {
        if (action.type === 'buyAnimal') {
          const animal = state.animalTrack.find((c) => c.instanceId === action.trackInstanceId);
          if (animal) {
            const species = animal.species ?? 'unknown';
            tally.speciesCounts.set(species, (tally.speciesCounts.get(species) ?? 0) + 1);
            tally.animalBuys++;
          }
        } else if (action.type === 'buyCoin') {
          tally.coinBuys++;
        }
      }

      applyAction(state, player.id, action);
      guard++;
    }
  }

  return tally;
}

function report(tally: Tally) {
  console.log(`\n=== aquatic (completa) (${tally.animalBuys} animales, ${tally.coinBuys} monedas compradas) ===`);
  const sorted = [...tally.speciesCounts.entries()].sort((a, b) => b[1] - a[1]);
  console.log('Top especies compradas:');
  for (const [species, count] of sorted) {
    const card = getCard(species);
    const pct = ((count / tally.animalBuys) * 100).toFixed(1);
    console.log(`  ${species.padEnd(16)} x${count} (${pct}%)  coste ${card.marketCost}, hábitats [${(card.habitats ?? []).join(',')}]`);
  }
}

report(playAndTally(fullAquaticRlBot, GAMES));
