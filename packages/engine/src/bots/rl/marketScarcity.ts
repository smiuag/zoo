import { getCard } from '../../cards/registry';
import { ANIMAL_SPECIES, initialMarketCopies } from '../../engine';
import type { GameState } from '../../model/state';

const HABITATS = ['land', 'bird', 'aquatic'] as const;

// Cuántas copias de una especie quedan aún sin comprar: las que siguen boca
// abajo en su mazo compartido más, si corresponde, la que está ahora mismo
// boca arriba en el escaparate (animalTrack) — ambas se pueden comprar ya o
// muy pronto, a diferencia de las que ya están en manos/mazos/descartes de
// algún jugador.
function remainingCopies(state: GameState, species: string): number {
  const inSharedDeck = state.sharedDecks[species]?.length ?? 0;
  const onTrack = state.animalTrack.some((c) => c.species === species) ? 1 : 0;
  return inSharedDeck + onTrack;
}

// Ratio [0,1] de cada hábitat y tramo de coste que sigue disponible en el
// mercado compartido, como proxy de "cuánto están compitiendo los demás
// jugadores por esta categoría" SIN mirar nunca sus manos/mazos (información
// oculta) ni escalar con el número de rivales: un mercado casi agotado de
// una categoría es señal de que se la están disputando; uno casi intacto,
// de que nadie la quiere y por tanto es fácil de acumular.
export function computeMarketScarcity(state: GameState): { habitat: number[]; costTier: number[] } {
  const habitatRemaining = [0, 0, 0];
  const habitatTotal = [0, 0, 0];
  // Mismos umbrales que costTierCounts en features.ts: barato <=2, medio
  // 3-4, caro 5+.
  const costTierRemaining = [0, 0, 0];
  const costTierTotal = [0, 0, 0];

  for (const species of ANIMAL_SPECIES) {
    const card = getCard(species);
    const cost = card.marketCost ?? 0;
    const total = initialMarketCopies(cost, state.players.length);
    const remaining = remainingCopies(state, species);

    HABITATS.forEach((h, i) => {
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
