import { getLegalActions, type Action } from '../engine';
import { COMPOUNDING_SCORE_EFFECT_TYPES } from '../effects/registry';
import { effectiveHand, type CardInstance, type GameState, type Player } from '../model/state';

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

function hasCompoundingScoreEffect(card: CardInstance): boolean {
  return card.effects.some((e) => e.trigger === 'onScore' && COMPOUNDING_SCORE_EFFECT_TYPES.has(e.type));
}

// Filtra buyAnimal a un solo hábitat (especialistas de RL, ver
// habitatFilter en rlBot.ts y HABITAT_FILTER en trainCore.ts), con UNA
// excepción: cartas con un efecto onScore "acumulativo" (Águila/Orca/Oso
// polar/Albatros/Tucán/Tiburón, ver COMPOUNDING_SCORE_EFFECT_TYPES) se
// pueden comprar aunque no encajen con el hábitat — pedido explícito del
// usuario, 2026-09-16: su valor no depende de que la carta en sí sea de tu
// hábitat (el bonus de la Orca es sobre TUS acuáticos, no sobre si Orca lo
// es), así que vetarlas de raíz le impedía a cualquier especialista aprender
// si alguna vez merece la pena hacerse con una de todas formas (por su otro
// efecto onPlay, o para topear puntuación al final). Antes esta lógica vivía
// duplicada e idéntica dentro de rlBot.ts; ahora la comparten ambos sitios.
export function filterActionsByHabitat(state: GameState, actions: Action[], habitat: string): Action[] {
  return actions.filter((action) => {
    if (action.type !== 'buyAnimal') return true;
    const animal = state.animalTrack.find((c) => c.instanceId === action.trackInstanceId);
    if (!animal) return false;
    if (hasCompoundingScoreEffect(animal)) return true;
    return (animal.habitats as string[] | undefined)?.includes(habitat) ?? false;
  });
}

function findCardById(state: GameState, player: Player, instanceId: string | undefined): CardInstance | undefined {
  if (!instanceId) return undefined;
  return effectiveHand(player).find((c) => c.instanceId === instanceId) ?? state.animalTrack.find((c) => c.instanceId === instanceId);
}

// SOLO para los bots de RL (rlBot.ts en producción, trainCore.ts en
// entrenamiento) — heuristicBot y los jugadores humanos siguen viendo TODAS
// las combinaciones que de verdad permite el motor (getLegalActions), esta
// función no las toca ahí. Pedido explícito del usuario, 2026-09-16: una
// carta con returnAnimalForUpgrade (Flamenco) genera una acción por cada
// combinación (animal que entregas × animal del mercado que recibes, hasta
// maxCostDelta más caro) — casi todas dominadas por la de +maxCostDelta
// exacto (si puedes conseguir algo hasta 2 más caro entregando la misma
// carta, no hay motivo real para quedarte con uno +0/+1), y demasiado
// parecidas entre sí para que la red aprenda a distinguirlas bien. Se
// recorta a solo la mejora máxima posible por cada carta entregable. No
// cambia FEATURE_DIM ni invalida pesos ya entrenados: solo reduce qué
// acciones se ofrecen a elegir/aprender, ni una feature nueva de por medio.
export function filterUpgradeChoicesForRl(state: GameState, playerId: string, actions: Action[]): Action[] {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return actions;

  return actions.filter((action) => {
    if (action.type !== 'playCard' || !action.secondaryTargetInstanceId) return true;
    const card = effectiveHand(player).find((c) => c.instanceId === action.instanceId);
    const effect = card?.effects.find((e) => e.trigger === 'onPlay' && e.type === 'returnAnimalForUpgrade');
    if (!effect) return true;

    const source = findCardById(state, player, action.targetInstanceId);
    const destination = findCardById(state, player, action.secondaryTargetInstanceId);
    if (!source || !destination) return true;

    const maxCostDelta = typeof effect.params?.maxCostDelta === 'number' ? effect.params.maxCostDelta : 1;
    return (destination.marketCost ?? 0) === (source.marketCost ?? 0) + maxCostDelta;
  });
}
