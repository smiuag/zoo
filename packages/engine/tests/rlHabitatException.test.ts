import { describe, expect, it } from 'vitest';
import { createGame, type Action } from '../src/engine';
import { filterActionsByHabitat } from '../src/bots/actionPriority';
import { getCard } from '../src/cards/registry';
import { buildStarterDeck } from './helpers';

function freshInstance(cardId: string, suffix: string) {
  return { ...getCard(cardId), instanceId: `${cardId}#${suffix}` };
}

describe('filterActionsByHabitat', () => {
  it('deja comprar cartas con efecto onScore "acumulativo" aunque no sean del hábitat filtrado', () => {
    const state = createGame([
      { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
      { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
    ]);
    const orca = freshInstance('orca', 'o1'); // aquatic, scorePerHabitatCount
    const dolphin = freshInstance('dolphin', 'd1'); // aquatic, sin efecto acumulativo
    state.animalTrack = [orca, dolphin];

    const actions: Action[] = [
      { type: 'buyAnimal', trackInstanceId: orca.instanceId },
      { type: 'buyAnimal', trackInstanceId: dolphin.instanceId },
      { type: 'endTurn' },
    ];

    const filtered = filterActionsByHabitat(state, actions, 'land');

    expect(filtered).toEqual([actions[0], actions[2]]);
  });

  it('sin excepción de por medio, sigue filtrando por hábitat con normalidad', () => {
    const state = createGame([
      { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
      { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
    ]);
    const dolphin = freshInstance('dolphin', 'd1'); // aquatic
    const monkey = freshInstance('monkey', 'm1'); // land
    state.animalTrack = [dolphin, monkey];

    const actions: Action[] = [
      { type: 'buyAnimal', trackInstanceId: dolphin.instanceId },
      { type: 'buyAnimal', trackInstanceId: monkey.instanceId },
    ];

    expect(filterActionsByHabitat(state, actions, 'land')).toEqual([actions[1]]);
  });
});
