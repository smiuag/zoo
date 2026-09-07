import { describe, expect, it } from 'vitest';
import { createGame, getActivePlayer, getLegalActions } from '../src/engine';
import { encodeAction, FEATURE_DIM } from '../src/bots/rl/features';
import { buildStarterDeck } from './helpers';

describe('rl/features', () => {
  it('encodeAction siempre devuelve un vector de longitud FEATURE_DIM sin NaN/Infinity', () => {
    const state = createGame([
      { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
      { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
    ]);
    const player = getActivePlayer(state);

    for (const action of getLegalActions(state, player.id)) {
      const features = encodeAction(state, player.id, action);
      expect(features).toHaveLength(FEATURE_DIM);
      for (const f of features) expect(Number.isFinite(f)).toBe(true);
    }
  });

  it('no genera NaN/Infinity aunque varios mazos compartidos estén agotados', () => {
    const state = createGame([
      { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
      { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
    ]);
    for (const deck of Object.values(state.sharedDecks)) deck.length = 0;
    const player = getActivePlayer(state);

    for (const action of getLegalActions(state, player.id)) {
      const features = encodeAction(state, player.id, action);
      for (const f of features) expect(Number.isFinite(f)).toBe(true);
    }
  });

  it('no filtra el contenido de la mano de un rival, solo su tamaño', () => {
    const state = createGame([
      { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
      { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
    ]);
    const bob = state.players.find((p) => p.id === 'p2')!;
    const before = encodeAction(state, 'p1', { type: 'endTurn' });

    // Mismo tamaño de mano, contenido distinto: no debería cambiar nada de
    // lo que "ve" Alice al valorar su propia acción.
    bob.hand = bob.hand.map((card) => ({
      ...card,
      instanceId: `${card.instanceId}-swapped`,
      victoryPoints: card.victoryPoints + 5,
    }));
    const after = encodeAction(state, 'p1', { type: 'endTurn' });

    expect(after).toEqual(before);
  });
});
