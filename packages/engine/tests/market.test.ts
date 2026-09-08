import { describe, expect, it } from 'vitest';
import { buyAnimal, buyCoin, canAffordMarket, createGame, endTurn, getActivePlayer, getLegalActions } from '../src/engine';
import { getCard } from '../src/cards/registry';
import { buildStarterDeck } from './helpers';
import type { CardInstance, GameState } from '../src/model/state';

function freshInstance(cardId: string, suffix: string) {
  return { ...getCard(cardId), instanceId: `${cardId}#${suffix}` };
}

function setupClean() {
  const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }]);
  const player = getActivePlayer(state);
  player.deck = [];
  player.hand = [];
  player.discard = [];
  return { state, player };
}

function trackCardWithCost(state: GameState, cost: number): CardInstance {
  const card = state.animalTrack.find((c) => c.marketCost === cost);
  if (!card) throw new Error(`No hay ningún animal de coste ${cost} en el mercado de este test`);
  return card;
}

function trackCardWithSpecies(state: GameState, species: string): CardInstance {
  const card = state.animalTrack.find((c) => c.species === species);
  if (!card) throw new Error(`No hay ningún ${species} en el mercado de este test`);
  return card;
}

describe('pago con monedas', () => {
  it('canAffordMarket sí cuenta 2 monedas de 1 como 2', () => {
    const { player } = setupClean();
    player.hand = [freshInstance('coin-1', 'a'), freshInstance('coin-1', 'b')];
    expect(canAffordMarket(player, 2)).toBe(true);
    expect(canAffordMarket(player, 3)).toBe(false);
  });

  it('comprar un animal gasta las monedas mínimas necesarias (prefiere no malgastar)', () => {
    const { state, player } = setupClean();
    player.hand = [freshInstance('coin-2', 'x'), freshInstance('coin-1', 'y')];
    const target = trackCardWithCost(state, 2);

    buyAnimal(state, player.id, target.instanceId);

    // Coste 2: debería gastar solo la moneda de 2, quedándose con la de 1.
    const coins = player.hand.filter((c) => c.type === 'coin');
    expect(coins).toHaveLength(1);
    expect(coins[0].value).toBe(1);
  });

  it('comprar un animal falla si no hay monedas suficientes', () => {
    const { state, player } = setupClean();
    player.hand = [freshInstance('coin-1', 'x')];
    const target = trackCardWithCost(state, 2);

    expect(() => buyAnimal(state, player.id, target.instanceId)).toThrow();
  });

  it('el valor de compra se reparte entre varias compras del mismo turno: una moneda de 3 paga algo de 2 y, con lo que sobra, algo de 1', () => {
    const { state, player } = setupClean();
    const coin3 = freshInstance('coin-3', 'x');
    player.hand = [coin3];
    const cost2 = trackCardWithCost(state, 2);

    buyAnimal(state, player.id, cost2.instanceId);

    // La moneda de 3 se descarta ENTERA (sigue siendo una Moneda de oro,
    // con su valor de siempre): lo que sobra (3 - 2 = 1) se convierte en
    // valor de compra genérico para el resto del turno.
    expect(player.hand.filter((c) => c.type === 'coin')).toHaveLength(0);
    expect(player.discard.some((c) => c.instanceId === coin3.instanceId)).toBe(true);
    expect(player.discard.find((c) => c.instanceId === coin3.instanceId)?.value).toBe(3);
    expect(player.bonusPurchasingPowerThisTurn).toBe(1);

    const cost1 = trackCardWithCost(state, 1);
    buyAnimal(state, player.id, cost1.instanceId);

    // Se paga entera con ese valor de compra sobrante, sin necesitar más monedas.
    expect(player.bonusPurchasingPowerThisTurn).toBe(0);
  });
});

describe('compra de animales: sin trabajador, pero como mucho 1 por ESPECIE y turno', () => {
  it('se pueden comprar varios animales distintos en el mismo turno aunque compartan hábitat', () => {
    const { state, player } = setupClean();
    player.hand = [freshInstance('coin-2', 'a'), freshInstance('coin-2', 'b'), freshInstance('coin-2', 'c')];

    // Pavo real y Periquito son ambos "volador": con el límite por especie
    // (no por hábitat) deben poder comprarse los dos en el mismo turno.
    const peacock = trackCardWithSpecies(state, 'peacock');
    buyAnimal(state, player.id, peacock.instanceId);
    const parakeet = trackCardWithSpecies(state, 'parakeet');
    buyAnimal(state, player.id, parakeet.instanceId);

    expect(player.discard.filter((c) => c.type === 'animal')).toHaveLength(2);
  });

  it('no se puede comprar un 2º animal de la MISMA especie en el mismo turno', () => {
    const { state, player } = setupClean();
    player.hand = [freshInstance('coin-2', 'a'), freshInstance('coin-2', 'b'), freshInstance('coin-2', 'c')];

    const dolphin = trackCardWithSpecies(state, 'dolphin');
    buyAnimal(state, player.id, dolphin.instanceId);
    // El mercado repone el hueco con otra copia de la misma especie.
    const secondDolphin = trackCardWithSpecies(state, 'dolphin');

    expect(() => buyAnimal(state, player.id, secondDolphin.instanceId)).toThrow();
    expect(getLegalActions(state, player.id)).not.toContainEqual({
      type: 'buyAnimal',
      trackInstanceId: secondDolphin.instanceId,
    });
  });

  it('el límite se reinicia al empezar el siguiente turno', () => {
    const { state, player } = setupClean();
    player.hand = [freshInstance('coin-3', 'a'), freshInstance('coin-3', 'b')];

    const dolphin = trackCardWithSpecies(state, 'dolphin');
    buyAnimal(state, player.id, dolphin.instanceId);
    expect(player.boughtSpeciesThisTurn).toContain('dolphin');

    player.boughtSpeciesThisTurn = [];
    const secondDolphin = trackCardWithSpecies(state, 'dolphin');
    expect(() => buyAnimal(state, player.id, secondDolphin.instanceId)).not.toThrow();
  });
});

describe('reposición del mercado', () => {
  it('comprar un animal repone su hueco con otro de la MISMA especie', () => {
    const { state, player } = setupClean();
    player.hand = [freshInstance('coin-2', 'a')];
    const target = trackCardWithCost(state, 2);
    const species = target.species;

    buyAnimal(state, player.id, target.instanceId);

    expect(state.animalTrack).toHaveLength(28);
    expect(state.animalTrack.some((c) => c.species === species)).toBe(true);
  });
});

describe('compra de monedas (coin-2 a 3, coin-3 a 5): suministro ilimitado', () => {
  it('comprar una moneda de 2 cuesta 3 y va al descarte', () => {
    const { state, player } = setupClean();
    player.hand = [freshInstance('coin-1', 'a'), freshInstance('coin-1', 'b'), freshInstance('coin-1', 'c')];

    buyCoin(state, player.id, 'coin-2');

    expect(player.hand).toHaveLength(0);
    expect(player.discard.filter((c) => c.id === 'coin-2')).toHaveLength(1);
  });

  it('comprar una moneda de 3 cuesta 5 y va al descarte', () => {
    const { state, player } = setupClean();
    player.hand = [freshInstance('coin-3', 'x'), freshInstance('coin-2', 'y')];

    buyCoin(state, player.id, 'coin-3');

    const coins = player.hand.filter((c) => c.type === 'coin');
    expect(coins).toHaveLength(0);
    expect(player.discard.filter((c) => c.id === 'coin-3')).toHaveLength(2); // la pagada + la comprada
  });

  it('falla si no hay monedas suficientes', () => {
    const { state, player } = setupClean();
    player.hand = [freshInstance('coin-1', 'a')];

    expect(() => buyCoin(state, player.id, 'coin-2')).toThrow();
  });

  it('el suministro es ilimitado: se puede comprar varias veces en el mismo turno', () => {
    const { state, player } = setupClean();
    player.hand = [
      freshInstance('coin-3', 'a'),
      freshInstance('coin-3', 'b'),
      freshInstance('coin-3', 'c'),
      freshInstance('coin-3', 'd'),
    ];

    buyCoin(state, player.id, 'coin-2');
    buyCoin(state, player.id, 'coin-2');

    expect(player.discard.filter((c) => c.id === 'coin-2')).toHaveLength(2);
  });
});

describe('getLegalActions y compra de animales', () => {
  it('no ofrece comprar un animal que no se puede pagar', () => {
    const { state, player } = setupClean();
    player.hand = [freshInstance('coin-1', 'a')];
    const target = trackCardWithCost(state, 2);

    const legal = getLegalActions(state, player.id);
    expect(legal.some((a) => a.type === 'buyAnimal' && a.trackInstanceId === target.instanceId)).toBe(false);
  });

  it('sí ofrece comprar un animal que se puede pagar', () => {
    const { state, player } = setupClean();
    player.hand = [freshInstance('coin-2', 'a')];
    const target = trackCardWithCost(state, 2);

    const legal = getLegalActions(state, player.id);
    expect(legal.some((a) => a.type === 'buyAnimal' && a.trackInstanceId === target.instanceId)).toBe(true);
  });

  it('no ofrece comprar monedas si no llega al coste de ninguna (3 y 5)', () => {
    const { state, player } = setupClean();
    player.hand = [freshInstance('coin-1', 'a'), freshInstance('coin-1', 'b')];

    const legal = getLegalActions(state, player.id);
    expect(legal.some((a) => a.type === 'buyCoin')).toBe(false);
  });

  it('ofrece comprar coin-2 con 3 monedas, pero no coin-3 (necesita 5)', () => {
    const { state, player } = setupClean();
    player.hand = [freshInstance('coin-1', 'a'), freshInstance('coin-1', 'b'), freshInstance('coin-1', 'c')];

    const legal = getLegalActions(state, player.id);
    expect(legal.some((a) => a.type === 'buyCoin' && a.coinId === 'coin-2')).toBe(true);
    expect(legal.some((a) => a.type === 'buyCoin' && a.coinId === 'coin-3')).toBe(false);
  });
});

describe('estadísticas para el resumen final: purchasesCount y richestTurn', () => {
  it('purchasesCount cuenta cada compra (animal o moneda) hecha en toda la partida', () => {
    const { state, player } = setupClean();
    expect(player.purchasesCount).toBe(0);
    player.hand = [
      freshInstance('coin-1', 'a'),
      freshInstance('coin-1', 'b'),
      freshInstance('coin-1', 'c'),
      freshInstance('coin-1', 'd'),
      freshInstance('coin-1', 'e'),
    ];
    const cheapAnimal = trackCardWithCost(state, 1);

    buyAnimal(state, player.id, cheapAnimal.instanceId); // gasta 1 moneda de 1
    expect(player.purchasesCount).toBe(1);

    buyCoin(state, player.id, 'coin-2'); // cuesta 3, quedan monedas de sobra
    expect(player.purchasesCount).toBe(2);
  });

  it('richestTurn guarda la ronda y las monedas con las que empezó su turno más rico, y no baja si un turno posterior es más pobre', () => {
    const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }]);
    const player = getActivePlayer(state);
    // Se sustituye el estado inicial (mano/mazo barajados al azar) por uno
    // controlado, para poder predecir exactamente qué mano se roba después.
    player.hand = [freshInstance('coin-1', 'poor')]; // turno actual: 1 moneda
    player.discard = [];
    player.richestTurn = { round: state.round, coins: 1 };

    // El próximo turno (tras endTurn) robará este mazo: 5 monedas de 3 = 15.
    player.deck = Array.from({ length: 5 }, (_, i) => freshInstance('coin-3', `rich${i}`));
    const roundBeforeRichTurn = state.round;
    endTurn(state, player.id);

    expect(player.richestTurn).toEqual({ round: roundBeforeRichTurn + 1, coins: 15 });

    // El turno siguiente es más pobre (5 monedas de 1 = 5 en total, menos
    // que las 15 anteriores): richestTurn no debe cambiar. El mazo tiene
    // EXACTAMENTE las 5 cartas que se van a robar, para que drawCards nunca
    // necesite rebarajar el descarte (que en este punto tiene las 5 monedas
    // de 3 recién descartadas: si drawCards tuviera que tocarlo, la mano
    // nueva saldría contaminada con ellas).
    player.deck = Array.from({ length: 5 }, (_, i) => freshInstance('coin-1', `poorAgain${i}`));
    endTurn(state, player.id);

    expect(player.richestTurn).toEqual({ round: roundBeforeRichTurn + 1, coins: 15 });
  });
});
