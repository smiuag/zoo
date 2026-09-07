import { describe, expect, it } from 'vitest';
import { applyAction, createGame, getActivePlayer, getLegalActions } from '../src/engine';
import { randomBot } from '../src/bots/randomBot';
import { buildStarterDeck } from './helpers';

describe('randomBot', () => {
  it('juega una partida completa entre dos bots (con mercado) sin lanzar errores', () => {
    const state = createGame([
      { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
      { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
    ]);

    for (let i = 0; i < 200 && !state.gameOver; i++) {
      const player = getActivePlayer(state);
      const action = randomBot.chooseAction(state, player.id);
      applyAction(state, player.id, action);
    }

    expect(state.turn).toBeGreaterThan(1);
  });

  it('siempre devuelve una acción legal', () => {
    const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }]);

    const action = randomBot.chooseAction(state, 'p1');
    const legal = getLegalActions(state, 'p1');
    expect(legal).toContainEqual(action);
  });
});
