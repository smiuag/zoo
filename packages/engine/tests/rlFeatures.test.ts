import { describe, expect, it } from 'vitest';
import { createGame, getActivePlayer, getLegalActions } from '../src/engine';
import { getCard } from '../src/cards/registry';
import { CRITIC_FEATURE_DIM, encodeAction, encodePlayerContext, FEATURE_DIM } from '../src/bots/rl/features';
import { buildStarterDeck } from './helpers';

describe('rl/features', () => {
  it('encodePlayerContext (estado del crítico) siempre mide CRITIC_FEATURE_DIM, sin NaN/Infinity', () => {
    const state = createGame([
      { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
      { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
    ]);
    const player = getActivePlayer(state);

    const features = encodePlayerContext(state, player);
    expect(features).toHaveLength(CRITIC_FEATURE_DIM);
    for (const f of features) expect(Number.isFinite(f)).toBe(true);
  });

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

  it('el contexto cambia si el jugador tiene más cartas de moneda en su colección (Tiburón)', () => {
    const state = createGame([
      { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
      { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
    ]);
    const alice = state.players.find((p) => p.id === 'p1')!;
    const before = encodePlayerContext(state, alice);

    // Mismo valor total en mano (coinSum no cambia), pero más CARTAS de
    // moneda en el descarte: coinCardCount debería reflejarlo aunque coinSum
    // no se mueva.
    const coin1 = getCard('coin-1');
    alice.discard.push(
      { ...coin1, instanceId: 'extra-coin-1' },
      { ...coin1, instanceId: 'extra-coin-2' }
    );
    const after = encodePlayerContext(state, alice);

    expect(after).not.toEqual(before);
  });
});
