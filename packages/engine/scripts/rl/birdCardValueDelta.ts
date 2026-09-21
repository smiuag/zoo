// Herramienta puntual: compara qué especies compra el bird de producción
// (weights-bird.json, congelado) frente al bird-solo EN VIVO
// (weights-bird-solo.json, mientras el entrenamiento en background lo sigue
// sobreescribiendo — la escritura es atómica vía rename, ver
// saveWeightsWithRetry, así que leerlo a mitad de tanda es seguro) — misma
// idea que cardPreference.ts, pero comparando 2 sets de pesos arbitrarios en
// vez de leer las 4 variantes de producción fijas. Cuenta compras reales en
// mesas de 4 contra heuristicBot (revealed preference), no scores crudos:
// una MLP no se puede leer a ojo.
//
// Uso: npx vite-node scripts/rl/birdCardValueDelta.ts [partidas=200]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deserializeWeights, type RlWeights } from '../../src/bots/rl/network';
import { createRlBot } from '../../src/bots/rlBot';
import { heuristicBot } from '../../src/bots/heuristicBot';
import type { Bot } from '../../src/bots/types';
import { applyAction, autoResolvePendingDiscard, createGame, getActivePlayer, type Action } from '../../src/engine';
import { getCard } from '../../src/cards/registry';

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

function loadWeights(path: string): RlWeights {
  return deserializeWeights(readFileSync(path, 'utf-8'));
}

interface Tally {
  speciesCounts: Map<string, number>;
  animalBuys: number;
}

function playAndTally(bot: Bot, games: number): Tally {
  const tally: Tally = { speciesCounts: new Map(), animalBuys: 0 };

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
      const activeBot = player.id === seatId ? bot : heuristicBot;
      const action: Action = activeBot.chooseAction(state, player.id);

      if (player.id === seatId && action.type === 'buyAnimal') {
        const animal = state.animalTrack.find((c) => c.instanceId === action.trackInstanceId);
        if (animal) {
          const species = animal.species ?? 'unknown';
          tally.speciesCounts.set(species, (tally.speciesCounts.get(species) ?? 0) + 1);
          tally.animalBuys++;
        }
      }

      applyAction(state, player.id, action);
      guard++;
    }
  }

  return tally;
}

const oldPath = fileURLToPath(new URL('../../src/bots/rl/weights-bird.json', import.meta.url));
const newPath = fileURLToPath(new URL('../../src/bots/rl/weights-bird-solo.json', import.meta.url));

const oldBot = createRlBot({ weights: loadWeights(oldPath), habitatFilter: 'bird' });
const newBot = createRlBot({ weights: loadWeights(newPath), habitatFilter: 'bird' });

const oldTally = playAndTally(oldBot, GAMES);
const newTally = playAndTally(newBot, GAMES);

const allSpecies = new Set<string>([...oldTally.speciesCounts.keys(), ...newTally.speciesCounts.keys()]);

interface Row {
  species: string;
  oldFreq: number;
  newFreq: number;
  delta: number;
}

const rows: Row[] = [...allSpecies].map((species) => {
  const oldFreq = ((oldTally.speciesCounts.get(species) ?? 0) / Math.max(1, oldTally.animalBuys)) * 100;
  const newFreq = ((newTally.speciesCounts.get(species) ?? 0) / Math.max(1, newTally.animalBuys)) * 100;
  return { species, oldFreq, newFreq, delta: newFreq - oldFreq };
});

rows.sort((a, b) => b.delta - a.delta);

console.log(
  `bird-prod (weights-bird.json) vs bird-solo EN VIVO (weights-bird-solo.json), ${GAMES} partidas cada uno, % de compras de animal por especie.\n`
);
console.log('Ganando preferencia (compra más a menudo que el bird de producción):');
for (const r of rows.filter((r) => r.delta > 0.5)) {
  console.log(`  ${r.species.padEnd(15)} ${r.oldFreq.toFixed(1)}% -> ${r.newFreq.toFixed(1)}%  (${r.delta >= 0 ? '+' : ''}${r.delta.toFixed(1)} pp)`);
}
console.log('\nPerdiendo preferencia (compra menos a menudo):');
for (const r of [...rows].reverse().filter((r) => r.delta < -0.5)) {
  console.log(`  ${r.species.padEnd(15)} ${r.oldFreq.toFixed(1)}% -> ${r.newFreq.toFixed(1)}%  (${r.delta.toFixed(1)} pp)`);
}
console.log(`\nTotal compras de animal: bird-prod=${oldTally.animalBuys}, bird-solo=${newTally.animalBuys}`);
