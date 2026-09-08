import { getLegalActions, type Action } from '../engine';
import { getCard } from '../cards/registry';
import type { CardInstance, GameState, Player } from '../model/state';
import type { Bot } from './types';

// Bot no aleatorio: para cada acción legal calcula un valor heurístico
// según el estado actual (qué hay en su mercado, en su mano, en su
// descarte) y elige siempre la de mayor valor. No hay tantas acciones
// distintas, así que basta con una función de puntuación por tipo de
// acción/efecto en vez de una IA real.
//
// Todos los animales puntúan sus PV estén donde estén (mazo/mano/
// descarte): comprarlos ya asegura su PV. Jugarlos (playCard) NO da PV
// extra, solo dispara su efecto onPlay si lo tiene. Prioridad general:
// comprar animales con buen PV o valor económico > jugar cartas de la mano
// por su efecto > terminar turno.

function findInHand(player: Player, instanceId: string): CardInstance | undefined {
  return player.hand.find((c) => c.instanceId === instanceId);
}
function findInTrack(state: GameState, instanceId: string): CardInstance | undefined {
  return state.animalTrack.find((c) => c.instanceId === instanceId);
}

// Valor aproximado del efecto onPlay/onScore de una carta, más allá de sus
// PV base. No modela el juego perfectamente, solo evita que el bot trate
// todas las habilidades como si dieran igual.
function effectBonus(card: CardInstance): number {
  let bonus = 0;
  for (const effect of card.effects) {
    switch (effect.type) {
      case 'drawCards':
        bonus += 2 * (typeof effect.params?.amount === 'number' ? effect.params.amount : 1);
        break;
      case 'drawThenTopdeck':
        bonus += 1;
        break;
      case 'gainBonusPurchasingPowerPerSpeciesInDiscard':
        bonus += 1;
        break;
      case 'upgradeCoin':
        bonus += 1.5;
        break;
      case 'gainFlatBonusPurchasingPower':
        bonus += typeof effect.params?.amount === 'number' ? effect.params.amount : 2; // tempo, valor fijo garantizado
        break;
      case 'gainAquaticOnlyBonusPurchasingPower': {
        // Igual que gainFlatBonusPurchasingPower pero solo sirve para
        // acuáticos: vale menos porque a veces no hay nada acuático que
        // comprar ese turno.
        const amount = typeof effect.params?.amount === 'number' ? effect.params.amount : 2;
        bonus += amount * 0.7;
        break;
      }
      case 'discardFromEachOpponent':
      case 'chooseDiscardFromEachOpponent':
        bonus += 1.5;
        break;
      case 'discardAnimalFromEachOpponent':
        bonus += 2; // tempo (no es destrucción permanente, solo descarte)
        break;
      case 'gainBonusPurchasingPowerPerHabitatInHand':
      case 'gainBonusPurchasingPowerPerDistinctSpeciesInHand':
        bonus += 1.5; // aproximación fija: el valor real depende de la mano
        break;
      case 'recoverCoinFromDiscardOrDraw':
        bonus += 2;
        break;
      case 'freeCaptureUpToCost':
        bonus += 3; // captura gratis del mercado: buen valor aproximado
        break;
      case 'stealCoinFromChosenPlayer':
        bonus += 1.5; // consigue una moneda cualquiera del rival elegido (no garantizado)
        break;
      case 'returnAnimalForUpgrade':
        bonus += 2.5; // sube 1 de coste gratis, aproximación fija
        break;
      case 'swapSelfWithTopOfDeck':
        bonus += 1.5; // roba 1 carta garantizada, pero la propia carta no queda en el descarte
        break;
      case 'topdeckSlothForChosenPlayer':
        bonus += 1; // molesta al rival elegido, pero no siempre hay Perezoso que forzar
        break;
      case 'scorePerHabitatCount':
      case 'scorePerDistinctSpecies':
        // El valor real depende de cuántos animales de ese hábitat/especies
        // distintas lleguen a poseerse: aproximación fija.
        bonus += 2;
        break;
      case 'scoreBonusIfSpeciesCountAtLeast':
        // Bono grande pero condicionado a reunir varias copias de la misma
        // especie: aproximación fija, baja porque no es fácil de alcanzar.
        bonus += 2;
        break;
      default:
        break;
    }
  }
  return bonus;
}

// Desempate entre las variantes de una misma carta que solo difieren en a
// qué rival apuntan (Pato, Jirafa): sin esto, effectBonus puntúa igual a
// todos los rivales y el empate se rompe al azar (ver TIE_EPSILON abajo),
// desperdiciando la elección. Pequeño a propósito (menor que cualquier
// effectBonus): solo debe decidir ENTRE rivales, nunca hacer que jugar la
// carta valga más que otra acción distinta.
function targetPlayerBonus(state: GameState, card: CardInstance, targetPlayerId: string | undefined): number {
  if (!targetPlayerId) return 0;
  const target = state.players.find((p) => p.id === targetPlayerId);
  if (!target) return 0;
  const effectTypes = new Set(card.effects.map((e) => e.type));

  if (effectTypes.has('stealCoinFromChosenPlayer')) {
    // Prioriza al rival con la moneda de mayor valor en mano: es la que se
    // llevaría (findIndex se queda la primera moneda que encuentre, pero
    // como heurística basta con saber si merece la pena apuntarle).
    const bestCoin = Math.max(0, ...target.hand.filter((c) => c.type === 'coin').map((c) => c.value ?? 0));
    return bestCoin * 0.2;
  }

  if (effectTypes.has('topdeckSlothForChosenPlayer')) {
    // Molesta más a quien va ganando: forzarle un Perezoso (mal animal) le
    // cuesta más que a alguien ya rezagado.
    const victoryPoints = [...target.deck, ...target.hand, ...target.discard].reduce(
      (sum, c) => sum + c.victoryPoints,
      0
    );
    return victoryPoints * 0.05;
  }

  return 0;
}

function scoreAction(state: GameState, player: Player, action: Action): number {
  switch (action.type) {
    case 'buyAnimal': {
      // Comprar es la vía principal para acumular PV (cuenta esté donde
      // esté la carta después): prioridad alta, según ratio PV/coste. Se le
      // suma también el valor de su habilidad (effectBonus): sin esto,
      // especies con el mismo PV/coste pero habilidades muy distintas
      // (p. ej. Tortuga vs Tigre) puntuaban idéntico y el desempate cuando
      // hay empate exacto (ver chooseAction) se apoyaba solo en el azar.
      const track = findInTrack(state, action.trackInstanceId);
      if (!track) return -Infinity;
      return 400 + (track.victoryPoints - track.marketCost * 0.5) * 10 + effectBonus(track) * 2;
    }

    case 'buyCoin': {
      // Mismo criterio que comprar animales (ratio PV/coste), para que se
      // compare de forma coherente contra el resto de compras del turno.
      const coin = getCard(action.coinId);
      return 400 + (coin.victoryPoints - (coin.marketCost ?? 0) * 0.5) * 10;
    }

    case 'playCard': {
      const card = findInHand(player, action.instanceId);
      if (!card) return -Infinity;
      return 100 + effectBonus(card) + targetPlayerBonus(state, card, action.targetPlayerId);
    }

    case 'endTurn':
      return 10;
  }
  return 0;
}

// Antes, un empate exacto de puntuación se resolvía quedándose con la
// PRIMERA acción encontrada — que en la práctica significaba "la especie
// que salga antes por orden alfabético en el mercado", sesgando muchísimo
// las partidas simuladas hacia unas pocas especies sin que tuviera nada
// que ver con lo buenas que fueran. Ahora se recogen TODAS las acciones
// que empatan al máximo y se elige una al azar entre ellas.
const TIE_EPSILON = 1e-9;

export const heuristicBot: Bot = {
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
