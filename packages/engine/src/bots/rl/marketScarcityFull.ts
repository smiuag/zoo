import { getCard } from '../../cards/registry';
import { initialMarketCopies, marketSpeciesFor } from '../../engine';
import type { GameState } from '../../model/state';

// Mismo cálculo que marketScarcity.ts (ver ese archivo para el porqué), pero
// para la edición completa (o una personalizada, que se comporta igual para
// esto): recorre TODAS las especies de mercado de esa edición
// (marketSpeciesFor(state), 50 especies en vez de las 33 clásicas de
// ANIMAL_SPECIES, o las que se hayan elegido en 'custom') y con los 5 tipos
// (3 hábitats base + mascota +
// dinosaurio, no solo los 3 de siempre) — imprescindible para que la red
// pueda distinguir "casi no quedan dinosaurios en el mercado" de "está lleno
// de mascotas sin comprar". Vive en un fichero aparte (no parametriza
// marketScarcity.ts) para no arriesgar la forma/dimensión que ya consumen
// los pesos clásicos ya entrenados — ver featuresFull.ts.
const HABITATS_FULL = ['land', 'bird', 'aquatic', 'pet', 'dinosaur'] as const;

function remainingCopies(state: GameState, species: string): number {
  const inSharedDeck = state.sharedDecks[species]?.length ?? 0;
  const onTrack = state.animalTrack.some((c) => c.species === species) ? 1 : 0;
  return inSharedDeck + onTrack;
}

export function computeMarketScarcityFull(state: GameState): { habitat: number[]; costTier: number[] } {
  const habitatRemaining = [0, 0, 0, 0, 0];
  const habitatTotal = [0, 0, 0, 0, 0];
  const costTierRemaining = [0, 0, 0];
  const costTierTotal = [0, 0, 0];

  for (const species of marketSpeciesFor(state)) {
    const card = getCard(species);
    const cost = card.marketCost ?? 0;
    const total = initialMarketCopies(cost, state.players.length, state.customCopyDeltas);
    const remaining = remainingCopies(state, species);

    HABITATS_FULL.forEach((h, i) => {
      if (card.habitats?.includes(h)) {
        habitatRemaining[i] += remaining;
        habitatTotal[i] += total;
      }
    });

    const costTierIndex = cost <= 2 ? 0 : cost <= 4 ? 1 : 2;
    costTierRemaining[costTierIndex] += remaining;
    costTierTotal[costTierIndex] += total;
  }

  return {
    habitat: habitatRemaining.map((r, i) => (habitatTotal[i] > 0 ? r / habitatTotal[i] : 0)),
    costTier: costTierRemaining.map((r, i) => (costTierTotal[i] > 0 ? r / costTierTotal[i] : 0)),
  };
}
