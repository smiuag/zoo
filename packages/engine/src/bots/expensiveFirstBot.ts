import { getLegalActions, type Action } from '../engine';
import { getCard } from '../cards/registry';
import type { CardInstance, GameState, Player } from '../model/state';
import type { Bot } from './types';

// Bot con una estrategia deliberadamente distinta a heuristicBot (que
// prioriza ratio PV/coste, y por eso converge siempre en el mismo puñado
// de "mejores" especies baratas/medias): este prioriza SIEMPRE comprar la
// especie más CARA que se pueda pagar, sin mirar su PV. Solo cuando no hay
// nada que comprar decide qué jugar de la mano, y ahí prioriza las cartas
// que generan dinero (mejoran monedas o dan dinero extra de compra) para
// poder llegar antes a las compras caras. Sirve para comprobar si "casi
// nunca se compran las especies más caras" es un problema del juego o solo
// de cómo decide heuristicBot.

function findInHand(player: Player, instanceId: string): CardInstance | undefined {
  return player.hand.find((c) => c.instanceId === instanceId);
}
function findInTrack(state: GameState, instanceId: string): CardInstance | undefined {
  return state.animalTrack.find((c) => c.instanceId === instanceId);
}

// Robar ANTES que las de dinero "por cada X en tu mano" (ver DRAW_EFFECTS
// abajo): jugar antes la carta de robo aumenta la mano y por tanto lo que
// cuentan después estas — orden explícito pedido por el usuario, aplica
// igual aquí que en heuristicBot aunque este bot ya tenga su propia
// prioridad de compra distinta.
const DRAW_EFFECTS = new Set(['drawCards', 'drawThenTopdeck', 'drawTopUnlessExpensiveAnimal']);

const FLAT_MONEY_GENERATING_EFFECTS = new Set([
  'upgradeCoin', // Tortuga: mejora 1 moneda
  'gainFlatBonusPurchasingPower', // León
  'gainAquaticOnlyBonusPurchasingPower', // Foca (restringido a comprar acuáticos, pero cantidad fija)
  'gainCoin', // Pingüino: moneda de verdad, no solo bonus temporal
]);

// A diferencia de las de arriba, su valor depende de CUÁNTO tengas en la
// mano en ese momento: conviene jugarlas después de cualquier carta de
// robo disponible (ver DRAW_EFFECTS), nunca antes.
const HAND_COUNT_MONEY_GENERATING_EFFECTS = new Set([
  'gainBonusPurchasingPowerPerHabitatInHand', // Delfín / Mono
  'gainBonusPurchasingPowerPerDistinctSpeciesInHand', // Ornitorrinco
]);

function playCardScore(card: CardInstance): number {
  const types = card.effects.map((e) => e.type);
  if (types.some((t) => DRAW_EFFECTS.has(t))) return 210;
  if (types.some((t) => FLAT_MONEY_GENERATING_EFFECTS.has(t))) return 200;
  if (types.some((t) => HAND_COUNT_MONEY_GENERATING_EFFECTS.has(t))) return 190;
  return 100;
}

function scoreAction(state: GameState, player: Player, action: Action): number {
  switch (action.type) {
    case 'buyAnimal': {
      // Prioridad 1, sin excepciones: cuanto más cara, mejor. No mira PV ni
      // ratio: si te la puedes permitir, cómprala.
      const track = findInTrack(state, action.trackInstanceId);
      if (!track) return -Infinity;
      return 1000 + (track.marketCost ?? 0) * 10;
    }

    case 'buyCoin': {
      // Comprar una moneda mayor también es "generar dinero" para llegar
      // antes a la compra cara: por debajo de cualquier compra de animal,
      // por encima de jugar una carta cualquiera.
      const coin = getCard(action.coinId);
      return 250 + (coin.marketCost ?? 0);
    }

    case 'playCard': {
      // Prioridad 2: entre lo que se puede jugar de la mano, prioriza lo
      // que genera dinero (para poder pagar antes una compra cara) sobre
      // cualquier otra cosa — y dentro del dinero, robar antes que las de
      // "por cada X en tu mano" (ver playCardScore arriba).
      const card = findInHand(player, action.instanceId);
      if (!card) return -Infinity;
      return playCardScore(card);
    }

    case 'endTurn':
      return 10;
  }
  return 0;
}

const TIE_EPSILON = 1e-9;

export const expensiveFirstBot: Bot = {
  chooseAction(state, playerId) {
    const actions = getLegalActions(state, playerId);
    if (actions.length === 0) return { type: 'endTurn' };

    const player = state.players.find((p) => p.id === playerId);
    if (!player) return { type: 'endTurn' };

    let bestScore = -Infinity;
    for (const action of actions) {
      const score = scoreAction(state, player, action);
      if (score > bestScore) bestScore = score;
    }
    const bestActions = actions.filter((action) => scoreAction(state, player, action) >= bestScore - TIE_EPSILON);
    return bestActions[Math.floor(Math.random() * bestActions.length)];
  },
};
