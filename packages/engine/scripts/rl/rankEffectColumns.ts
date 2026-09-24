// Diagnóstico puntual (2026-09-24): rankear las 41 columnas de "tipo de
// efecto" del bloque de carta (featuresFull.ts) por su proxy lineal
// (sum_j w2[j]*w1[j][idx]) en el especialista acuático actual, para ver qué
// habilidades están tan hundidas como estaba exchangeCoinForFixed antes del
// boost — y qué especies (aquatic-elegibles) las llevan. Desechable.
// Uso: npx vite-node scripts/rl/rankEffectColumns.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deserializeWeights } from '../../src/bots/rl/network';
import { encodePlayerContext } from '../../src/bots/rl/featuresFull';
import { createGame } from '../../src/engine';
import { buildStarterDeck } from './trainCore';
import { getAllCards } from '../../src/cards/registry';

const weights = deserializeWeights(JSON.parse(readFileSync(fileURLToPath(new URL('../../src/bots/rl/weights-full-aquatic.json', import.meta.url)), 'utf-8')));

const EFFECT_TYPES = [
  'drawCards', 'discardFromEachOpponent', 'chooseDiscardFromEachOpponent',
  'gainBonusPurchasingPowerPerSpeciesInDiscard', 'drawThenTopdeck', 'freeCaptureUpToCost',
  'upgradeCoin', 'gainFlatBonusPurchasingPower', 'gainBonusPurchasingPowerPerHabitatInHand',
  'discardAnimalFromEachOpponent', 'stealCoinFromChosenPlayer', 'returnAnimalForUpgrade',
  'scorePerHabitatCount', 'scorePerDistinctSpecies', 'scoreBonusIfSpeciesCountAtLeast',
  'destroyWeakestNonFlyingOnScore', 'swapSelfWithTopOfDeck', 'discardFromEachOpponentAndDrawPerCoin',
  'drawTopUnlessExpensiveAnimal', 'gainAquaticOnlyBonusPurchasingPower',
  'gainBonusPurchasingPowerPerDistinctSpeciesInHand', 'gainCoin', 'retrieveAnimalFromDiscard',
  'returnAnimalFromEachOpponent', 'returnFromDiscardEachTurn', 'scorePerCostAtLeast',
  'scorePerDestroyedCard', 'gainBonusPurchasingPowerPerCoinInHand', 'retrieveCoinFromDiscard',
  'scorePerCoinCard', 'discardAnimalFromEachPlayerThenUseAbility', 'mayStayOnTable',
  'eachOpponentDestroysAnimalFromHand', 'returnAllFromDiscard', 'discardCoinMinValueToDrawCards',
  'discardCoinMinValueToPeekAndKeep', 'discardCoinToCapture', 'exchangeCoinForFixed',
  'drawOrReturnSelfForSpecies', 'gainDinosaurOnlyBonusPurchasingPower', 'scorePerDistinctSpeciesWithHabitat',
] as const;

const playerConfigs = Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, deck: buildStarterDeck() }));
const state = createGame(playerConfigs, { edition: 'full' });
const contextLen = encodePlayerContext(state, state.players[0]).length;
const effectsStart = contextLen + 4 + 3 + 5;

// Especies aquatic-elegibles (habitat aquatic O excepción cross-habitat
// conocida: compuesto/onScore acumulativo, Gato, dinosaurio grande) por
// cada efecto, para saber a quién afecta de verdad este especialista.
const cards = getAllCards().filter((c) => c.type === 'animal');
function speciesFor(effect: string): string[] {
  return cards.filter((c) => c.effects.some((e) => e.type === effect)).map((c) => `${c.species}(${(c.habitats ?? []).join(',')})`);
}

const rows = EFFECT_TYPES.map((effect, i) => {
  const idx = effectsStart + i;
  let linearProxy = 0;
  for (let j = 0; j < weights.hiddenSize; j++) linearProxy += weights.w2[j] * weights.w1[j][idx];
  return { effect, linearProxy, species: speciesFor(effect) };
});

rows.sort((a, b) => a.linearProxy - b.linearProxy);

console.log('=== Columnas de efecto ordenadas de más hundida a más premiada (proxy lineal) ===\n');
for (const r of rows) {
  console.log(`${r.linearProxy.toFixed(2).padStart(8)}  ${r.effect.padEnd(42)} ${r.species.join(', ') || '(ninguna carta la usa)'}`);
}
