import { describe, expect, it } from 'vitest';
import { applyAction, createGame } from '../src/engine';
import { heuristicBot } from '../src/bots/heuristicBot';
import { getCard } from '../src/cards/registry';
import { buildStarterDeck } from './helpers';

function freshInstance(cardId: string, suffix: string) {
  return { ...getCard(cardId), instanceId: `${cardId}#${suffix}` };
}

describe('heuristicBot: no debe atascarse jugando Murciélago contra Murciélago sin fin', () => {
  it('con un Murciélago en mano y otro encima del mazo, prefiere terminar el turno al intercambio sin sentido', () => {
    const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }]);
    const player = state.players[0];
    player.hand = [freshInstance('bat', 'a')];
    player.deck = [freshInstance('bat', 'b')]; // encima del mazo: mismo id, intercambio no-op
    player.discard = [];

    const action = heuristicBot.chooseAction(state, player.id);
    expect(action).toEqual({ type: 'endTurn' });
  });

  it('nunca queda atascado alternando Murciélagos sin fin: el turno avanza en pocos pasos', () => {
    const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }]);
    const player = state.players[0];
    player.hand = [freshInstance('bat', 'a')];
    player.deck = [freshInstance('bat', 'b')];
    player.discard = [];

    for (let i = 0; i < 5 && state.turn === 1; i++) {
      const action = heuristicBot.chooseAction(state, player.id);
      applyAction(state, player.id, action);
    }

    expect(state.turn).toBeGreaterThan(1);
  });
});
