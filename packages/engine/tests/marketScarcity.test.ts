import { describe, expect, it } from 'vitest';
import { createGame } from '../src/engine';
import { getCard } from '../src/cards/registry';
import { computeMarketScarcity } from '../src/bots/rl/marketScarcity';
import { buildStarterDeck } from './helpers';

describe('bots/rl/marketScarcity', () => {
  it('en una partida recién creada, ningún jugador ha comprado nada: todos los ratios son 1', () => {
    const state = createGame([
      { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
      { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
    ]);

    const scarcity = computeMarketScarcity(state);
    for (const ratio of [...scarcity.habitat, ...scarcity.costTier]) {
      expect(ratio).toBeCloseTo(1, 5);
    }
  });

  it('agotar todas las copias de una especie baja su ratio de hábitat y de tramo de coste', () => {
    const state = createGame([
      { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
      { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
    ]);

    // El León es 'land', coste 5+ (tramo caro) en el juego real; buscamos
    // dinámicamente una especie cara y puramente terrestre para no acoplar
    // el test a datos concretos de una carta.
    const species = Object.keys(state.sharedDecks).find((s) => {
      if (s === 'sloth') return false;
      const card = getCard(s);
      return (card.marketCost ?? 0) >= 5 && card.habitats?.length === 1 && card.habitats[0] === 'land';
    });
    expect(species).toBeDefined();

    state.sharedDecks[species!] = [];
    state.animalTrack = state.animalTrack.filter((c) => c.species !== species);

    const before = computeMarketScarcity(state);
    // El propio agotamiento ya se refleja en el estado usado para "before",
    // así que comparamos contra una partida gemela sin tocar.
    const untouched = createGame([
      { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
      { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
    ]);
    const baseline = computeMarketScarcity(untouched);

    expect(before.habitat[0]).toBeLessThan(baseline.habitat[0]); // land es el índice 0
    expect(before.costTier[2]).toBeLessThan(baseline.costTier[2]); // caro es el índice 2
    // No debería afectar a categorías que esa especie no toca.
    expect(before.habitat[1]).toBeCloseTo(baseline.habitat[1], 5); // bird
    expect(before.habitat[2]).toBeCloseTo(baseline.habitat[2], 5); // aquatic
  });
});
