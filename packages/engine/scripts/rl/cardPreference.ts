// Herramienta de análisis puntual (no forma parte del pipeline de
// entrenamiento): juega N partidas de cada variante de rlBot contra 3
// heuristicBot (un rival "razonable" fijo, no al azar) y cuenta qué
// especies compra de verdad la variante, para poder describir su
// preferencia de cartas en vez de adivinarla mirando los pesos crudos
// (una MLP de una capa oculta sobre features no se puede leer a ojo).
// Uso: npx vite-node scripts/rl/cardPreference.ts [partidas por variante]
import { aquaticRlBot, birdRlBot, landRlBot, rlBot } from '../../src/bots/rlBot';
import { heuristicBot } from '../../src/bots/heuristicBot';
import { getCard } from '../../src/cards/registry';
import type { Bot } from '../../src/bots/types';
import { applyAction, autoResolvePendingDiscard, createGame, getActivePlayer, type Action } from '../../src/engine';

const GAMES_PER_VARIANT = Number(process.argv[2] ?? 60);
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

interface Tally {
  speciesCounts: Map<string, number>;
  coinBuys: number;
  animalBuys: number;
  turnsEnded: number;
}

function playAndTally(bot: Bot, games: number): Tally {
  const tally: Tally = { speciesCounts: new Map(), coinBuys: 0, animalBuys: 0, turnsEnded: 0 };

  for (let g = 0; g < games; g++) {
    const seatId = `p${g % 4}`; // rota el asiento del aprendiz para que orden de turno no sesgue
    const playerConfigs = Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, deck: buildStarterDeck() }));
    const state = createGame(playerConfigs, { maxRounds: randomMaxRounds() });

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
        } else if (action.type === 'endTurn') {
          tally.turnsEnded++;
        }
      }

      applyAction(state, player.id, action);
      guard++;
    }
  }

  return tally;
}

function report(label: string, tally: Tally) {
  const totalBuys = tally.animalBuys + tally.coinBuys;
  console.log(`\n=== ${label} (${tally.animalBuys} animales, ${tally.coinBuys} monedas compradas, ${totalBuys} compras totales) ===`);

  const habitatCounts = new Map<string, number>();
  const costBuckets = new Map<string, number>();
  for (const [species, count] of tally.speciesCounts) {
    const card = getCard(species);
    for (const h of card.habitats ?? []) {
      habitatCounts.set(h, (habitatCounts.get(h) ?? 0) + count);
    }
    const bucket = card.marketCost <= 2 ? 'barato (<=2)' : card.marketCost <= 4 ? 'medio (3-4)' : 'caro (5+)';
    costBuckets.set(bucket, (costBuckets.get(bucket) ?? 0) + count);
  }

  const sortedSpecies = [...tally.speciesCounts.entries()].sort((a, b) => b[1] - a[1]);
  console.log('Top especies compradas:');
  for (const [species, count] of sortedSpecies) {
    const card = getCard(species);
    const pct = ((count / tally.animalBuys) * 100).toFixed(1);
    console.log(`  ${species.padEnd(14)} x${count} (${pct}%)  coste ${card.marketCost}, hábitats [${(card.habitats ?? []).join(',')}]`);
  }

  console.log('Por hábitat (un animal con varios hábitats cuenta en cada uno):');
  for (const [h, count] of [...habitatCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${h.padEnd(10)} x${count}`);
  }

  console.log('Por franja de coste:');
  for (const [bucket, count] of [...costBuckets.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${bucket.padEnd(14)} x${count}`);
  }
}

function main() {
  const variants: [string, Bot][] = [
    ['general', rlBot],
    ['land', landRlBot],
    ['bird', birdRlBot],
    ['aquatic', aquaticRlBot],
  ];

  for (const [label, bot] of variants) {
    const tally = playAndTally(bot, GAMES_PER_VARIANT);
    report(label, tally);
  }
}

main();
