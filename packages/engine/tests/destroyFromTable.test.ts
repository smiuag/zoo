import { describe, expect, it } from 'vitest';
import { autoResolvePendingDiscard, createGame, getLegalActions, playCard, resolveDiscard } from '../src/engine';
import { getCard } from '../src/cards/registry';
import { buildStarterDeck } from './helpers';

function freshInstance(cardId: string, suffix: string) {
  return { ...getCard(cardId), instanceId: `${cardId}#${suffix}` };
}

function setup() {
  const state = createGame(
    [
      { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
      { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
    ],
    { edition: 'full' }
  );
  for (const player of state.players) {
    player.deck = [];
    player.hand = [];
    player.discard = [];
    player.table = [];
  }
  return { state, player: state.players[0], opponent: state.players[1] };
}

// Caso real reportado por el usuario (2026-09-21): un rival juega el
// Pteranodon y la ÚNICA ave barata del afectado está sobre su mesa, no en su
// mano. La web solo ofrecía cartas de la mano y la partida se quedaba
// bloqueada. El motor debe ofrecer esa carta como jugada legal y aceptarla.
describe('eliminar un animal que está sobre la mesa', () => {
  it('la carta de la mesa es la jugada legal, aunque la mano no tenga ninguna elegible', () => {
    const { state, player, opponent } = setup();
    const pteranodon = freshInstance('pteranodon', 'test');
    const hummingbird = freshInstance('hummingbird', 'mesa');
    player.hand = [pteranodon];
    opponent.hand = [freshInstance('sloth', 'a'), freshInstance('pig', 'b'), freshInstance('pterodactyl', 'c')];
    opponent.table = [hummingbird];

    playCard(state, player.id, pteranodon.instanceId);

    expect(state.pendingDecision?.kind).toBe('destroy');
    const legal = getLegalActions(state, opponent.id);
    expect(legal).toEqual([{ type: 'resolveDiscard', instanceId: hummingbird.instanceId }]);

    resolveDiscard(state, opponent.id, hummingbird.instanceId);
    expect(state.pendingDecision).toBeNull();
    expect(opponent.table).toHaveLength(0);
    expect(opponent.hand).toHaveLength(3);
    expect(player.destroyedCards.map((c) => c.instanceId)).toEqual([hummingbird.instanceId]);
  });

  it('la resolución por defecto (bots) también entrega la carta de la mesa', () => {
    const { state, player, opponent } = setup();
    const pteranodon = freshInstance('pteranodon', 'test');
    const hummingbird = freshInstance('hummingbird', 'mesa');
    player.hand = [pteranodon];
    opponent.hand = [freshInstance('sloth', 'a')];
    opponent.table = [hummingbird];

    playCard(state, player.id, pteranodon.instanceId);
    expect(autoResolvePendingDiscard(state)).toBe(true);

    expect(state.pendingDecision).toBeNull();
    expect(opponent.table).toHaveLength(0);
  });
});
