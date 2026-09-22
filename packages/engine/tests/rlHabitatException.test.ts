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

  it('deja comprar al Gato aunque no sea del hábitat filtrado', () => {
    const state = createGame([
      { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
      { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
    ]);
    const cat = freshInstance('cat', 'c1'); // land, pet
    const dolphin = freshInstance('dolphin', 'd1'); // aquatic, sin excepción
    state.animalTrack = [cat, dolphin];

    const actions: Action[] = [
      { type: 'buyAnimal', trackInstanceId: cat.instanceId },
      { type: 'buyAnimal', trackInstanceId: dolphin.instanceId },
    ];

    expect(filterActionsByHabitat(state, actions, 'aquatic')).toEqual([actions[0], actions[1]]);
    expect(filterActionsByHabitat(state, actions, 'bird')).toEqual([actions[0]]);
  });

  it('deja comprar dinosaurios de coste 7 o más aunque no sean del hábitat filtrado, pero no los más baratos', () => {
    const state = createGame([
      { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
      { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
    ]);
    const tyrannosaurus = freshInstance('tyrannosaurus', 't1'); // land, dinosaur, coste 9
    const pterodactyl = freshInstance('pterodactyl', 'p1'); // bird, dinosaur, coste 7
    const hummingbird = freshInstance('hummingbird', 'h1'); // bird, pet, dinosaur, coste 1: no cuenta como "grande"
    state.animalTrack = [tyrannosaurus, pterodactyl, hummingbird];

    const actions: Action[] = [
      { type: 'buyAnimal', trackInstanceId: tyrannosaurus.instanceId },
      { type: 'buyAnimal', trackInstanceId: pterodactyl.instanceId },
      { type: 'buyAnimal', trackInstanceId: hummingbird.instanceId },
    ];

    // Ninguno de los 3 es "aquatic": el filtro por 'aquatic' solo deja pasar
    // a los dos dinosaurios caros (excepción), nunca al Colibrí barato.
    expect(filterActionsByHabitat(state, actions, 'aquatic')).toEqual([actions[0], actions[1]]);
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
