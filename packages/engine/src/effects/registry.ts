import { getCard } from '../cards/registry';
import { matchHabitatList, type Effect } from '../cards/schema';
import {
  drawCards,
  effectiveHand,
  mintInstance,
  takeRandomFromHand,
  type CardInstance,
  type GameState,
  type Player,
} from '../model/state';

// "targetInstanceId" lo rellena engine.ts cuando el jugador elige un
// objetivo propio al jugar la carta (p. ej. de qué otro animal de su mano
// coger una copia con el Pingüino). Los efectos que no necesitan elegir
// nada lo ignoran.
export interface EffectContext {
  targetInstanceId?: string;
  // Solo lo usa el Flamenco: qué animal del mercado coge a cambio del que
  // devuelve (targetInstanceId). El resto de efectos lo ignora.
  secondaryTargetInstanceId?: string;
}

export type EffectHandler = (state: GameState, player: Player, effect: Effect, context: EffectContext) => void;

const handlers = new Map<string, EffectHandler>();

export function registerEffect(type: string, handler: EffectHandler): void {
  handlers.set(type, handler);
}

export function resolveEffect(state: GameState, player: Player, effect: Effect, context: EffectContext = {}): void {
  const handler = handlers.get(effect.type);
  if (!handler) {
    throw new Error(`No hay ningún handler registrado para el efecto "${effect.type}"`);
  }
  handler(state, player, effect, context);
}

function otherPlayers(state: GameState, player: Player): Player[] {
  return state.players.filter((p) => p.id !== player.id);
}

// Heurística usada por los efectos "el jugador afectado elige" cuando no
// hay un canal de decisión interactiva real (todavía no hay UI): en vez de
// al azar, se queda con la carta de menor valor (monedas por su valor,
// el resto por sus PV), desempatando por orden de aparición.
function cardWorth(card: CardInstance): number {
  return card.type === 'coin' ? (card.value ?? 0) : card.victoryPoints;
}

function worstCardIndex(hand: CardInstance[]): number {
  let worstIdx = -1;
  let worstValue = Infinity;
  for (let i = 0; i < hand.length; i++) {
    const worth = cardWorth(hand[i]);
    if (worth < worstValue) {
      worstValue = worth;
      worstIdx = i;
    }
  }
  return worstIdx;
}

// Águila: roba 1 carta extra al jugarla.
registerEffect('drawCards', (_state, player, effect) => {
  const amount = effect.params?.amount;
  if (typeof amount !== 'number') {
    throw new Error('El efecto "drawCards" requiere params: { amount: number }');
  }
  drawCards(player, amount);
});

// Mono: cada rival descarta 1 carta al azar de su mano.
registerEffect('discardFromEachOpponent', (state, player) => {
  for (const opponent of otherPlayers(state, player)) {
    const card = takeRandomFromHand(opponent);
    if (card) opponent.discard.push(card);
  }
});

// Buitre: cada rival elige y descarta `amount` cartas (por defecto 1) de su
// propia mano (no al azar, a diferencia del Mono): se queda siempre con las
// peores, ver worstCardIndex.
registerEffect('chooseDiscardFromEachOpponent', (state, player, effect) => {
  const amount = typeof effect.params?.amount === 'number' ? effect.params.amount : 1;
  for (const opponent of otherPlayers(state, player)) {
    for (let i = 0; i < amount; i++) {
      const idx = worstCardIndex(opponent.hand);
      if (idx === -1) break;
      const [card] = opponent.hand.splice(idx, 1);
      opponent.discard.push(card);
    }
  }
});

// Delfín: 1 moneda extra para comprar ESTE TURNO por cada delfín que tengas
// en tu descarte (el que se está jugando ya se descartó antes de resolver
// esto, así que la 1ª copia da 1, la 2ª da 2, etc.). Igual que el León o el
// Pez de colores/Serpiente/Loro: no es dinero real, no añade cartas de
// moneda a la mano ni al mazo, solo aumenta lo que puedes gastar hasta que
// termine el turno.
registerEffect('gainBonusPurchasingPowerPerSpeciesInDiscard', (_state, player, effect) => {
  const species = effect.params?.species;
  if (typeof species !== 'string') {
    throw new Error('El efecto "gainBonusPurchasingPowerPerSpeciesInDiscard" requiere params: { species: string }');
  }
  const count = player.discard.filter((c) => c.species === species).length;
  player.bonusPurchasingPowerThisTurn += count;
});

// Tigre: roba 2 cartas y luego elige 1 para dejar encima del mazo otra vez
// (no al azar: se queda la peor de la mano, ver worstCardIndex).
registerEffect('drawThenTopdeck', (_state, player, effect) => {
  const drawAmount = typeof effect.params?.drawAmount === 'number' ? effect.params.drawAmount : 2;
  drawCards(player, drawAmount);
  const idx = worstCardIndex(player.hand);
  if (idx === -1) return;
  const [card] = player.hand.splice(idx, 1);
  player.deck.push(card);
});

// Murciélago: se intercambia por la carta de encima de su mazo, sin elegir
// nada (automático). playCard ya lo ha mandado al descarte y a
// playedThisTurn antes de resolver este efecto (igual que el Flamenco
// devolviéndose a sí mismo, ver returnAnimalForUpgrade): se le saca de ahí
// y, en vez de quedarse descartado, vuelve a su mazo (encima), mientras la
// carta que estaba encima del mazo pasa a la mano. Si el mazo está vacío no
// hay nada con lo que intercambiarse: se queda en el descarte, como
// cualquier carta normal.
registerEffect('swapSelfWithTopOfDeck', (_state, player) => {
  if (player.deck.length === 0) return;

  const self = player.playedThisTurn[player.playedThisTurn.length - 1];
  if (!self) return;
  const idx = player.discard.findIndex((c) => c.instanceId === self.instanceId);
  if (idx === -1) return;

  const [card] = player.discard.splice(idx, 1);
  const top = player.deck.pop()!;
  player.deck.push(card);
  player.hand.push(top);
});

// Elefante / Araña: capturan gratis (sin gastar monedas) el animal del
// mercado que elija el jugador (vía targetInstanceId), no al azar.
// params.habitat restringe a animales que TENGAN AL MENOS UNO de esos
// hábitats (Elefante: "land"; Araña: ["bird","aquatic"], acepta string o
// array de strings); params.excludeHabitat restringe a animales que NO
// tengan ese hábitat (sin uso actual, disponible para cartas futuras).
// Repone su hueco igual que una compra normal. params.maxCost limita el
// coste máximo capturable (Elefante: 5, Araña: 3); si se omite no hay límite.
registerEffect('freeCaptureUpToCost', (state, player, effect, context) => {
  const maxCost = typeof effect.params?.maxCost === 'number' ? effect.params.maxCost : Infinity;
  const habitats = matchHabitatList(effect.params?.habitat);
  const excludeHabitat = typeof effect.params?.excludeHabitat === 'string' ? effect.params.excludeHabitat : null;
  const idx = context.targetInstanceId
    ? state.animalTrack.findIndex(
        (c) =>
          c.instanceId === context.targetInstanceId &&
          (c.marketCost ?? 0) <= maxCost &&
          (habitats.length === 0 || habitats.some((h) => (c.habitats as string[])?.includes(h))) &&
          (!excludeHabitat || !(c.habitats as string[])?.includes(excludeHabitat))
      )
    : -1;
  if (idx === -1) return;
  const [chosen] = state.animalTrack.splice(idx, 1);
  player.discard.push(chosen);
  // El motor expone refillAnimalMarket vía un handler indirecto para
  // evitar un ciclo de imports con engine.ts: se reengancha desde allí.
  refillHook?.(state, chosen.species);
});

// Jirafa: sube de nivel 1 moneda de la mano (1->2 o 2->3), elegida al azar
// entre las que se puedan subir.
registerEffect('upgradeCoin', (state, player) => {
  const upgradable = player.hand.filter((c) => c.type === 'coin' && (c.value ?? 0) < 3);
  if (upgradable.length === 0) return;
  const chosen = upgradable[Math.floor(Math.random() * upgradable.length)];
  const idx = player.hand.findIndex((c) => c.instanceId === chosen.instanceId);
  player.hand.splice(idx, 1);
  const nextValue = (chosen.value ?? 1) + 1;
  player.hand.push(mintInstance(state, getCard(`coin-${nextValue}`)));
});

// León: ganas params.amount (por defecto 2) de dinero extra para comprar
// ESTE TURNO, fijo (no depende de tu mano). Igual que Serpiente/Loro/
// Delfín: no es una carta, no se añade al mazo ni se puede robar luego.
registerEffect('gainFlatBonusPurchasingPower', (_state, player, effect) => {
  const amount = typeof effect.params?.amount === 'number' ? effect.params.amount : 2;
  player.bonusPurchasingPowerThisTurn += amount;
});

// Serpiente / Loro: ganan "dinero para comprar" extra solo este turno (no es
// una carta: no se añade al mazo ni se puede robar más tarde) por cada
// animal del hábitat indicado (params.habitat) que tengas en tu mano en
// este momento.
registerEffect('gainBonusPurchasingPowerPerHabitatInHand', (_state, player, effect) => {
  const habitat = effect.params?.habitat;
  if (typeof habitat !== 'string') {
    throw new Error('El efecto "gainBonusPurchasingPowerPerHabitatInHand" requiere params: { habitat: string }');
  }
  // effectiveHand (mano real + lo jugado este turno): la propia carta se
  // cuenta a sí misma, y también cuentan otras del mismo hábitat que ya
  // hayas jugado antes este turno aunque ya estén en el descarte.
  const count = effectiveHand(player).filter(
    (c) => c.type === 'animal' && (c.habitats as string[])?.includes(habitat)
  ).length;
  player.bonusPurchasingPowerThisTurn += count;
});

// Hiena: cada rival muestra su mano y descarta el animal de MAYOR coste
// (descarte normal, no destrucción: la carta sigue circulando con
// normalidad). Si hay empate de coste, "puede elegirla": se queda el más
// valioso y sacrifica el de menor PV entre los empatados (worstCardIndex).
// Si un rival no tiene ningún animal en mano, no pierde nada.
registerEffect('discardAnimalFromEachOpponent', (state, player) => {
  for (const opponent of otherPlayers(state, player)) {
    const animals = opponent.hand.filter((c) => c.type === 'animal');
    if (animals.length === 0) continue;
    const maxCost = Math.max(...animals.map((c) => c.marketCost ?? 0));
    const costliest = animals.filter((c) => (c.marketCost ?? 0) === maxCost);
    const target = costliest[worstCardIndex(costliest)];
    const handIdx = opponent.hand.findIndex((c) => c.instanceId === target.instanceId);
    const [card] = opponent.hand.splice(handIdx, 1);
    opponent.discard.push(card);
  }
});

// Pato: el jugador a tu DERECHA (el anterior en el orden de turno: el
// turno pasa hacia la izquierda) te da 1 moneda cualquiera de su mano (no
// tiene que ser de valor 1). Si no tiene ninguna, no pierde nada (en la
// práctica, "muestra su mano"). Con 1 solo jugador no hay vecino, así que
// no hace nada.
registerEffect('stealCoinFromRightNeighbor', (state, player) => {
  const idx = state.players.findIndex((p) => p.id === player.id);
  if (idx === -1 || state.players.length < 2) return;
  const rightNeighbor = state.players[(idx - 1 + state.players.length) % state.players.length];
  const coinIdx = rightNeighbor.hand.findIndex((c) => c.type === 'coin');
  if (coinIdx === -1) return;
  const [coin] = rightNeighbor.hand.splice(coinIdx, 1);
  player.hand.push(coin);
});

// Flamenco: devuelve al mazo compartido de su especie el animal elegido
// (context.targetInstanceId, de tu mano ESTE TURNO: lo que sigues teniendo
// en la mano, o algo que ya hayas jugado este mismo turno — ver
// returnAnimalForUpgradeActions en engine.ts, que es quien restringe los
// candidatos ofrecidos). Por eso se busca primero en player.hand y luego
// en player.discard: puede ser el propio Flamenco, que para cuando se
// resuelve esto ya está en tu descarte porque playCard lo mueve ahí antes
// de resolver su onPlay, o cualquier otra carta jugada antes este turno.
// Se resuelve el onPlay de la carta devuelta (sin volver a elegir objetivo
// para ella), y luego coges gratis del mercado, SIN resolver su efecto, el
// animal que el jugador haya elegido (context.secondaryTargetInstanceId)
// de coste como mucho 1 más que el devuelto.
registerEffect('returnAnimalForUpgrade', (state, player, _effect, context) => {
  if (!context.targetInstanceId) return;

  let zone: CardInstance[] = player.hand;
  let idx = zone.findIndex((c) => c.instanceId === context.targetInstanceId && c.type === 'animal');
  if (idx === -1) {
    zone = player.discard;
    idx = zone.findIndex((c) => c.instanceId === context.targetInstanceId && c.type === 'animal');
  }
  if (idx === -1) return;

  const [returned] = zone.splice(idx, 1);
  const deck = state.sharedDecks[returned.species ?? ''];
  if (deck) deck.push(returned);

  for (const e of returned.effects.filter((e) => e.trigger === 'onPlay')) {
    resolveEffect(state, player, e, {});
  }

  if (!context.secondaryTargetInstanceId) return;
  const maxCost = (returned.marketCost ?? 0) + 1;
  const trackIdx = state.animalTrack.findIndex((c) => c.instanceId === context.secondaryTargetInstanceId);
  if (trackIdx === -1) return;
  const chosen = state.animalTrack[trackIdx];
  if ((chosen.marketCost ?? 0) > maxCost) return;

  state.animalTrack.splice(trackIdx, 1);
  player.discard.push(chosen);
  refillHook?.(state, chosen.species);
});

// engine.ts se engancha aquí para poder reponer el mercado tras una
// captura gratis (evita un ciclo de imports engine.ts <-> registry.ts).
let refillHook: ((state: GameState, species: string | undefined) => void) | null = null;
export function setRefillHook(hook: (state: GameState, species: string | undefined) => void): void {
  refillHook = hook;
}

// `sourceCard` es la carta que lleva el efecto (p. ej. la instancia
// concreta del Cocodrilo que lo dispara), para que un efecto pueda excluirse
// a sí mismo de sus propios objetivos.
export type ScoreEffectHandler = (
  player: Player,
  effect: Effect,
  allCards: CardInstance[],
  sourceCard: CardInstance
) => number;

const scoreHandlers = new Map<string, ScoreEffectHandler>();

export function registerScoreEffect(type: string, handler: ScoreEffectHandler): void {
  scoreHandlers.set(type, handler);
}

export function resolveScoreEffect(
  player: Player,
  effect: Effect,
  allCards: CardInstance[],
  sourceCard: CardInstance
): number {
  const handler = scoreHandlers.get(effect.type);
  if (!handler) {
    throw new Error(`No hay ningún handler de puntuación registrado para el efecto "${effect.type}"`);
  }
  return handler(player, effect, allCards, sourceCard);
}

// Orca / Oso polar / Albatros: +1PV (× `multiplier`, por defecto 1) por
// cada animal del hábitat indicado que tenga el jugador en TODA su
// colección (mazo + mano + descarte: todos los animales puntúan estén
// donde estén), al final de la partida.
registerScoreEffect('scorePerHabitatCount', (_player, effect, allCards) => {
  const habitat = effect.params?.habitat;
  const multiplier = typeof effect.params?.multiplier === 'number' ? effect.params.multiplier : 1;
  if (typeof habitat !== 'string') {
    throw new Error('El efecto "scorePerHabitatCount" requiere params: { habitat: string }');
  }
  const count = allCards.filter((c) => c.type === 'animal' && (c.habitats as string[])?.includes(habitat)).length;
  return count * multiplier;
});

// Pingüino: al final de la partida, +1PV por cada ESPECIE de animal
// distinta que tengas en toda tu colección (una copia y diez de la misma
// especie cuentan igual: solo importa la variedad).
registerScoreEffect('scorePerDistinctSpecies', (_player, _effect, allCards) => {
  const species = new Set(allCards.filter((c) => c.type === 'animal').map((c) => c.species));
  return species.size;
});

// Periquito: al final de la partida, +bonus PV (una sola vez, no por copia)
// si tienes minCount o más Periquitos en toda tu colección. Solo la PRIMERA
// copia encontrada en la colección concede el bono: si contara cada copia
// por separado, tener 4 periquitos daría 4×7PV en vez de un bono plano de
// 7PV al alcanzar el umbral.
registerScoreEffect('scoreBonusIfSpeciesCountAtLeast', (_player, effect, allCards, sourceCard) => {
  const minCount = typeof effect.params?.minCount === 'number' ? effect.params.minCount : 0;
  const bonus = typeof effect.params?.bonus === 'number' ? effect.params.bonus : 0;
  const sameSpecies = allCards.filter((c) => c.type === 'animal' && c.species === sourceCard.species);
  if (sameSpecies.length < minCount) return 0;
  if (sameSpecies[0]?.instanceId !== sourceCard.instanceId) return 0;
  return bonus;
});

// Efectos onScore que ELIMINAN cartas de la colección (solo el Cocodrilo,
// de momento): scorePlayer los resuelve en una fase previa, antes de sumar
// ningún PV, para que lo que destruyan no llegue a puntuar.
export const DESTRUCTIVE_SCORE_EFFECT_TYPES = new Set(['destroyWeakestAquaticOnScore']);

function weakestAquatic(
  player: Player,
  sourceCard: CardInstance,
  excludeSelf: boolean
): { zone: CardInstance[]; idx: number } | null {
  const zones = [player.deck, player.hand, player.discard];
  let bestZone: CardInstance[] | null = null;
  let bestIdx = -1;
  let bestPv = Infinity;
  for (const zone of zones) {
    for (let i = 0; i < zone.length; i++) {
      const c = zone[i];
      if (c.type !== 'animal' || !c.habitats?.includes('aquatic')) continue;
      if (excludeSelf && c.instanceId === sourceCard.instanceId) continue;
      if (c.victoryPoints < bestPv) {
        bestPv = c.victoryPoints;
        bestZone = zone;
        bestIdx = i;
      }
    }
  }
  return bestZone && bestIdx !== -1 ? { zone: bestZone, idx: bestIdx } : null;
}

// Cocodrilo: al final de la partida, ANTES de puntuar, destruye el animal
// acuático de menor PV de tu colección entera. Prefiere destruir OTRO
// acuático si tienes alguno; solo se destruye a SÍ MISMO cuando es tu único
// acuático (antes se salvaba gratis en ese caso). No suma PV directamente:
// su "coste" es que esa otra carta (o él mismo) deja de contar para nada.
registerScoreEffect('destroyWeakestAquaticOnScore', (player, _effect, _allCards, sourceCard) => {
  const target = weakestAquatic(player, sourceCard, true) ?? weakestAquatic(player, sourceCard, false);
  if (target) target.zone.splice(target.idx, 1);
  return 0;
});
