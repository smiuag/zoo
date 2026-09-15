import type { Action } from '../engine';
import { getCard } from '../cards/registry';
import type { CardInstance, GameState, Player } from '../model/state';
import { legalActionsForBot } from './actionPriority';
import type { Bot } from './types';

// Bot no aleatorio: para cada acción legal calcula un valor heurístico
// según el estado actual (qué hay en su mercado, en su mano, en su
// descarte) y elige siempre la de mayor valor. No hay tantas acciones
// distintas, así que basta con una función de puntuación por tipo de
// acción/efecto en vez de una IA real.
//
// Todos los animales puntúan sus PV estén donde estén (mazo/mano/
// descarte): comprarlos ya asegura su PV. Jugarlos (playCard) NO da PV
// extra, solo dispara su efecto onPlay si lo tiene.
//
// La prioridad jugar > comprar (y dentro de jugar, robar antes que
// cualquier otra carta) es LEY para todos los bots desde legalActionsForBot
// (ver actionPriority.ts) — scoreAction de aquí abajo solo desempata DENTRO
// del único nivel que esa ley deje disponible en cada momento, nunca entre
// niveles distintos (nunca compite un "comprar" contra un "jugar" a la vez).

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
      case 'gainCoin': {
        // Pingüino: a diferencia de gainFlatBonusPurchasingPower, esto deja
        // una carta de verdad en la mano (cuenta su propio PV si no se
        // gasta este turno), así que vale algo más que el mismo valor en
        // bonus plano.
        const coinId = typeof effect.params?.coinId === 'string' ? effect.params.coinId : undefined;
        const coin = coinId ? getCard(coinId) : undefined;
        bonus += (coin?.value ?? 2) + (coin?.victoryPoints ?? 0);
        break;
      }
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
      case 'discardFromEachOpponentAndDrawPerCoin':
        // Igual que discardFromEachOpponent, más la posibilidad (no
        // garantizada: depende de si a algún rival le toca descartar
        // justo una moneda) de robar 1+ cartas extra.
        bonus += 1.5 + 1;
        break;
      case 'discardAnimalFromEachOpponent':
        bonus += 2; // tempo (no es destrucción permanente, solo descarte)
        break;
      case 'gainBonusPurchasingPowerPerHabitatInHand':
      case 'gainBonusPurchasingPowerPerDistinctSpeciesInHand':
      case 'gainBonusPurchasingPowerPerCoinInHand':
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
      case 'retrieveAnimalFromDiscard':
        bonus += 2; // recupera un animal ya jugado: valor real depende de cuál, aproximación fija
        break;
      case 'drawTopUnlessExpensiveAnimal':
        // Conejos: robo condicional (casi siempre útil, salvo que encima
        // del mazo haya justo un animal caro) — aproximación fija, algo
        // menos que un robo garantizado (drawCards vale 2 por carta).
        bonus += 1.5;
        break;
      case 'scorePerHabitatCount':
      case 'scorePerDistinctSpecies':
      case 'scorePerCostAtLeast':
      case 'scorePerDestroyedCard':
        // El valor real depende de cuántos animales de ese hábitat/especies
        // distintas/coste mínimo/eliminados lleguen a poseerse: aproximación
        // fija.
        bonus += 2;
        break;
      case 'returnFromDiscardEachTurn':
        // Ardilla: no hace nada la primera vez que se juega (todavía no hay
        // ninguna copia en el descarte), pero luego se recicla ella sola
        // cada turno sin gastar ninguna acción — valor compuesto a largo
        // plazo, aproximación fija.
        bonus += 1.5;
        break;
      case 'returnAnimalFromEachOpponent': {
        // Tiburón/Halcón/León: tempo (deniega una compra rival PARA SIEMPRE
        // — la carta capturada no vuelve al mercado, nadie puede recomprarla,
        // así que vale más que un simple descarte) más la media esperada del
        // bonus de valor de compra por animal capturado (aproximación: no
        // todos los rivales tendrán algo elegible, así que se cuenta como si
        // capturara 1 de media, no el máximo posible). El PV que da
        // scorePerDestroyedCard por cada captura ya se cuenta aparte (esa
        // misma carta también tiene ese efecto, ver el case de arriba).
        const bonusPerAnimal = typeof effect.params?.bonusPerAnimal === 'number' ? effect.params.bonusPerAnimal : 0;
        bonus += 3 + bonusPerAnimal;
        break;
      }
      default:
        break;
    }
  }
  return bonus;
}

// Norma explícita de orden de juego: conviene jugar SIEMPRE las cartas que
// roban antes que las que dan valor de compra "por cada X que tengas en la
// mano" (Delfín/Mono) — jugar antes la de robo aumenta la mano y por tanto
// lo que cuenta después la de dinero-por-conteo, así que jugarlas en ese
// orden maximiza el dinero disponible ese turno. Pequeño a propósito (menor
// que la distancia mínima entre categorías de effectBonus, 0.5): solo debe
// decidir el ORDEN relativo ENTRE estas dos familias de efecto, nunca hacer
// que una carta de robo valga más que una compra o que un efecto no
// relacionado con esto.
const DRAW_EFFECT_TYPES = new Set(['drawCards', 'drawThenTopdeck', 'drawTopUnlessExpensiveAnimal']);
const HAND_COUNT_MONEY_EFFECT_TYPES = new Set([
  'gainBonusPurchasingPowerPerHabitatInHand',
  'gainBonusPurchasingPowerPerDistinctSpeciesInHand',
]);

function drawBeforeHandCountMoneyBonus(card: CardInstance): number {
  const types = card.effects.map((e) => e.type);
  if (types.some((t) => DRAW_EFFECT_TYPES.has(t))) return 0.1;
  if (types.some((t) => HAND_COUNT_MONEY_EFFECT_TYPES.has(t))) return -0.1;
  return 0;
}

// Desempate entre las variantes de una misma carta que solo difieren en a
// qué rival apunta (Pato): sin esto, effectBonus puntúa igual a todos los
// rivales y el empate se rompe al azar (ver TIE_EPSILON abajo),
// desperdiciando la elección. Pequeño a propósito (menor que cualquier
// effectBonus): solo debe decidir ENTRE rivales, nunca hacer que jugar la
// carta valga más que otra acción distinta.
function targetPlayerBonus(state: GameState, _player: Player, card: CardInstance, targetPlayerId: string | undefined): number {
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

  return 0;
}

// Desempate entre las variantes del Tigre que solo difieren en qué carta
// se deja encima del mazo (drawThenTopdeck, ver drawThenTopdeckActions en
// engine.ts: una variante por cada carta de la mano resultante tras
// robar). Sin esto, todas puntuarían igual (effectBonus no distingue el
// target) y el bot se quedaría con una al azar en vez de con la peor
// -antes esto lo decidía el propio motor por su cuenta (worstCardIndex);
// ahora que el jugador elige, el bot necesita su propio criterio-.
// El target puede estar ya en la mano o todavía en el mazo (a punto de
// robarse): se busca en ambos. Igual de pequeño a propósito que
// targetPlayerBonus: solo debe decidir ENTRE targets, nunca hacer que
// jugar la carta valga más que otra acción distinta.
function drawThenTopdeckTargetBonus(sourceCard: CardInstance, player: Player, targetInstanceId: string | undefined): number {
  if (!targetInstanceId) return 0;
  if (!sourceCard.effects.some((e) => e.type === 'drawThenTopdeck')) return 0;
  const card = findInHand(player, targetInstanceId) ?? player.deck.find((c) => c.instanceId === targetInstanceId);
  if (!card) return 0;
  const worth = card.type === 'coin' ? (card.value ?? 0) : card.victoryPoints;
  return -worth * 0.3;
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
      return (
        100 +
        effectBonus(card) +
        drawBeforeHandCountMoneyBonus(card) +
        targetPlayerBonus(state, player, card, action.targetPlayerId) +
        drawThenTopdeckTargetBonus(card, player, action.targetInstanceId)
      );
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
    const actions = legalActionsForBot(state, playerId);
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
