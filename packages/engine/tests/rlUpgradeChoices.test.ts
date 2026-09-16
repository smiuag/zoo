import { describe, expect, it } from 'vitest';
import { createGame, type Action } from '../src/engine';
import { filterUpgradeChoicesForRl } from '../src/bots/actionPriority';
import { getCard } from '../src/cards/registry';
import { buildStarterDeck } from './helpers';

function freshInstance(cardId: string, suffix: string) {
  return { ...getCard(cardId), instanceId: `${cardId}#${suffix}` };
}

describe('filterUpgradeChoicesForRl', () => {
  it('de las combinaciones del Flamenco, solo deja la de +maxCostDelta exacto', () => {
    const state = createGame([
      { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
      { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
    ]);
    const player = state.players[0];
    const flamingo = freshInstance('flamingo', 'f1'); // maxCostDelta: 2
    const turtle = freshInstance('turtle', 't1'); // coste 2
    player.hand = [flamingo, turtle];

    const rabbit = freshInstance('rabbit', 'r1'); // coste 2 (+0)
    const squirrel = freshInstance('squirrel', 's1'); // coste 3 (+1)
    const seal = freshInstance('seal', 'se1'); // coste 4 (+2, el máximo permitido)
    state.animalTrack = [rabbit, squirrel, seal];

    const actions: Action[] = [
      { type: 'playCard', instanceId: flamingo.instanceId, targetInstanceId: turtle.instanceId, secondaryTargetInstanceId: rabbit.instanceId },
      { type: 'playCard', instanceId: flamingo.instanceId, targetInstanceId: turtle.instanceId, secondaryTargetInstanceId: squirrel.instanceId },
      { type: 'playCard', instanceId: flamingo.instanceId, targetInstanceId: turtle.instanceId, secondaryTargetInstanceId: seal.instanceId },
      { type: 'endTurn' },
    ];

    const filtered = filterUpgradeChoicesForRl(state, player.id, actions);

    expect(filtered).toEqual([actions[2], actions[3]]);
  });

  it('deja intactas las acciones que no son un intercambio de returnAnimalForUpgrade', () => {
    const state = createGame([
      { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
      { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
    ]);
    const player = state.players[0];
    const monkey = freshInstance('monkey', 'm1');
    player.hand = [monkey];

    const actions: Action[] = [
      { type: 'playCard', instanceId: monkey.instanceId },
      { type: 'buyAnimal', trackInstanceId: 'x' },
      { type: 'endTurn' },
    ];

    expect(filterUpgradeChoicesForRl(state, player.id, actions)).toEqual(actions);
  });
});
