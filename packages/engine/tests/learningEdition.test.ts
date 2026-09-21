import { describe, expect, it } from 'vitest';
import { ANIMAL_SPECIES, createGame, getLegalActions, LEARNING_EDITION_MAX_COST, marketSpeciesFor } from '../src/engine';
import { getCard } from '../src/cards/registry';
import { buildStarterDeck } from './helpers';

describe('edición "Aprendizaje"', () => {
  it('marketSpeciesFor recorta la baraja clásica a coste 4 o menos (21 de las 33)', () => {
    const species = marketSpeciesFor('learning');
    expect(species.length).toBe(21);
    for (const s of species) expect(getCard(s).marketCost).toBeLessThanOrEqual(LEARNING_EDITION_MAX_COST);
    // Ninguna especie cara se cuela, y son todas especies clásicas de siempre.
    for (const s of species) expect(ANIMAL_SPECIES).toContain(s);
  });

  it('una partida creada con edition "learning" solo tiene esas 21 especies en el mercado', () => {
    const state = createGame(
      [
        { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
        { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
      ],
      { edition: 'learning' }
    );
    expect(state.edition).toBe('learning');
    expect(state.animalTrack).toHaveLength(21);
    for (const card of state.animalTrack) {
      expect(card.marketCost).toBeLessThanOrEqual(LEARNING_EDITION_MAX_COST);
      // Sin tipos extra: sigue siendo el mazo clásico de siempre.
      expect(card.habitats.some((h) => h === 'pet' || h === 'dinosaur')).toBe(false);
    }
    expect(Object.keys(state.sharedDecks).filter((s) => s !== 'sloth')).toHaveLength(21);
  });

  it('nunca se ofrece comprar un animal de coste 5+ aunque el jugador pueda pagarlo', () => {
    const state = createGame(
      [
        { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
        { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
      ],
      { edition: 'learning' }
    );
    const player = state.players[0];
    player.hand = [
      { ...getCard('coin-5'), instanceId: 'c1' },
      { ...getCard('coin-5'), instanceId: 'c2' },
      { ...getCard('coin-5'), instanceId: 'c3' },
    ];
    const actions = getLegalActions(state, player.id).filter((a) => a.type === 'buyAnimal');
    for (const action of actions) {
      if (action.type !== 'buyAnimal') continue;
      const animal = state.animalTrack.find((c) => c.instanceId === action.trackInstanceId);
      expect(animal?.marketCost ?? 0).toBeLessThanOrEqual(LEARNING_EDITION_MAX_COST);
    }
  });
});
