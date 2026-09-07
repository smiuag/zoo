import { describe, expect, it } from 'vitest';
import { createGame, getActivePlayer } from '../src/engine';
import { getCard } from '../src/cards/registry';
import { buildStarterDeck } from './helpers';

describe('createGame', () => {
  it('arma el mazo inicial de 10 cartas: 7 monedas de 1 + 3 Perezosos', () => {
    const state = createGame([
      { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
      { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
    ]);

    expect(state.players).toHaveLength(2);
    for (const player of state.players) {
      const total = player.deck.length + player.hand.length;
      expect(total).toBe(10);

      const all = [...player.deck, ...player.hand];
      expect(all.filter((c) => c.id === 'coin-1')).toHaveLength(7);
      expect(all.filter((c) => c.id === 'sloth')).toHaveLength(3);
    }
  });

  it('el turno 1 empieza con el primer jugador activo, mano de 5 y bonus a 0', () => {
    const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }]);

    expect(state.turn).toBe(1);
    const active = getActivePlayer(state);
    expect(active.id).toBe('p1');
    expect(active.hand).toHaveLength(5);
    expect(active.bonusPurchasingPowerThisTurn).toBe(0);
  });

  it('el mercado de animales empieza con 1 hueco por cada una de las 26 especies', () => {
    const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }]);

    expect(state.animalTrack).toHaveLength(26);
    const species = new Set(state.animalTrack.map((c) => c.species));
    expect(species.size).toBe(26);
  });

  it('cada mazo de especie tiene sus copias fijas (menos 1 ya repuesta en el mercado): 10, o solo 5 si cuesta 5 o más', () => {
    const state = createGame([
      { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
      { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
    ]);
    for (const [species, deck] of Object.entries(state.sharedDecks)) {
      const inTrack = state.animalTrack.filter((c) => c.species === species).length;
      const expectedCopies = (getCard(species).marketCost ?? 0) >= 5 ? 5 : 10;
      expect(deck.length + inTrack).toBe(expectedCopies);
    }
  });
});
