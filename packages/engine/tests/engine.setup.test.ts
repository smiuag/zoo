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

  it('el mercado de animales empieza con 1 hueco por cada una de las 34 especies', () => {
    const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }]);

    expect(state.animalTrack).toHaveLength(34);
    const species = new Set(state.animalTrack.map((c) => c.species));
    expect(species.size).toBe(34);
  });

  it('cada mazo de especie tiene copias escaladas al nº de jugadores (menos 1 ya repuesta en el mercado): jugadores+2, o solo jugadores si cuesta 5 o más', () => {
    const state = createGame([
      { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
      { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
    ]);
    const numPlayers = state.players.length;
    // "sloth" no es una especie de mercado (ver isMarketSpecies en
    // engine.ts): es solo el almacén donde aterriza un Perezoso devuelto por
    // el Flamenco, así que no tiene un número de copias fijo que comprobar.
    for (const [species, deck] of Object.entries(state.sharedDecks)) {
      if (species === 'sloth') continue;
      const inTrack = state.animalTrack.filter((c) => c.species === species).length;
      const expectedCopies = (getCard(species).marketCost ?? 0) >= 5 ? numPlayers : numPlayers + 2;
      expect(deck.length + inTrack).toBe(expectedCopies);
    }
  });

  it('con más jugadores, cada mazo de especie tiene más copias (escala con el nº de jugadores)', () => {
    const state4 = createGame([
      { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
      { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
      { id: 'p3', name: 'Carol', deck: buildStarterDeck() },
      { id: 'p4', name: 'Dave', deck: buildStarterDeck() },
    ]);
    const cheapSpecies = Object.keys(state4.sharedDecks).find(
      (s) => s !== 'sloth' && (getCard(s).marketCost ?? 0) < 5
    )!;
    const expensiveSpecies = Object.keys(state4.sharedDecks).find(
      (s) => s !== 'sloth' && (getCard(s).marketCost ?? 0) >= 5
    )!;
    const inTrack = (state: ReturnType<typeof createGame>, species: string) =>
      state.animalTrack.filter((c) => c.species === species).length;

    expect(state4.sharedDecks[cheapSpecies].length + inTrack(state4, cheapSpecies)).toBe(6); // 4 jugadores + 2
    expect(state4.sharedDecks[expensiveSpecies].length + inTrack(state4, expensiveSpecies)).toBe(4); // 4 jugadores
  });
});
