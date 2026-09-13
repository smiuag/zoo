// Diagnóstico puntual: ¿la red puntúa la Araña peor que otros animales del
// MISMO coste cuando SÍ está disponible para comprar, o es solo que rara
// vez llega a aparecer/sobrevivir en el mercado en una partida real? Fuerza
// un mercado con varios animales de coste 3 (incluida la Araña) y compara
// el forward score bruto que le da cada variante a comprar cada uno.
import { getCard } from '../../src/cards/registry';
import { createGame, getActivePlayer } from '../../src/engine';
import { encodeAction } from '../../src/bots/rl/features';
import { deserializeWeights, forward, type RlWeights } from '../../src/bots/rl/network';
import defaultWeightsJson from '../../src/bots/rl/weights.json';
import landWeightsJson from '../../src/bots/rl/weights-land.json';
import birdWeightsJson from '../../src/bots/rl/weights-bird.json';
import aquaticWeightsJson from '../../src/bots/rl/weights-aquatic.json';

function freshInstance(cardId: string, suffix: string) {
  return { ...getCard(cardId), instanceId: `${cardId}#${suffix}` };
}

function buildStarterDeck() {
  const coin1 = getCard('coin-1');
  const sloth = getCard('sloth');
  return [...Array.from({ length: 7 }, () => coin1), ...Array.from({ length: 3 }, () => sloth)];
}

const COST_3_SPECIES = ['spider', 'seal', 'platypus', 'parrot', 'squirrel', 'flamingo', 'dolphin'];

function main() {
  const state = createGame(
    [
      { id: 'p0', name: 'P0', deck: buildStarterDeck() },
      { id: 'p1', name: 'P1', deck: buildStarterDeck() },
    ],
    { maxRounds: 15 }
  );
  const player = getActivePlayer(state);
  player.bonusPurchasingPowerThisTurn = 20; // se lo puede permitir todo

  state.animalTrack = COST_3_SPECIES.map((id) => freshInstance(id, 'market'));
  for (const c of state.animalTrack) console.log(c.species, 'coste', c.marketCost, 'PV', c.victoryPoints);

  const variants: [string, unknown][] = [
    ['general', defaultWeightsJson],
    ['land', landWeightsJson],
    ['bird', birdWeightsJson],
    ['aquatic', aquaticWeightsJson],
  ];

  for (const [label, json] of variants) {
    const weights: RlWeights = deserializeWeights(json);
    const scored = state.animalTrack.map((animal) => ({
      species: animal.species ?? 'unknown',
      score: forward(weights, encodeAction(state, player.id, { type: 'buyAnimal', trackInstanceId: animal.instanceId })).score,
    }));
    scored.sort((a, b) => b.score - a.score);
    console.log(`\n=== ${label} ===`);
    for (const { species, score } of scored) {
      console.log(`  ${species.padEnd(12)} score=${score.toFixed(4)}`);
    }
  }
}

main();
