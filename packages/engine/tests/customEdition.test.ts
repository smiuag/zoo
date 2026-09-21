import { describe, expect, it } from 'vitest';
import { createGame, initialMarketCopies, marketSpeciesFor } from '../src/engine';
import { getCard } from '../src/cards/registry';
import { buildStarterDeck } from './helpers';

describe('edición "Personalizado" (edition: "custom")', () => {
  it('marketSpeciesFor devuelve exactamente la lista elegida, nada más', () => {
    const chosen = ['lion', 'dog', 'mosasaurus'];
    expect(marketSpeciesFor({ edition: 'custom', customSpeciesList: chosen })).toEqual(chosen);
  });

  it('marketSpeciesFor da un array vacío si no hay lista elegida (nunca revienta)', () => {
    expect(marketSpeciesFor({ edition: 'custom' })).toEqual([]);
  });

  it('createGame con edition "custom" limita el mercado exactamente a las especies elegidas', () => {
    const chosen = ['lion', 'tiger', 'dog', 'hummingbird'];
    const state = createGame(
      [
        { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
        { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
      ],
      { edition: 'custom', customSpecies: chosen }
    );
    expect(state.edition).toBe('custom');
    expect(state.customSpeciesList).toEqual(chosen);
    expect(state.animalTrack).toHaveLength(chosen.length);
    for (const card of state.animalTrack) expect(chosen).toContain(card.species);
    expect(Object.keys(state.sharedDecks).sort()).toEqual([...chosen, 'sloth'].sort());
  });

  it('una especie exclusiva de la completa en una partida "custom" conserva sus tipos extra', () => {
    const state = createGame(
      [
        { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
        { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
      ],
      { edition: 'custom', customSpecies: ['dog', 'lion'] }
    );
    const mintedDog = [...state.animalTrack, ...state.sharedDecks['dog']].find((c) => c.id === 'dog')!;
    // Dog pierde el tipo 'pet' en clásica/aprendizaje (ver mintInstance) —
    // en 'custom' debe conservarlo, igual que en 'full'.
    expect(mintedDog.habitats).toContain('pet');
  });

  it('una carta CLÁSICA con texto alternativo en la completa (Cocodrilo) usa ese texto en una partida "custom"', () => {
    const state = createGame(
      [
        { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
        { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
      ],
      { edition: 'custom', customSpecies: ['crocodile', 'lion'] }
    );
    const mintedCroc = [...state.animalTrack, ...state.sharedDecks['crocodile']].find((c) => c.id === 'crocodile')!;
    expect(mintedCroc.text).toBe(getCard('crocodile').fullEditionText);
    expect(mintedCroc.habitats).toContain('dinosaur');
  });

  it('initialMarketCopies aplica el delta correcto por tramo de coste, con suelo de 1 copia', () => {
    // 2 jugadores, carta barata (coste<5): CON deltas, el delta se aplica
    // directamente sobre numPlayers en los dos tramos (no sobre el "+2"
    // oculto del caso sin deltas) — pedido explícito del usuario
    // 2026-09-21, "que sea sobre el número de jugadores en ambos casos".
    expect(initialMarketCopies(3, 2, { cheap: 1, expensive: 0 })).toBe(3);
    // Un delta que se iría a 0 o menos se clampa a 1, nunca 0 (una especie
    // elegida nunca debe quedarse sin ninguna copia).
    expect(initialMarketCopies(3, 2, { cheap: -2, expensive: 0 })).toBe(1);
    // 2 jugadores, carta cara (coste>=5): igual, sobre numPlayers.
    expect(initialMarketCopies(7, 2, { cheap: 0, expensive: -2 })).toBe(1);
    expect(initialMarketCopies(7, 2, { cheap: 0, expensive: 2 })).toBe(4);
    // Sin deltas, se comporta exactamente igual que siempre (base oculta
    // numPlayers+2 en baratas, numPlayers en caras).
    expect(initialMarketCopies(7, 2)).toBe(2);
    expect(initialMarketCopies(3, 2)).toBe(4);
  });

  it('createGame aplica los deltas de verdad al construir el mercado', () => {
    const state = createGame(
      [
        { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
        { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
      ],
      { edition: 'custom', customSpecies: ['lion'], customCopyDeltas: { cheap: 0, expensive: -2 } }
    );
    // Lion cuesta 5 (tramo caro): base numPlayers(2) - 2 -> clamp a 1. Una ya
    // está en el mercado (animalTrack), así que sharedDecks queda vacío.
    expect(state.animalTrack).toHaveLength(1);
    expect(state.sharedDecks['lion']).toHaveLength(0);
  });
});
