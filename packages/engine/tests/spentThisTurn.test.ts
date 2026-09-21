import { describe, expect, it } from 'vitest';
import { applyAction, buyAnimal, createGame, currentPurchasingPower, endTurn, getLegalActions } from '../src/engine';
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
  }
  return { state, player: state.players[0] };
}

// La web muestra "disponible / total" con total = disponible + spentThisTurn.
// Lo que se comprueba aquí es la invariante que lo hace fiable: sin comprar,
// spentThisTurn no se mueve haga lo que haga una carta con las monedas.
describe('spentThisTurn: lo pagado en compras este turno', () => {
  it('empieza en 0 y una compra lo sube exactamente por el coste cobrado', () => {
    const { state, player } = setup();
    player.hand = [freshInstance('coin-3', 'a'), freshInstance('coin-1', 'b')];
    expect(player.spentThisTurn).toBe(0);
    const rabbit = state.animalTrack.find((c) => c.id === 'rabbit')!; // coste 2
    const before = currentPurchasingPower(player);

    buyAnimal(state, player.id, rabbit.instanceId);

    expect(player.spentThisTurn).toBe(2);
    // El cambio vuelve como bonus: lo disponible baja justo lo gastado, así que el total no cambia.
    expect(currentPurchasingPower(player) + (player.spentThisTurn ?? 0)).toBe(before);
  });

  it('Cerdo: descartar una moneda para robar NO cuenta como gastado', () => {
    const { state, player } = setup();
    const pig = freshInstance('pig', 'test');
    player.hand = [pig, freshInstance('coin-2', 'a'), freshInstance('coin-1', 'b')];
    player.deck = [freshInstance('coin-1', 'c'), freshInstance('sloth', 'd')];

    const play = getLegalActions(state, player.id).find((a) => a.type === 'playCard' && a.instanceId === pig.instanceId)!;
    applyAction(state, player.id, play);

    expect(player.spentThisTurn).toBe(0);
  });

  it('Pez Dorado: cambiar una moneda por otra tampoco cuenta como gastado', () => {
    const { state, player } = setup();
    const fish = freshInstance('golden-fish', 'test');
    player.hand = [fish, freshInstance('coin-1', 'a')];

    const play = getLegalActions(state, player.id).find((a) => a.type === 'playCard' && a.instanceId === fish.instanceId)!;
    applyAction(state, player.id, play);

    expect(player.spentThisTurn).toBe(0);
  });

  it('se pone a 0 al empezar el siguiente turno del jugador', () => {
    const { state, player } = setup();
    player.hand = [freshInstance('coin-3', 'a')];
    const rabbit = state.animalTrack.find((c) => c.id === 'rabbit')!;
    buyAnimal(state, player.id, rabbit.instanceId);
    expect(player.spentThisTurn).toBe(2);

    endTurn(state, player.id);
    endTurn(state, state.players[1].id);

    expect(player.spentThisTurn).toBe(0);
  });
});
