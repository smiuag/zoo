import { getLegalActions, type Action } from '../engine';
import type { GameState } from '../model/state';

// Efectos que de verdad te dejan con más cartas en la mano de las que
// tenías ("Roba X cartas" en el texto de la carta): el mismo conjunto que
// ya usaba expensiveFirstBot para decidir QUÉ jugar primero entre varias
// opciones — aquí se reutiliza para la ley de prioridad de TODOS los bots
// (ver legalActionsForBot más abajo).
export const DRAW_EFFECT_TYPES = new Set(['drawCards', 'drawThenTopdeck', 'drawTopUnlessExpensiveAnimal']);

function isDrawCardAction(state: GameState, playerId: string, action: Action): boolean {
  if (action.type !== 'playCard') return false;
  const player = state.players.find((p) => p.id === playerId);
  const card = player?.hand.find((c) => c.instanceId === action.instanceId);
  return card?.effects.some((e) => e.trigger === 'onPlay' && DRAW_EFFECT_TYPES.has(e.type)) ?? false;
}

// LEY para todos los bots y para el entrenamiento RL (pedido explícito del
// usuario, 2026-09-16 — antes esto era solo una preferencia suave dentro de
// cada bot, p. ej. el "+210 en vez de +100" de expensiveFirstBot, que otras
// puntuaciones más altas podían pisar): antes de que cada bot puntúe/elija
// nada con su propia lógica, esta función recorta getLegalActions al ÚNICO
// nivel de prioridad disponible ahora mismo —
//   1) jugar una carta de la mano que te haga robar de alguna manera
//   2) cualquier otra carta de la mano
//   3) comprar (animal o moneda) / terminar turno
// — así ningún bot puede elegir comprar teniendo cartas por jugar, ni jugar
// una carta cualquiera teniendo una de robo disponible, sea cual sea su
// propia puntuación interna. Nunca toca un descarte forzoso pendiente ni la
// elección de la Serpiente (getLegalActions ya devuelve solo eso cuando
// toca, nunca mezclado con jugar/comprar — aquí los tres filtros salen
// vacíos y se cae al `return actions` final, la lista tal cual).
export function legalActionsForBot(state: GameState, playerId: string): Action[] {
  const actions = getLegalActions(state, playerId);

  const drawActions = actions.filter((a) => isDrawCardAction(state, playerId, a));
  if (drawActions.length > 0) return drawActions;

  const playActions = actions.filter((a) => a.type === 'playCard');
  if (playActions.length > 0) return playActions;

  return actions;
}
