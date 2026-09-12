import { getCard } from '../cards/registry';
import { matchHabitatList, type Effect } from '../cards/schema';
import {
  drawCards,
  effectiveHand,
  mintInstance,
  removeFromPlayedThisTurn,
  shuffle,
  type CardInstance,
  type GameState,
  type PendingDiscardDecision,
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
  // Qué jugador (de entre los demás) elige el Pato como objetivo de su
  // efecto. engine.ts lo rellena a partir de la elección del jugador (una
  // variante de la acción "playCard" por rival posible, ver
  // getLegalActions). El resto de efectos lo ignora.
  targetPlayerId?: string;
  // Nombre de la carta que lleva este efecto (engine.ts lo rellena desde
  // `card.name`): solo lo usan los efectos de descarte forzoso, para el
  // banner de la decisión pendiente (ver PendingDiscardDecision). El resto
  // de efectos lo ignora.
  sourceCardName?: string;
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

// Heurística usada SOLO por los bots (ver pickDefaultDiscard más abajo) para
// resolver un descarte forzoso pendiente por su cuenta: se queda con la
// carta de menor valor (monedas por su valor, el resto por sus PV),
// desempatando por orden de aparición. Los jugadores humanos, en cambio,
// eligen de verdad — ver PendingDiscardDecision/resolveDiscard en
// engine.ts.
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

// Heurística de descarte por defecto, para que la usen los bots cuando un
// descarte forzoso pendiente les toca a ellos (ver el bucle de autoplay en
// apps/web/src/state/useGame.ts): entre las cartas elegibles, se queda con
// la de menor valor (igual que worstCardIndex). `eligibleInstanceIds` null
// significa "cualquier carta de la mano vale" (Buitre/Mono); si viene una
// lista (Hiena: solo los animales empatados a coste máximo), se elige entre
// esas. `allowSlothSubstitute` (entregas de tipo 'discard' únicamente): si
// el bot tiene un Perezoso en la mano, lo sacrifica sin más — cubre toda la
// entrega él solo (ver resolveDiscard en engine.ts) y no vale nada (0PV, sin
// ningún otro efecto), así que siempre es al menos tan buena elección como
// cualquier otra. Devuelve null si no hay ninguna elegible (no debería pasar
// si el bot de verdad debe algo, pero por si acaso).
export function pickDefaultDiscard(
  hand: CardInstance[],
  eligibleInstanceIds: string[] | null,
  allowSlothSubstitute = false
): string | null {
  if (allowSlothSubstitute) {
    const sloth = hand.find((c) => c.id === 'sloth');
    if (sloth) return sloth.instanceId;
  }
  const pool = eligibleInstanceIds ? hand.filter((c) => eligibleInstanceIds.includes(c.instanceId)) : hand;
  const idx = worstCardIndex(pool);
  return idx === -1 ? null : pool[idx].instanceId;
}

// Arranca (o no, si nadie debe nada) una entrega forzosa de cartas pendiente:
// mientras esté activa, ver getLegalActions/resolveDiscard en engine.ts,
// nadie tiene ninguna otra acción legal salvo los jugadores que aparecen en
// `owed`. `kind` decide qué pasa con la carta al resolverse: 'discard'
// (por defecto, Buitre/Mono/Hiena/Murciélago) o 'returnToMarket' (Tiburón).
function beginPendingDiscard(
  state: GameState,
  activePlayer: Player,
  owed: PendingDiscardDecision['owed'],
  opts: { sourceCardName: string; bonusDrawPerCoin?: boolean; kind?: PendingDiscardDecision['kind'] }
): void {
  if (Object.keys(owed).length === 0) return;
  state.pendingDecision = {
    kind: opts.kind ?? 'discard',
    sourceCardName: opts.sourceCardName,
    sourcePlayerId: activePlayer.id,
    bonusDrawPerCoin: opts.bonusDrawPerCoin ?? false,
    coinsDiscardedSoFar: 0,
    owed,
  };
}

// Águila: roba 1 carta extra al jugarla.
registerEffect('drawCards', (_state, player, effect) => {
  const amount = effect.params?.amount;
  if (typeof amount !== 'number') {
    throw new Error('El efecto "drawCards" requiere params: { amount: number }');
  }
  drawCards(player, amount);
});

// Genérico (sin ninguna carta que lo use ahora mismo, pero registrado por
// si hace falta en el futuro): cada rival descarta 1 carta de su mano,
// eligiendo él cuál (igual que el Buitre).
registerEffect('discardFromEachOpponent', (state, player, _effect, context) => {
  const owed: PendingDiscardDecision['owed'] = {};
  for (const opponent of otherPlayers(state, player)) {
    if (opponent.hand.length > 0) owed[opponent.id] = { amount: 1, eligibleInstanceIds: null };
  }
  beginPendingDiscard(state, player, owed, { sourceCardName: context.sourceCardName ?? 'efecto' });
});

// Mono: cada rival elige y descarta 1 carta de su mano, y TÚ robas 1 carta
// por cada moneda que se haya descartado así en total (se cuenta cuando se
// resuelva la decisión, ver resolveDiscard en engine.ts: el rival puede
// elegir descartar una moneda o no, es cosa suya).
registerEffect('discardFromEachOpponentAndDrawPerCoin', (state, player, _effect, context) => {
  const owed: PendingDiscardDecision['owed'] = {};
  for (const opponent of otherPlayers(state, player)) {
    if (opponent.hand.length > 0) owed[opponent.id] = { amount: 1, eligibleInstanceIds: null };
  }
  beginPendingDiscard(state, player, owed, {
    sourceCardName: context.sourceCardName ?? 'efecto',
    bonusDrawPerCoin: true,
  });
});

// Buitre: cada rival elige y descarta `amount` cartas (por defecto 1) de su
// propia mano, la que quiera.
registerEffect('chooseDiscardFromEachOpponent', (state, player, effect, context) => {
  const amount = typeof effect.params?.amount === 'number' ? effect.params.amount : 1;
  const owed: PendingDiscardDecision['owed'] = {};
  for (const opponent of otherPlayers(state, player)) {
    if (opponent.hand.length > 0) {
      owed[opponent.id] = { amount: Math.min(amount, opponent.hand.length), eligibleInstanceIds: null };
    }
  }
  beginPendingDiscard(state, player, owed, { sourceCardName: context.sourceCardName ?? 'efecto' });
});

// Genérico (sin ninguna carta que lo use por ahora, pero registrado por si
// hace falta en el futuro): 1 moneda extra para comprar ESTE TURNO por cada
// copia de params.species que tengas en tu descarte, incluidas las que hayas
// jugado ya este mismo turno (playedThisTurn: NO están en el descarte de
// verdad todavía, solo pasan a él al terminar el turno, ver playCard/endTurn
// en engine.ts). Igual que el León o Serpiente/Loro: no es dinero real, no
// añade cartas de moneda a la mano ni al mazo, solo aumenta lo que puedes
// gastar hasta que termine el turno.
registerEffect('gainBonusPurchasingPowerPerSpeciesInDiscard', (_state, player, effect) => {
  const species = effect.params?.species;
  if (typeof species !== 'string') {
    throw new Error('El efecto "gainBonusPurchasingPowerPerSpeciesInDiscard" requiere params: { species: string }');
  }
  const count = [...player.discard, ...player.playedThisTurn].filter((c) => c.species === species).length;
  player.bonusPurchasingPowerThisTurn += count;
});

// Delfín: params.amount (por defecto 2) de dinero extra para comprar ESTE
// TURNO, pero SOLO sirve para pagar animales acuáticos (nunca monedas ni
// animales de otro hábitat) — ver aquaticBonusPurchasingPowerThisTurn en
// model/state.ts, y cómo se gasta en payCoins/canAffordMarket en
// engine.ts. Igual que el resto de "dinero de este turno": no es una
// carta, no se añade al mazo ni se puede robar luego.
registerEffect('gainAquaticOnlyBonusPurchasingPower', (_state, player, effect) => {
  const amount = typeof effect.params?.amount === 'number' ? effect.params.amount : 2;
  player.aquaticBonusPurchasingPowerThisTurn += amount;
});

// Tigre: roba `drawAmount` cartas (por defecto 2) y luego deja 1 de la
// mano (context.targetInstanceId, elegida por el jugador entre TODA la
// mano resultante tras robar — ver drawThenTopdeckActions en engine.ts,
// que simula el robo de antemano para ofrecer esas opciones) encima del
// mazo otra vez. Si por lo que sea no llega ningún target (llamada directa
// sin pasar por getLegalActions), el robo se hace igual pero no se deja
// nada encima del mazo.
registerEffect('drawThenTopdeck', (_state, player, effect, context) => {
  const drawAmount = typeof effect.params?.drawAmount === 'number' ? effect.params.drawAmount : 2;
  drawCards(player, drawAmount);
  if (!context.targetInstanceId) return;
  const idx = player.hand.findIndex((c) => c.instanceId === context.targetInstanceId);
  if (idx === -1) return;
  const [card] = player.hand.splice(idx, 1);
  player.deck.push(card);
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

// Tortuga: sube de nivel 1 moneda de la mano (1->2, 2->3, o 3->5: no hay
// moneda de valor 4, así que el Oro salta directo al Platino), elegida al
// azar entre las que se puedan subir. El id de la carta destino no se puede
// derivar de nextValue con un simple `coin-${nextValue}` (el Platino vale 5
// pero su id es "coin-5" — eso sí coincide, pero conceptualmente es la
// EXCEPCIÓN: si en el futuro se añadiera una moneda cuyo id no coincida con
// su valor, este mapa seguiría funcionando y un `coin-${nextValue}` no).
const COIN_UPGRADE_TARGET: Record<number, string> = { 1: 'coin-2', 2: 'coin-3', 3: 'coin-5' };
registerEffect('upgradeCoin', (state, player) => {
  const upgradable = player.hand.filter(
    (c) => c.type === 'coin' && typeof c.value === 'number' && COIN_UPGRADE_TARGET[c.value] !== undefined
  );
  if (upgradable.length === 0) return;
  const chosen = upgradable[Math.floor(Math.random() * upgradable.length)];
  const idx = player.hand.findIndex((c) => c.instanceId === chosen.instanceId);
  player.hand.splice(idx, 1);
  const targetId = COIN_UPGRADE_TARGET[chosen.value as number];
  player.hand.push(mintInstance(state, getCard(targetId)));
});

// León: ganas params.amount (por defecto 2) de dinero extra para comprar
// ESTE TURNO, fijo (no depende de tu mano). Igual que Serpiente/Loro/
// Delfín: no es una carta, no se añade al mazo ni se puede robar luego.
registerEffect('gainFlatBonusPurchasingPower', (_state, player, effect) => {
  const amount = typeof effect.params?.amount === 'number' ? effect.params.amount : 2;
  player.bonusPurchasingPowerThisTurn += amount;
});

// Cuánto "cuenta" una carta para un hábitat dado, en los efectos que
// cuentan animales de un hábitat (no en los que solo comprueban
// elegibilidad, como la Araña o el Cocodrilo, que siguen mirando
// simplemente si el hábitat está en su lista). El Pez de colores cuenta
// como 2 animales acuáticos, y el Periquito como 2 voladores, en vez de 1.
function habitatWeight(card: CardInstance, habitat: string): number {
  if (card.type !== 'animal' || !(card.habitats as string[])?.includes(habitat)) return 0;
  if (card.id === 'goldfish' && habitat === 'aquatic') return 2;
  if (card.id === 'parakeet' && habitat === 'bird') return 2;
  return 1;
}

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
  const count = effectiveHand(player).reduce((sum, c) => sum + habitatWeight(c, habitat), 0);
  player.bonusPurchasingPowerThisTurn += count;
});

// Ornitorrinco: gana "dinero para comprar" extra solo este turno por cada
// ESPECIE DE ANIMAL DISTINTA que tengas en tu mano en este momento (una
// copia y varias de la misma especie cuentan igual, a diferencia de
// gainBonusPurchasingPowerPerHabitatInHand). Misma effectiveHand que el
// resto de efectos "en tu mano": se cuenta a sí mismo.
registerEffect('gainBonusPurchasingPowerPerDistinctSpeciesInHand', (_state, player) => {
  const species = new Set(
    effectiveHand(player)
      .filter((c) => c.type === 'animal')
      .map((c) => c.species)
  );
  player.bonusPurchasingPowerThisTurn += species.size;
});

// Hiena: cada rival muestra su mano y descarta el animal de MAYOR coste
// (descarte normal, no destrucción: la carta sigue circulando con
// normalidad). Si hay empate de coste, el propio rival elige cuál de los
// empatados (el texto de la carta lo dice explícitamente); si solo hay uno,
// no hay elección real que hacer pero igualmente pasa por el mismo mecanismo
// de descarte pendiente. Si un rival no tiene ningún animal en mano, no
// pierde nada.
registerEffect('discardAnimalFromEachOpponent', (state, player, _effect, context) => {
  const owed: PendingDiscardDecision['owed'] = {};
  for (const opponent of otherPlayers(state, player)) {
    const animals = opponent.hand.filter((c) => c.type === 'animal');
    if (animals.length === 0) continue;
    const maxCost = Math.max(...animals.map((c) => c.marketCost ?? 0));
    const costliest = animals.filter((c) => (c.marketCost ?? 0) === maxCost);
    owed[opponent.id] = { amount: 1, eligibleInstanceIds: costliest.map((c) => c.instanceId) };
  }
  beginPendingDiscard(state, player, owed, { sourceCardName: context.sourceCardName ?? 'efecto' });
});

// Tiburón: cada rival elige y devuelve al mercado (no al descarte) un
// animal de su mano que tenga alguno de params.habitat (["aquatic"]) y
// coste como mucho params.maxCost (3). Si un rival no tiene ninguno
// elegible, no pierde nada (en la práctica, "muestra su mano"). La carta
// vuelve a estar disponible en el mercado de inmediato (ver
// returnToMarket en resolveDiscard, engine.ts) — como una compra
// deshecha, no como un descarte.
registerEffect('returnAnimalFromEachOpponent', (state, player, effect, context) => {
  const maxCost = typeof effect.params?.maxCost === 'number' ? effect.params.maxCost : Infinity;
  const habitats = matchHabitatList(effect.params?.habitat);
  const owed: PendingDiscardDecision['owed'] = {};
  for (const opponent of otherPlayers(state, player)) {
    const eligible = opponent.hand.filter(
      (c) =>
        c.type === 'animal' &&
        (c.marketCost ?? 0) <= maxCost &&
        (habitats.length === 0 || habitats.some((h) => (c.habitats as string[])?.includes(h)))
    );
    if (eligible.length === 0) continue;
    owed[opponent.id] = { amount: 1, eligibleInstanceIds: eligible.map((c) => c.instanceId) };
  }
  beginPendingDiscard(state, player, owed, { sourceCardName: context.sourceCardName ?? 'efecto', kind: 'returnToMarket' });
});

// Pato: el jugador que elijas (context.targetPlayerId, ver
// getLegalActions en engine.ts: una variante de la acción por cada rival
// posible) te da 1 moneda cualquiera de su mano (no tiene que ser de valor
// 1). Si no tiene ninguna, no pierde nada (en la práctica, "muestra su
// mano"). Con 1 solo jugador no hay a quién elegir, así que no hace nada.
registerEffect('stealCoinFromChosenPlayer', (state, player, _effect, context) => {
  if (!context.targetPlayerId) return;
  const target = state.players.find((p) => p.id === context.targetPlayerId);
  if (!target || target.id === player.id) return;
  const coinIdx = target.hand.findIndex((c) => c.type === 'coin');
  if (coinIdx === -1) return;
  const [coin] = target.hand.splice(coinIdx, 1);
  player.hand.push(coin);
});

// Jirafa: recupera a tu mano un animal elegido (context.targetInstanceId,
// ver targetedEffectCandidates en engine.ts) de tu propio descarte. Si tu
// descarte no tiene ningún animal, o no se elige ninguno, no pasa nada.
registerEffect('retrieveAnimalFromDiscard', (_state, player, _effect, context) => {
  if (!context.targetInstanceId) return;
  const idx = player.discard.findIndex((c) => c.instanceId === context.targetInstanceId && c.type === 'animal');
  if (idx === -1) return;
  const [card] = player.discard.splice(idx, 1);
  player.hand.push(card);
});

// Conejos: muestra la carta de encima de tu mazo; si NO es un animal de
// coste superior a params.maxCost (por defecto 2) —es decir, si es una
// moneda, o un animal de ese coste o menos— la añade a tu mano. Si es un
// animal más caro, se queda tal cual encima del mazo (no se roba, no pasa
// nada más): seguirá siendo la próxima carta en robarse con normalidad. Si
// el mazo está vacío se baraja el descarte primero, igual que un robo
// normal (ver drawCards); si tras eso sigue sin haber nada, no pasa nada.
registerEffect('drawTopUnlessExpensiveAnimal', (_state, player, effect) => {
  const maxCost = typeof effect.params?.maxCost === 'number' ? effect.params.maxCost : 2;
  if (player.deck.length === 0) {
    if (player.discard.length === 0) return;
    player.deck = shuffle(player.discard);
    player.discard = [];
  }
  const top = player.deck[player.deck.length - 1];
  if (!top) return;
  const isExpensiveAnimal = top.type === 'animal' && (top.marketCost ?? 0) > maxCost;
  if (isExpensiveAnimal) return;
  player.deck.pop();
  player.hand.push(top);
});

// Flamenco: devuelve al mazo compartido de su especie el animal elegido
// (context.targetInstanceId, de tu mano ESTE TURNO: lo que sigues teniendo
// en la mano, o algo que ya hayas jugado este mismo turno — ver
// returnAnimalForUpgradeActions en engine.ts, que es quien restringe los
// candidatos ofrecidos). Por eso se busca primero en player.hand y luego en
// player.playedThisTurn: puede ser el propio Flamenco, que para cuando se
// resuelve esto ya está ahí porque playCard lo saca de la mano antes de
// resolver su onPlay (pero NO lo manda al descarte de verdad hasta que
// termine el turno, ver endTurn en engine.ts), o cualquier otra carta jugada
// antes este mismo turno. SOLO se resuelve el onPlay de la carta devuelta si
// todavía estaba en la MANO (foundInHand): si hace falta buscarla en
// playedThisTurn es porque ya se jugó antes este turno (o es el propio
// Flamenco, recién jugado) — en ambos casos su habilidad ya se disparó (a
// mano, jugándola de verdad, o no tiene sentido dispararla dos veces sobre
// sí misma), así que volver a resolverla sería duplicarla. Solo se le da ese
// "usa su habilidad" gratis a la que de verdad no se había jugado todavía.
// Luego coges gratis del mercado, SIN resolver su efecto, el animal que el
// jugador haya elegido (context.secondaryTargetInstanceId) de coste como
// mucho effect.params.maxCostDelta (por defecto 1) más que el devuelto.
registerEffect('returnAnimalForUpgrade', (state, player, effect, context) => {
  if (!context.targetInstanceId) return;

  let zone: CardInstance[] = player.hand;
  let idx = zone.findIndex((c) => c.instanceId === context.targetInstanceId && c.type === 'animal');
  const foundInHand = idx !== -1;
  if (!foundInHand) {
    zone = player.playedThisTurn;
    idx = zone.findIndex((c) => c.instanceId === context.targetInstanceId && c.type === 'animal');
  }
  if (idx === -1) return;

  const [returned] = zone.splice(idx, 1);
  // Si se encontró en la mano (nunca estuvo en playedThisTurn) esto es un
  // no-op; si se encontró en playedThisTurn ya se ha quitado con el splice
  // de arriba, así que esto también es un no-op — se deja igualmente por si
  // algún día deja de usarse zone.splice() directamente sobre esa lista.
  removeFromPlayedThisTurn(player, returned.instanceId);
  const deck = state.sharedDecks[returned.species ?? ''];
  // La carta devuelta debe quedar comprable YA MISMO, no esperando su turno
  // en el mazo compartido. Si el hueco de mercado de su especie ya está
  // ocupado (el caso normal), la devuelta ocupa ese hueco de inmediato y la
  // que estaba ahí pasa al mazo compartido en su lugar. Si el hueco estaba
  // vacío (mazo Y hueco agotados a la vez), se repone directamente con ella
  // vía refillHook (sin esto se quedaría esperando en la pila sin que nada
  // volviera a sacarla de ahí: refillAnimalMarket no se llama solo por dejar
  // algo en sharedDecks, solo la comprueba en momentos concretos, como al
  // comprar esa especie).
  const marketIdx = state.animalTrack.findIndex((c) => c.species === returned.species);
  if (marketIdx !== -1) {
    const [displaced] = state.animalTrack.splice(marketIdx, 1, returned);
    if (deck) deck.push(displaced);
  } else {
    if (deck) deck.push(returned);
    refillHook?.(state, returned.species);
  }

  if (foundInHand) {
    for (const e of returned.effects.filter((e) => e.trigger === 'onPlay')) {
      resolveEffect(state, player, e, { sourceCardName: returned.name });
    }
  }

  if (!context.secondaryTargetInstanceId) return;
  const costDelta = typeof effect.params?.maxCostDelta === 'number' ? effect.params.maxCostDelta : 1;
  const maxCost = (returned.marketCost ?? 0) + costDelta;
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
  const count = allCards.reduce((sum, c) => sum + habitatWeight(c, habitat), 0);
  return count * multiplier;
});

// Águila: +1PV (× `multiplier`, por defecto 1) por cada animal de coste
// `minCost` o más que tengas en TODA tu colección (mazo + mano + descarte),
// al final de la partida. Se cuenta a sí misma (coste 5): igual que el
// Albatros con "volador", no hace falta excluirse.
registerScoreEffect('scorePerCostAtLeast', (_player, effect, allCards) => {
  const minCost = typeof effect.params?.minCost === 'number' ? effect.params.minCost : 0;
  const multiplier = typeof effect.params?.multiplier === 'number' ? effect.params.multiplier : 1;
  const count = allCards.filter((c) => c.type === 'animal' && (c.marketCost ?? 0) >= minCost).length;
  return count * multiplier;
});

// Pingüino: al final de la partida, +1PV por cada ESPECIE de animal
// distinta que tengas en toda tu colección (una copia y diez de la misma
// especie cuentan igual: solo importa la variedad).
registerScoreEffect('scorePerDistinctSpecies', (_player, _effect, allCards) => {
  const species = new Set(allCards.filter((c) => c.type === 'animal').map((c) => c.species));
  return species.size;
});

// Efectos onScore que ELIMINAN cartas de la colección (solo el Cocodrilo,
// de momento): scorePlayer los resuelve en una fase previa, antes de sumar
// ningún PV, para que lo que destruyan no llegue a puntuar.
export const DESTRUCTIVE_SCORE_EFFECT_TYPES = new Set(['destroyWeakestNonFlyingOnScore']);

// Cuánto vale REALMENTE una carta a la hora de puntuar: sus PV base más lo
// que le sumen sus propios efectos onScore no destructivos (p. ej. el bonus
// de hábitat de la Orca/Oso polar/Albatros, o el de especies distintas del
// Pingüino), calculado sobre la colección
// ACTUAL del jugador (mazo + mano + descarte, en este momento). Así el
// Cocodrilo compara lo que cada carta aporta DE VERDAD, no solo su PV
// impreso — una carta con bonus siempre vale al menos su PV base (los
// bonus solo suman), así que esto nunca hace más atractiva para destruir a
// una carta que antes se salvaba por PV base, solo puede salvar a alguna
// que antes parecía la más débil sin serlo.
function computedCardValue(player: Player, card: CardInstance): number {
  const allCards = [...player.deck, ...player.hand, ...player.discard];
  let value = card.victoryPoints;
  for (const effect of card.effects.filter(
    (e) => e.trigger === 'onScore' && !DESTRUCTIVE_SCORE_EFFECT_TYPES.has(e.type)
  )) {
    value += resolveScoreEffect(player, effect, allCards, card);
  }
  return value;
}

// Busca en TODA la colección (mazo + mano + descarte), no solo el mazo de
// robo: al final de la partida cada jugador acaba de robar una mano nueva
// (ver endTurn en engine.ts, que roba justo antes de comprobar fin de
// partida), así que el mazo de robo suele tener muy pocas cartas o ninguna
// — restringir la búsqueda a él dejaba al Cocodrilo sin nada que destruir
// la mayoría de las veces, o forzándolo a destruir algo mediocre en vez de
// la carta objetivamente más débil que el jugador tuviera en mano o
// descarte. "No volador" = sin hábitat "bird" (puede tener land y/o
// aquatic, incluso ambos a la vez, como el propio Cocodrilo o el
// Hipopótamo).
function weakestNonFlyingCard(
  player: Player,
  sourceCard: CardInstance,
  excludeSelf: boolean
): { zone: CardInstance[]; idx: number } | null {
  let bestZone: CardInstance[] | null = null;
  let bestIdx = -1;
  let bestValue = Infinity;
  for (const zone of [player.deck, player.hand, player.discard]) {
    for (let i = 0; i < zone.length; i++) {
      const c = zone[i];
      if (c.type !== 'animal' || c.habitats?.includes('bird')) continue;
      if (excludeSelf && c.instanceId === sourceCard.instanceId) continue;
      const value = computedCardValue(player, c);
      if (value < bestValue) {
        bestValue = value;
        bestZone = zone;
        bestIdx = i;
      }
    }
  }
  return bestZone && bestIdx !== -1 ? { zone: bestZone, idx: bestIdx } : null;
}

// Cocodrilo: al final de la partida, ANTES de puntuar, elimina de tu
// colección (mazo, mano o descarte, esté donde esté) una carta de animal no
// volador de menor VALOR REAL (ver computedCardValue: PV base + cualquier
// bonus onScore propio, no solo el PV impreso). Prefiere destruir OTRA
// carta si tiene alguna elegible; solo se destruye a SÍ MISMO cuando es la
// única en toda la colección. Si no tiene ningún animal no volador
// (incluido él mismo), no pasa nada. No suma PV directamente: su "coste" es
// que esa otra carta (o él mismo) deja de contar para nada. Se guarda en
// player.destroyedCards (fuera de mazo/mano/descarte, así que no cuenta
// para nada más) solo para poder mostrarla en el resumen final de la
// partida.
registerScoreEffect('destroyWeakestNonFlyingOnScore', (player, _effect, _allCards, sourceCard) => {
  const target = weakestNonFlyingCard(player, sourceCard, true) ?? weakestNonFlyingCard(player, sourceCard, false);
  if (target) player.destroyedCards.push(...target.zone.splice(target.idx, 1));
  return 0;
});
