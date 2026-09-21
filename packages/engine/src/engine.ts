import { getCard } from './cards/registry';
import { matchHabitatList, type Card, type Effect } from './cards/schema';
import {
  drawCards,
  effectiveHand,
  mintInstance,
  shuffle,
  type CardInstance,
  type GameEdition,
  type GameState,
  type Player,
} from './model/state';
import {
  COIN_UPGRADE_TARGET,
  STAY_ON_TABLE_EFFECT_TYPE,
  pickDefaultDiscard,
  resolveEffect,
  setRefillHook,
} from './effects/registry';

const STARTING_HAND_SIZE = 5;
// Exportado para que bots/rl/marketScarcity.ts pueda iterar las mismas 33
// especies "de mercado" que createGame, sin duplicar la lista.
export const ANIMAL_SPECIES = [
  'monkey',
  'penguin',
  'peacock',
  'lion',
  'tiger',
  'dolphin',
  'goldfish',
  'snake',
  'parrot',
  'elephant',
  'giraffe',
  'spider',
  'hyena',
  'orca',
  'polar-bear',
  'albatross',
  'crocodile',
  'hippopotamus',
  'vulture',
  'duck',
  'flamingo',
  'seal',
  'parakeet',
  'owl',
  'bat',
  'turtle',
  'platypus',
  'rabbit',
  'eagle',
  'shark',
  'toucan',
  'squirrel',
  'raven',
] as const;

// Especies que SOLO existen en la edición completa (mascotas y dinosaurios,
// 2026-09-20): se suman a las 33 de ANIMAL_SPECIES cuando la partida se crea
// con edition 'full'. ANIMAL_SPECIES sigue siendo la baraja clásica tal cual,
// que es la oficial y la que usan los bots RL entrenados.
export const FULL_EDITION_EXTRA_SPECIES = [
  'dog',
  'cat',
  'diplodocus',
  'tyrannosaurus',
  'pterodactyl',
  'mosasaurus',
  'iguana',
  'hamster',
  'pig',
  'chicken',
  'otter',
  'golden-fish',
  'plesiosaurus',
  'pteranodon',
  'hummingbird',
  'ostrich',
  'goose',
] as const;

// Tope de coste de la edición "Aprendizaje" (2026-09-21, pedido explícito
// del usuario): mismo mazo clásico de siempre, pero el mercado solo ofrece
// las especies de coste 4 o menos — 21 de las 33, pensado para partidas más
// sencillas/rápidas sin las cartas caras. Nunca cambia el propio dato de la
// carta (su marketCost sigue siendo el de siempre si algún efecto la trae
// igualmente, p. ej. Jirafa recuperando algo del descarte): solo decide qué
// especies tienen hueco de mercado — ver marketSpeciesFor.
export const LEARNING_EDITION_MAX_COST = 4;

// Recibe el estado (o un subconjunto con edition/customSpeciesList) en vez
// del valor de edición suelto: 'custom' no se puede resolver solo con el
// enum, necesita la lista elegida por el jugador — y todo llamante ya tiene
// `state` a mano, así que no cuesta nada pasarlo entero.
export function marketSpeciesFor(
  state: Pick<GameState, 'edition' | 'customSpeciesList'> | undefined
): readonly string[] {
  if (state?.edition === 'custom') return state.customSpeciesList ?? [];
  if (state?.edition === 'full') return [...ANIMAL_SPECIES, ...FULL_EDITION_EXTRA_SPECIES];
  if (state?.edition === 'learning') {
    return ANIMAL_SPECIES.filter((species) => (getCard(species).marketCost ?? 0) <= LEARNING_EDITION_MAX_COST);
  }
  return ANIMAL_SPECIES;
}

// Copias iniciales de una especie en su sharedDecks, según su coste y el
// nº de jugadores (ver createGame más abajo). Exportada para que
// bots/rl/marketScarcity.ts pueda recalcular el total inicial de cada
// especie sin duplicar esta fórmula. `customDeltas` (edición 'custom', ver
// GameState.customCopyDeltas) ajusta ese resultado por tramo de coste;
// Math.max(1, ...) evita que una especie ya elegida se quede sin ninguna
// copia por un delta agresivo (p. ej. -2 en una cara a 2 jugadores).
export function initialMarketCopies(
  marketCost: number,
  numPlayers: number,
  customDeltas?: { cheap: number; expensive: number }
): number {
  if (!customDeltas) {
    return marketCost >= 5 ? numPlayers : numPlayers + 2;
  }
  // A diferencia del caso sin deltas (arriba), aquí el delta se aplica
  // directamente sobre numPlayers en AMBOS tramos, no sobre el "+2" oculto
  // de las baratas — pedido explícito del usuario 2026-09-21: "que sea
  // sobre el número de jugadores en ambos casos. Ahora mismo las de <=5
  // parece que está sobre jugadores +2". Con los deltas por defecto
  // ({cheap:2, expensive:0}, ver DEFAULT_CUSTOM_COPY_DELTAS en
  // gameConfig.ts) el resultado coincide con el caso sin deltas de arriba.
  const delta = marketCost >= 5 ? customDeltas.expensive : customDeltas.cheap;
  return Math.max(1, numPlayers + delta);
}

// La partida entra en la ronda final en cuanto este número de mazos
// compartidos (de las especies de la edición, todas cuentan) se hayan agotado.
const FINAL_ROUND_EMPTY_DECK_THRESHOLD = 5;
// Monedas que se pueden comprar directamente (a cambio de otras monedas),
// además de conseguirse por efectos o el mazo inicial. Suministro
// ilimitado: no tienen mazo compartido ni se agotan.
const PURCHASABLE_COINS = ['coin-2', 'coin-3', 'coin-5'] as const;

export interface CreatePlayerConfig {
  id: string;
  name: string;
  deck: Card[];
}

export interface CreateGameOptions {
  // Duración de la partida en rondas (una ronda = 1 turno de cada
  // jugador). Si se omite o es null, la partida solo termina cuando se
  // agoten 5 mazos compartidos (ver FINAL_ROUND_EMPTY_DECK_THRESHOLD),
  // como hasta ahora.
  maxRounds?: number | null;
  // Edición de la baraja (ver GameEdition). Por defecto 'classic', la oficial.
  edition?: GameEdition;
  // Solo se usa con edition === 'custom': especies a incluir en el mercado
  // de esta partida (ver GameState.customSpeciesList). Vacío/ausente con
  // 'custom' -> mercado vacío; evitarlo es responsabilidad de quien llama
  // (la web nunca deja arrancar una partida personalizada sin nada elegido).
  customSpecies?: string[];
  // Solo se usa con edition === 'custom': deltas de copias iniciales por
  // tramo de coste (ver initialMarketCopies).
  customCopyDeltas?: { cheap: number; expensive: number };
}

export type Action =
  // Se resuelve el efecto onPlay de la carta y va al descarte.
  // "targetInstanceId" solo aplica a los pocos efectos que necesitan elegir
  // un objetivo propio (el Elefante o la Araña eligiendo qué animal
  // capturar gratis del mercado; el Flamenco eligiendo qué animal de su
  // mano devolver; la Jirafa eligiendo qué animal recuperar de su
  // descarte). "secondaryTargetInstanceId" solo lo usa el Flamenco,
  // para elegir qué animal del mercado coge a cambio; el resto lo ignora.
  // "targetPlayerId" solo lo usa el Pato, para elegir a qué rival afecta su
  // efecto; el resto lo ignora.
  | {
      type: 'playCard';
      instanceId: string;
      targetInstanceId?: string;
      secondaryTargetInstanceId?: string;
      targetPlayerId?: string;
      // Perro (efecto mayStayOnTable): si true, al acabar el turno la carta
      // se queda sobre la mesa (player.table) en vez de ir al descarte.
      keepOnTable?: boolean;
    }
  // Compra un animal del mercado (animalTrack) pagando su coste. Sin
  // trabajador ni límite por turno.
  | { type: 'buyAnimal'; trackInstanceId: string }
  // Compra una moneda de mayor valor (coin-2, coin-3 o coin-5) pagando su coste.
  // Suministro ilimitado, no depende de un mercado con hueco.
  | { type: 'buyCoin'; coinId: (typeof PURCHASABLE_COINS)[number] }
  | { type: 'endTurn' }
  // Resuelve UNA carta de un descarte forzoso pendiente (ver
  // PendingDiscardDecision en model/state.ts): el jugador afectado elige qué
  // descarta, una carta a la vez, hasta cubrir lo que debía.
  | { type: 'resolveDiscard'; instanceId: string }
  // Serpiente (ver pendingAnimalAbilityChoice en model/state.ts): elige cuál
  // de los animales recién descartados por "cada jugador" usa su habilidad
  // onPlay para quien jugó la Serpiente. La carta elegida se queda donde
  // está (en el descarte de quien la entregó); solo se activa su efecto.
  // Los mismos target(Instance|Player)Id/secondaryTargetInstanceId que
  // "playCard" (ver arriba), por si esa habilidad concreta necesita elegir
  // algo (Elefante/Araña/Jirafa/Murciélago, Flamenco, Tigre).
  | {
      type: 'useDiscardedAnimalAbility';
      instanceId: string;
      targetInstanceId?: string;
      secondaryTargetInstanceId?: string;
      targetPlayerId?: string;
    };

// --- Pago con monedas ---------------------------------------------------
// El dinero son cartas de tipo "coin" en la mano, cada una con un valor
// (1/2/3/5). Pagar un coste elige un subconjunto de esas cartas cuya suma lo
// cubra (gastando el mínimo posible de más y, a igualdad, usando el menor
// número de cartas) y las descarta enteras. Si pagan de más, esa
// diferencia no se pierde: se convierte en valor de compra genérico para
// el resto del turno (ver payCoins) en vez de dejar la moneda "a medio
// gastar" con un valor que ya no coincidiría con lo que dice ser.
function coinsInHand(player: Player): CardInstance[] {
  return player.hand.filter((c) => c.type === 'coin');
}

// Solo hay 4 valores de moneda posibles (1/2/3/5 — ver packages/engine/src/
// cards/data/coin-*.json), así que en vez de probar las 2^n combinaciones de
// monedas (viable con "unas pocas monedas como mucho", pero un bot de
// self-play puede acabar acumulando decenas gracias a efectos como el del
// Delfín, y 2^30 ya cuelga la partida varios minutos) basta con recorrer
// cuántas de 5, de 3 y de 2 se usan: el número óptimo de monedas de 1 para
// cada combinación sale directo, sin necesidad de probar también todas sus
// combinaciones. IMPORTANTE: si se añade una moneda de otro valor (ver
// registerEffect('upgradeCoin', ...) en effects/registry.ts, que tuvo el
// mismo problema), hay que sumarle aquí su propio cubo + dimensión de bucle,
// o esa moneda se ignorará silenciosamente al pagar/comprobar qué se puede
// pagar — exactamente el bug que tenía el Platino (coin-5) al añadirse.
function pickCoinsToPay(player: Player, cost: number): CardInstance[] | null {
  const ones: CardInstance[] = [];
  const twos: CardInstance[] = [];
  const threes: CardInstance[] = [];
  const fives: CardInstance[] = [];
  for (const coin of coinsInHand(player)) {
    if (coin.value === 1) ones.push(coin);
    else if (coin.value === 2) twos.push(coin);
    else if (coin.value === 3) threes.push(coin);
    else if (coin.value === 5) fives.push(coin);
  }

  let best: {
    sum: number;
    count: number;
    useOnes: number;
    useTwos: number;
    useThrees: number;
    useFives: number;
  } | null = null;
  for (let useFives = 0; useFives <= fives.length; useFives++) {
    for (let useThrees = 0; useThrees <= threes.length; useThrees++) {
      for (let useTwos = 0; useTwos <= twos.length; useTwos++) {
        const partial = useFives * 5 + useThrees * 3 + useTwos * 2;
        const useOnes = Math.min(ones.length, Math.max(0, cost - partial));
        const sum = partial + useOnes;
        if (sum < cost) continue;
        const count = useOnes + useTwos + useThrees + useFives;
        if (!best || sum < best.sum || (sum === best.sum && count < best.count)) {
          best = { sum, count, useOnes, useTwos, useThrees, useFives };
        }
      }
    }
  }

  if (!best) return null;
  return [
    ...ones.slice(0, best.useOnes),
    ...twos.slice(0, best.useTwos),
    ...threes.slice(0, best.useThrees),
    ...fives.slice(0, best.useFives),
  ];
}

// La moneda extra que da algún efecto (p. ej. serpiente / loro / león) este
// turno (bonusPurchasingPowerThisTurn) cubre primero el coste, más la
// restringida a acuáticos del Delfín (aquaticBonusPurchasingPowerThisTurn) si
// `habitats` incluye "aquatic", más la restringida a dinosaurios del
// Diplodocus (dinosaurBonusPurchasingPowerThisTurn) si incluye "dinosaur" —
// ninguna de las dos aplica comprando una moneda (siempre `habitats = []`);
// el resto, si queda, se paga con monedas físicas.
export function canAffordMarket(player: Player, cost: number, habitats: readonly string[] = []): boolean {
  const bonus =
    player.bonusPurchasingPowerThisTurn +
    (habitats.includes('aquatic') ? player.aquaticBonusPurchasingPowerThisTurn : 0) +
    (habitats.includes('dinosaur') ? player.dinosaurBonusPurchasingPowerThisTurn : 0);
  const remaining = cost - bonus;
  if (remaining <= 0) return true;
  return pickCoinsToPay(player, remaining) !== null;
}

// Nº de dinosaurios que cuentan para el descuento de effectiveMarketCost:
// los jugados (playCard desde la mano) EN ESTE MISMO turno (playedThisTurn,
// igual que effectiveHand) MÁS los que el jugador mantiene sobre la mesa de
// turnos anteriores (player.table, vía mayStayOnTable — hoy Gallina y
// Colibrí, ambos con hábitat dinosaurio) — pedido explícito del usuario
// (2026-09-21): "entre los jugados deben contar los que se quedan en mesa
// de turnos anteriores". Antes solo miraba playedThisTurn, así que una
// Gallina/Colibrí dejada sobre la mesa dejaba de abaratar dinosaurios en
// cuanto pasaba el turno en que se jugó. Usado solo por effectiveMarketCost.
function dinosaursInPlay(player: Player): number {
  const isDinosaur = (c: CardInstance) => (c.habitats as string[] | undefined)?.includes('dinosaur');
  return player.playedThisTurn.filter(isDinosaur).length + player.table.filter(isDinosaur).length;
}

// Coste real de COMPRAR (buyAnimal) un animal del mercado compartido: su
// marketCost menos, si la propia carta lleva costReductionPerDinosaurPlayed
// ThisTurn (Diplodocus/Plesiosaurio/Pteranodon y los 3 que eliminan
// animales — Tiranosaurio/Terodáctilo/Mosasaurio, ver schema.ts), esa
// cantidad por cada dinosaurio que el comprador tenga en juego ahora mismo
// (jugado este turno o mantenido en mesa, ver dinosaursInPlay). Nunca baja
// de 0. El resto de cartas (sin ese campo) pagan siempre su marketCost fijo,
// igual que antes.
export function effectiveMarketCost(player: Player, card: CardInstance): number {
  const reduction = card.costReductionPerDinosaurPlayedThisTurn ?? 0;
  const base = card.marketCost ?? 0;
  if (reduction <= 0) return base;
  return Math.max(0, base - reduction * dinosaursInPlay(player));
}

function payCoins(player: Player, cost: number, habitats: readonly string[] = []): void {
  let remaining = cost;
  // Se gasta primero cualquier moneda restringida (acuática/dinosaurio) que
  // aplique: no sirven para nada más, así que no tiene sentido "reservarlas".
  if (habitats.includes('aquatic')) {
    const fromAquaticBonus = Math.min(remaining, player.aquaticBonusPurchasingPowerThisTurn);
    player.aquaticBonusPurchasingPowerThisTurn -= fromAquaticBonus;
    remaining -= fromAquaticBonus;
  }
  if (habitats.includes('dinosaur')) {
    const fromDinosaurBonus = Math.min(remaining, player.dinosaurBonusPurchasingPowerThisTurn);
    player.dinosaurBonusPurchasingPowerThisTurn -= fromDinosaurBonus;
    remaining -= fromDinosaurBonus;
  }
  const fromBonus = Math.min(remaining, player.bonusPurchasingPowerThisTurn);
  player.bonusPurchasingPowerThisTurn -= fromBonus;
  remaining -= fromBonus;
  if (remaining <= 0) return;
  const toSpend = pickCoinsToPay(player, remaining);
  if (!toSpend) throw new Error('No hay monedas suficientes para pagar');

  for (const coin of toSpend) {
    const idx = player.hand.findIndex((c) => c.instanceId === coin.instanceId);
    player.hand.splice(idx, 1);
    // Igual que una carta jugada (ver playCard): se queda "en el limbo"
    // (playedThisTurn) en vez de ir directa al descarte de verdad, así se
    // sigue viendo sobre la mesa el resto del turno — endTurn ya la manda
    // al descarte junto con todo lo demás sin jugar/gastar.
    player.playedThisTurn.push(coin);
  }

  // El valor de compra se puede repartir como se quiera entre varias
  // compras del mismo turno (p. ej. una moneda de 3 paga algo de 2 y,
  // luego, algo de 1): las monedas gastadas se descartan enteras (nunca se
  // les reduce el valor ni se quedan "a medio gastar" en la mano — una
  // Moneda de oro sigue siendo una Moneda de oro, no una carta con un
  // valor que ya no coincide con lo que dice ser), pero si pagan de más,
  // esa diferencia no se pierde: se convierte en valor de compra genérico
  // (el mismo que da el León, etc.), disponible para el resto del turno.
  const spent = toSpend.reduce((sum, c) => sum + (c.value ?? 0), 0);
  const change = spent - remaining;
  if (change > 0) player.bonusPurchasingPowerThisTurn += change;
}

// Se llama cada vez que un mazo compartido de especie podría haberse
// quedado vacío. En cuanto FINAL_ROUND_EMPTY_DECK_THRESHOLD de ellos están
// agotados a la vez, dispara la ronda final.
function checkFinalRoundTrigger(state: GameState): void {
  if (state.finalRoundTriggerPlayerIndex !== null) return;
  // Solo cuentan los mazos de especies de mercado (ANIMAL_SPECIES): la
  // reserva de Perezosos devueltos por el Flamenco también vive en
  // sharedDecks (ver createGame) pero no es una especie del mercado (esa
  // clave no está en ANIMAL_SPECIES), así que agotarla no debería adelantar
  // el fin de la partida. El Conejo SÍ es una especie de mercado normal, así
  // que a ese sí le aplica el criterio normal.
  const emptyDecks = marketSpeciesFor(state).filter((species) => state.sharedDecks[species]?.length === 0).length;
  if (emptyDecks >= FINAL_ROUND_EMPTY_DECK_THRESHOLD) {
    state.finalRoundTriggerPlayerIndex = state.activePlayerIndex;
    state.log.push(`Se han agotado ${emptyDecks} mazos compartidos: última ronda.`);
  }
}

// --- Mercado de animales --------------------------------------------------
// Siempre intenta tener 1 hueco por especie (33 en la clásica, 39 en la completa); al comprarse uno
// se repone solo el hueco de esa especie, con una copia del mazo compartido
// de esa especie.
//
// onlySpecies puede llegar aquí con CUALQUIER species (p. ej. el Flamenco
// devolviendo un Perezoso de la mano, ver returnAnimalForUpgrade en
// registry.ts, que no sabe ni le importa si esa especie tiene hueco de
// mercado). "sloth" tiene su propia entrada en sharedDecks (ver createGame),
// pero NO es una especie de mercado — sin este filtro, el hueco inexistente
// de "sloth" se "repondría" igualmente, colando un Perezoso comprable gratis
// en el mercado.
function isMarketSpecies(state: GameState, species: string): boolean {
  return marketSpeciesFor(state).includes(species);
}

function refillAnimalMarket(state: GameState, onlySpecies?: string): void {
  const speciesToFill = onlySpecies ? [onlySpecies].filter((s) => isMarketSpecies(state, s)) : [...marketSpeciesFor(state)];
  for (const species of speciesToFill) {
    if (state.animalTrack.some((c) => c.species === species)) continue;
    const deck = state.sharedDecks[species];
    const card = deck?.pop();
    if (card) state.animalTrack.push(card);
  }
  state.animalTrack.sort((a, b) => (a.species ?? '').localeCompare(b.species ?? ''));

  checkFinalRoundTrigger(state);
}

setRefillHook((state, species) => refillAnimalMarket(state, species));

// Efectos "onTurnStart" (de momento solo la Ardilla): se resuelven solos al
// empezar el turno, sin jugar nada, mirando el DESCARTE del jugador (no la
// mano ni el mazo). Se agrupan por (tipo de efecto, especie) para
// resolverse UNA sola vez aunque haya varias copias de esa especie en el
// descarte a la vez (si no, 3 Ardillas en el descarte devolverían 3 de
// golpe en vez de 1) — cada handler se encarga de mover solo 1 copia.
function resolveTurnStartEffects(state: GameState, player: Player): void {
  const handled = new Set<string>();
  for (const card of [...player.discard]) {
    for (const effect of card.effects) {
      if (effect.trigger !== 'onTurnStart') continue;
      const key = `${effect.type}:${card.species}`;
      if (handled.has(key)) continue;
      handled.add(key);
      resolveEffect(state, player, effect, { sourceCardName: card.name, sourceSpecies: card.species });
    }
  }
}

// Perro/Colibrí (mayStayOnTable) mantenidos de turnos anteriores: pedido
// explícito del usuario (2026-09-21) "en los siguientes turnos que te
// aparezcan como jugadas, y que se dispare su habilidad si la tiene" — cada
// turno vuelven a contar como recién jugadas (entran en playedThisTurn, como
// cualquier otra carta jugada este turno: cuentan para effectiveHand, el
// descuento de dinosaurios, etc.) y su(s) efecto(s) onPlay se resuelven de
// nuevo (salvo mayStayOnTable, que no hace nada por sí solo). Así el Perro
// da +1 de valor de compra TODOS los turnos que esté en la mesa, no solo el
// turno en que se jugó. Se marcan otra vez en stayingOnTableIds para que
// endTurn las devuelva a la mesa (en vez de descartarlas) exactamente igual
// que si se acabaran de jugar con keepOnTable — ver endTurn más abajo.
function replayTableCards(state: GameState, player: Player): void {
  const kept = player.table;
  player.table = [];
  for (const card of kept) {
    player.playedThisTurn.push(card);
    player.stayingOnTableIds.push(card.instanceId);
    for (const effect of card.effects) {
      if (effect.trigger !== 'onPlay' || effect.type === STAY_ON_TABLE_EFFECT_TYPE) continue;
      resolveEffect(state, player, effect, { sourceCardName: card.name, sourceInstanceId: card.instanceId });
    }
  }
}

// Solo resetea los contadores propios de ESTE turno; ya NO roba (ver
// endTurn: la mano se roba al final del turno anterior, no al principio del
// siguiente, para que los rivales tengan mano de verdad entre turno y
// turno).
function beginPlayerTurn(state: GameState, player: Player): void {
  player.bonusPurchasingPowerThisTurn = 0;
  player.aquaticBonusPurchasingPowerThisTurn = 0;
  player.dinosaurBonusPurchasingPowerThisTurn = 0;
  player.boughtSpeciesThisTurn = [];
  player.playedThisTurn = [];
  player.stayingOnTableIds = [];
  replayTableCards(state, player);
  resolveTurnStartEffects(state, player);
  recordRichestTurn(state, player);
}

// Valor de compra TOTAL disponible ahora mismo: monedas de verdad en mano +
// el bonus genérico (Serpiente/Loro/León/cambio de una compra...) + el
// bonus solo-acuático (Delfín) y solo-dinosaurio (Diplodocus). Mismos
// ingredientes que canAffordMarket, pero sumados en vez de comparados contra
// un coste. Se exporta para que la web pueda mostrar en vivo el valor de
// compra de OTRO jugador mientras juega su turno (ver ActivePlayerMoney/
// GameBoard.tsx), sin duplicar esta fórmula ahí.
export function currentPurchasingPower(player: Player): number {
  const coins = player.hand.filter((c) => c.type === 'coin').reduce((sum, c) => sum + (c.value ?? 0), 0);
  return (
    coins +
    player.bonusPurchasingPowerThisTurn +
    player.aquaticBonusPurchasingPowerThisTurn +
    player.dinosaurBonusPurchasingPowerThisTurn
  );
}

// richestTurn guarda el PICO de valor de compra alcanzado en un turno, no
// solo el de la mano inicial: se llama tras jugar una carta (algunos
// efectos dan bonus) y tras cada compra (el cambio de una compra con de más
// también da bonus, ver payCoins), además de al empezar el turno. Comprar
// gasta monedas/bonus y por tanto BAJA currentPurchasingPower, pero como
// esto se queda con el máximo visto en toda la partida (nunca lo baja),
// capturar el pico de cada turno antes de que se gaste es exactamente
// "el valor de compra total del turno después de jugar todos los animales".
function recordRichestTurn(state: GameState, player: Player): void {
  const amount = currentPurchasingPower(player);
  if (!player.richestTurn || amount > player.richestTurn.amount) {
    player.richestTurn = { round: state.round, amount };
  }
}

// Como mucho 1 compra de mercado (buyAnimal) por ESPECIE y turno: puedes
// comprar tantos animales distintos como quieras/puedas pagar en el mismo
// turno, pero no 2 copias del mismo (el mercado repone el hueco con otra
// copia de la misma especie justo al comprarla, así que sin este límite se
// podría comprar la misma varias veces seguidas). Solo limita compras
// directas; las capturas gratis de efectos (Elefante/Araña/Flamenco) no
// cuentan para este límite.
function canBuySpecies(player: Player, animal: CardInstance): boolean {
  return !animal.species || !player.boughtSpeciesThisTurn.includes(animal.species);
}

export function createGame(playerConfigs: CreatePlayerConfig[], options: CreateGameOptions = {}): GameState {
  const state: GameState = {
    players: [],
    activePlayerIndex: 0,
    turn: 1,
    round: 1,
    edition: options.edition ?? 'classic',
    customSpeciesList: options.edition === 'custom' ? (options.customSpecies ?? []) : undefined,
    customCopyDeltas: options.edition === 'custom' ? options.customCopyDeltas : undefined,
    maxRounds: options.maxRounds ?? null,
    log: [],
    nextInstanceId: 0,
    sharedDecks: {},
    animalTrack: [],
    finalRoundTriggerPlayerIndex: null,
    gameOver: false,
    scoringFinalized: false,
    pendingDecision: null,
    pendingAnimalAbilityChoice: null,
  };

  state.players = playerConfigs.map((cfg) => {
    const deck = shuffle(cfg.deck.map((card) => mintInstance(state, card)));
    return {
      id: cfg.id,
      name: cfg.name,
      deck,
      hand: [],
      discard: [],
      bonusPurchasingPowerThisTurn: 0,
      aquaticBonusPurchasingPowerThisTurn: 0,
      dinosaurBonusPurchasingPowerThisTurn: 0,
      boughtSpeciesThisTurn: [],
      playedThisTurn: [],
      table: [],
      stayingOnTableIds: [],
      purchasesCount: 0,
      richestTurn: null,
      destroyedCards: [],
    };
  });

  // Un mazo por especie, con copias escaladas al nº de jugadores: nº de
  // jugadores para las especies caras (coste 5 o más) — son las de más
  // PV/mejores habilidades, y con menos copias en juego se agotan antes,
  // dándoles algo de escasez real —, nº de jugadores + 2 para el resto.
  const numPlayers = playerConfigs.length;
  for (const species of marketSpeciesFor(state)) {
    const speciesCard = getCard(species);
    const copiesPerSpecies = initialMarketCopies(speciesCard.marketCost ?? 0, numPlayers, state.customCopyDeltas);
    state.sharedDecks[species] = shuffle(
      Array.from({ length: copiesPerSpecies }, () => mintInstance(state, speciesCard))
    );
  }

  // Reserva de Perezosos: NO es el mazo de ningún jugador (el Perezoso ni
  // siquiera es una especie de ANIMAL_SPECIES, nunca sale en el mercado),
  // así que reutiliza sharedDecks solo como almacén genérico. Empieza vacía:
  // solo existe para que un Perezoso devuelto por el Flamenco
  // (returnAnimalForUpgrade en registry.ts) tenga dónde aterrizar en vez de
  // desaparecer de la partida, ya que nunca se cuela en el mercado
  // (isMarketSpecies lo excluye) ni nada vuelve a sacar de aquí.
  state.sharedDecks['sloth'] = [];

  refillAnimalMarket(state);

  // TODOS los jugadores empiezan la partida con mano (no solo el primero en
  // jugar): si no, efectos que miran la mano de un rival (Mono, Buitre,
  // Hiena, Pato) no tendrían nada que hacer hasta que a ese rival le tocara
  // jugar por primera vez.
  for (const player of state.players) {
    drawCards(player, STARTING_HAND_SIZE);
  }
  beginPlayerTurn(state, getActivePlayer(state));
  return state;
}

export function getActivePlayer(state: GameState): Player {
  return state.players[state.activePlayerIndex];
}

function requireActivePlayer(state: GameState, playerId: string): Player {
  if (state.gameOver) throw new Error('La partida ha terminado');
  // Ninguna acción normal (jugar, comprar, terminar turno) es legal mientras
  // haya un descarte forzoso pendiente, ni siquiera para el jugador activo:
  // ver PendingDiscardDecision y resolveDiscard.
  if (state.pendingDecision) throw new Error('Hay una entrega de cartas pendiente: resuélvela antes de seguir');
  const player = state.players.find((p) => p.id === playerId);
  if (!player) throw new Error(`Jugador desconocido: ${playerId}`);
  if (getActivePlayer(state).id !== playerId) throw new Error(`No es el turno de ${playerId}`);
  return player;
}

// Algunas cartas necesitan elegir un objetivo propio al jugarlas: el
// Elefante y la Araña (qué animal del mercado capturar gratis), o la
// Jirafa (qué animal de su propio descarte recuperar). Devuelve null si la
// carta no necesita elegir nada (la inmensa mayoría). El Flamenco se trata
// aparte en getLegalActions porque necesita DOS elecciones encadenadas (qué
// animal devolver + qué animal coger a cambio), no solo una lista plana de
// candidatos.
// Efectos que necesitan elegir un JUGADOR (no una carta) como objetivo: el
// Pato (de quién robar 1 moneda). Ver PLAYER_TARGETED_EFFECT_TYPES más
// abajo, en getLegalActions.
const PLAYER_TARGETED_EFFECT_TYPES = new Set(['stealCoinFromChosenPlayer']);

// Una candidata por CLAVE distinta (por defecto `id`, que para una moneda
// ya identifica el tipo entero — Bronce/Plata/Oro/Platino no tienen
// `species` como los animales, así que sin esto cada copia física entraba
// como candidata aparte): pedido explícito del usuario para el Murciélago
// ("que no pregunte si todas son iguales") y ya usado por la Tortuga (por
// `value`, ver más abajo) — da igual CUÁL copia concreta se elija entre
// las que comparten clave, el resultado es idéntico.
function dedupeByKey<T>(items: T[], keyFn: (item: T) => string | number): T[] {
  const seen = new Set<string | number>();
  const representatives: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    representatives.push(item);
  }
  return representatives;
}

function targetedEffectCandidates(state: GameState, player: Player, card: CardInstance): CardInstance[] | null {
  const freeCapture = card.effects.find((e) => e.trigger === 'onPlay' && e.type === 'freeCaptureUpToCost');
  if (freeCapture) {
    const maxCost = typeof freeCapture.params?.maxCost === 'number' ? freeCapture.params.maxCost : Infinity;
    const habitats = matchHabitatList(freeCapture.params?.habitat);
    const excludeHabitat =
      typeof freeCapture.params?.excludeHabitat === 'string' ? freeCapture.params.excludeHabitat : null;
    return state.animalTrack.filter(
      (c) =>
        (c.marketCost ?? 0) <= maxCost &&
        (habitats.length === 0 || habitats.some((h) => (c.habitats as string[])?.includes(h))) &&
        (!excludeHabitat || !(c.habitats as string[])?.includes(excludeHabitat))
    );
  }
  const retrieveFromDiscard = card.effects.find((e) => e.trigger === 'onPlay' && e.type === 'retrieveAnimalFromDiscard');
  if (retrieveFromDiscard) {
    return player.discard.filter((c) => c.type === 'animal');
  }
  const retrieveCoinFromDiscard = card.effects.find((e) => e.trigger === 'onPlay' && e.type === 'retrieveCoinFromDiscard');
  if (retrieveCoinFromDiscard) {
    return dedupeByKey(
      player.discard.filter((c) => c.type === 'coin'),
      (c) => c.id
    );
  }
  const upgradeCoin = card.effects.find((e) => e.trigger === 'onPlay' && e.type === 'upgradeCoin');
  if (upgradeCoin) {
    // Tortuga: pedido explícito del usuario — un candidato por VALOR
    // distinto de moneda mejorable en la mano, nunca uno por copia física
    // (da igual cuál de tus 3 Bronces subas, el resultado es idéntico).
    const upgradable = player.hand.filter(
      (c) => c.type === 'coin' && typeof c.value === 'number' && COIN_UPGRADE_TARGET[c.value] !== undefined
    );
    return dedupeByKey(upgradable, (c) => c.value as number);
  }
  const discardCoinToDraw = card.effects.find((e) => e.trigger === 'onPlay' && e.type === 'discardCoinMinValueToDrawCards');
  if (discardCoinToDraw) return discardCoinCandidates(player, discardCoinToDraw.params?.minValue);
  const exchangeCoin = card.effects.find((e) => e.trigger === 'onPlay' && e.type === 'exchangeCoinForFixed');
  if (exchangeCoin) return discardCoinCandidates(player, 0);
  return null;
}

// Cerdo/Pez Dorado: un candidato por VALOR distinto de moneda en la mano que
// llegue a `minValue` (por defecto 0, cualquiera) — mismo criterio de
// deduplicado que la Tortuga con upgradeCoin.
function discardCoinCandidates(player: Player, minValue: unknown): CardInstance[] {
  const min = typeof minValue === 'number' ? minValue : 0;
  const eligible = player.hand.filter((c) => c.type === 'coin' && typeof c.value === 'number' && c.value >= min);
  return dedupeByKey(eligible, (c) => c.value as number);
}

// Combinación de objetivo(s) que necesita UN efecto onPlay concreto, sin
// atarla todavía a ningún tipo de Action ni instanceId de la carta que lo
// dispara: la misma lista sirve tanto para generar variantes de "playCard"
// (jugar la carta de tu mano de verdad) como de "useDiscardedAnimalAbility"
// (Serpiente: usar la habilidad de un animal ajeno recién descartado como si
// lo hubieras jugado tú) — ver effectTargetSpecsForCard más abajo, que es la
// única función que de verdad mira DE QUÉ efecto se trata.
interface EffectTargetSpec {
  targetInstanceId?: string;
  secondaryTargetInstanceId?: string;
  targetPlayerId?: string;
}

// Genera las combinaciones de objetivo para el Flamenco (o cualquier otra
// carta que use returnAnimalForUpgrade): una por cada combinación de (animal
// de tu mano ESTE TURNO que devuelves, animal del mercado que coges a
// cambio, de coste como mucho effect.params.maxCostDelta —por defecto 1—
// más que el devuelto). "Tu mano este turno" = effectiveHand: lo que tienes
// ahora en la mano más lo que ya hayas jugado en este mismo turno (mismo
// criterio que el resto de efectos que miran "tu mano", ver
// effectiveHand()); no incluye ni el mazo ni cartas jugadas en turnos
// anteriores. El Perezoso SÍ se puede devolver (coste 0, así que se puede
// cambiar por cualquier animal de hasta 2 de coste): aunque no tenga hueco
// de mercado propio, returnAnimalForUpgrade en registry.ts lo manda de
// vuelta a su reserva compartida sin colarlo nunca en el mercado (ver
// isMarketSpecies en refillAnimalMarket). Si un animal devuelto no tiene
// ningún destino posible en el mercado, se ofrece igual la variante sin
// `secondaryTargetInstanceId` (se usa la habilidad pero no se coge nada a
// cambio). Usado también por la Serpiente (ver
// effectTargetSpecsForCard): el animal que se DEVUELVE siempre sale de la
// mano de quien la usa, nunca de la carta descartada elegida.
function returnAnimalForUpgradeTargetSpecs(state: GameState, player: Player, effect: Effect): EffectTargetSpec[] {
  const costDelta = typeof effect.params?.maxCostDelta === 'number' ? effect.params.maxCostDelta : 1;
  const sources = effectiveHand(player).filter((c) => c.type === 'animal');
  const specs: EffectTargetSpec[] = [];
  for (const source of sources) {
    const maxCost = (source.marketCost ?? 0) + costDelta;
    const destinations = state.animalTrack.filter((c) => (c.marketCost ?? 0) <= maxCost);
    if (destinations.length === 0) {
      specs.push({ targetInstanceId: source.instanceId });
      continue;
    }
    for (const destination of destinations) {
      specs.push({ targetInstanceId: source.instanceId, secondaryTargetInstanceId: destination.instanceId });
    }
  }
  return specs;
}

// Genera las combinaciones de objetivo para el Tigre (o cualquier otra
// carta que use drawThenTopdeck): una por cada carta de la mano que
// resultaría DESPUÉS de robar, para elegir cuál se deja encima del mazo.
// Como el robo es determinista (el mazo ya está barajado; solo "es
// aleatorio" en el sentido de que el jugador no lo ve de antemano), se
// simula sobre una copia de deck/hand/discard — nunca sobre el player real
// — para saber exactamente qué mano resultaría (incluido un posible
// rebarajado del descarte si el mazo se queda corto a mitad del robo) sin
// mutar la partida de verdad. `excludeInstanceId` quita de las opciones la
// propia carta que dispara el efecto SI todavía sigue en la mano de verdad
// (el Tigre jugado desde tu mano: playCard aún no lo ha sacado cuando esto
// se llama) — con la Serpiente la carta origen nunca está en tu mano (sigue
// en el descarte de quien la entregó), así que ahí no hay nada que excluir.
function drawThenTopdeckTargetSpecs(player: Player, effect: Effect, excludeInstanceId?: string): EffectTargetSpec[] {
  const drawAmount = typeof effect.params?.drawAmount === 'number' ? effect.params.drawAmount : 2;
  const preview: Player = { ...player, deck: [...player.deck], hand: [...player.hand], discard: [...player.discard] };
  drawCards(preview, drawAmount);
  return preview.hand
    .filter((c) => c.instanceId !== excludeInstanceId)
    .map((c) => ({ targetInstanceId: c.instanceId }));
}

// Gallina: una combinación por cada (moneda de la mano que descartas, animal
// del mercado con alguno de effect.params.habitat y coste como mucho
// effect.params.maxCost que capturas a cambio) — ambos objetivos se eligen a
// la vez, igual que el Flamenco (returnAnimalForUpgradeTargetSpecs). Sin
// ninguna moneda elegible, ninguna combinación que ofrecer: `[{}]` (el
// efecto no hará nada). Con monedas pero sin ningún destino posible en el
// mercado, se ofrece igual la variante solo con la moneda (se descarta mas
// no se captura nada) — mismo criterio que returnAnimalForUpgradeTargetSpecs
// cuando el animal devuelto no tiene ningún destino posible.
function discardCoinToCaptureTargetSpecs(state: GameState, player: Player, effect: Effect): EffectTargetSpec[] {
  const coins = discardCoinCandidates(player, effect.params?.minValue);
  if (coins.length === 0) return [{}];
  const maxCost = typeof effect.params?.maxCost === 'number' ? effect.params.maxCost : Infinity;
  const habitats = matchHabitatList(effect.params?.habitat);
  const destinations = state.animalTrack.filter(
    (c) => (c.marketCost ?? 0) <= maxCost && (habitats.length === 0 || habitats.some((h) => (c.habitats as string[])?.includes(h)))
  );
  if (destinations.length === 0) return coins.map((c) => ({ targetInstanceId: c.instanceId }));
  const specs: EffectTargetSpec[] = [];
  for (const coin of coins) {
    for (const destination of destinations) {
      specs.push({ targetInstanceId: coin.instanceId, secondaryTargetInstanceId: destination.instanceId });
    }
  }
  return specs;
}

// Nutria: una combinación por cada (moneda de la mano que descartas, carta
// de las effect.params.peekCount superiores de tu mazo que te quedas) — la
// "cima" del mazo se simula robando sobre una copia del jugador (mismo
// patrón que drawThenTopdeckTargetSpecs: el robo es determinista, solo hace
// falta ver qué tocaría sin mutar la partida de verdad). Sin ninguna moneda
// elegible, `[{}]`. Con monedas pero mazo+descarte vacíos del todo (no hay
// nada que mirar), se ofrece la variante solo con la moneda.
function discardCoinToPeekTargetSpecs(player: Player, effect: Effect): EffectTargetSpec[] {
  const coins = discardCoinCandidates(player, effect.params?.minValue);
  if (coins.length === 0) return [{}];
  const peekCount = typeof effect.params?.peekCount === 'number' ? effect.params.peekCount : 3;
  const preview: Player = { ...player, deck: [...player.deck], hand: [], discard: [...player.discard] };
  drawCards(preview, peekCount);
  const peeked = preview.hand;
  if (peeked.length === 0) return coins.map((c) => ({ targetInstanceId: c.instanceId }));
  const specs: EffectTargetSpec[] = [];
  for (const coin of coins) {
    for (const card of peeked) {
      specs.push({ targetInstanceId: coin.instanceId, secondaryTargetInstanceId: card.instanceId });
    }
  }
  return specs;
}

// Avestruz/Cocodrilo: la opción "robar" (spec vacío `{}`) SIEMPRE está
// disponible, y además una opción por cada (especie de effect.params.
// speciesOptions AHORA MISMO visible en el mercado × moneda de la mano de
// valor effect.params.minValue o más, ver discardCoinCandidates) — evolucionar
// cuesta descartar esa moneda (context.secondaryTargetInstanceId, pedido
// explícito del usuario 2026-09-21), así que sin ninguna moneda que la
// costee no se ofrece ninguna variante de evolución, solo robar. Sin
// effect.params.minValue (cartas futuras con este efecto sin coste), se
// mantiene el comportamiento de siempre: una opción por especie candidata,
// sin moneda. A diferencia del resto de efectos "forzoso si es posible"
// (Tortuga, Cerdo), aquí robar sigue siendo una opción real aunque haya
// alguna especie capturable.
function drawOrReturnSelfForSpeciesTargetSpecs(state: GameState, player: Player, effect: Effect): EffectTargetSpec[] {
  const speciesOptions = Array.isArray(effect.params?.speciesOptions)
    ? (effect.params.speciesOptions as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];
  const candidates = state.animalTrack.filter((c) => speciesOptions.includes(c.species ?? ''));
  const minCoinValue = effect.params?.minValue;
  if (typeof minCoinValue !== 'number') {
    return [{}, ...candidates.map((c) => ({ targetInstanceId: c.instanceId }))];
  }
  const coins = discardCoinCandidates(player, minCoinValue);
  if (coins.length === 0) return [{}];
  const specs: EffectTargetSpec[] = [{}];
  for (const coin of coins) {
    for (const candidate of candidates) {
      specs.push({ targetInstanceId: candidate.instanceId, secondaryTargetInstanceId: coin.instanceId });
    }
  }
  return specs;
}

// Punto único que decide, para CUALQUIER carta con un efecto onPlay que
// necesite elegir un objetivo, qué combinaciones son legales ahora mismo —
// sin saber ni importarle si esa carta se va a jugar de verdad (playCard,
// sale de tu mano) o si es un animal ajeno recién descartado cuya habilidad
// usa la Serpiente (useDiscardedAnimalAbility, se queda donde está). Antes
// esa segunda vía llamaba a resolveEffect directamente sin objetivo
// ninguno, así que cualquier habilidad que necesitara elegir algo (Elefante/
// Araña/Jirafa/Murciélago, Flamenco, Tigre) simplemente no hacía nada — el
// pedido explícito del usuario que motivó esto: "si con la Serpiente uso una
// Araña o un Flamenco debería interactuar con mis cartas y mi descarte".
// Sin ningún objetivo que elegir (el caso normal, la mayoría de cartas):
// una única combinación vacía `[{}]`, nunca `[]` — así el llamante siempre
// puede iterar el resultado igual, sin un caso especial para "no hace
// falta elegir nada".
function effectTargetSpecsForCard(
  state: GameState,
  player: Player,
  card: CardInstance,
  excludeFromHandInstanceId?: string
): EffectTargetSpec[] {
  const returnForUpgrade = card.effects.find((e) => e.trigger === 'onPlay' && e.type === 'returnAnimalForUpgrade');
  if (returnForUpgrade) return returnAnimalForUpgradeTargetSpecs(state, player, returnForUpgrade);

  const drawThenTopdeck = card.effects.find((e) => e.trigger === 'onPlay' && e.type === 'drawThenTopdeck');
  if (drawThenTopdeck) return drawThenTopdeckTargetSpecs(player, drawThenTopdeck, excludeFromHandInstanceId);

  const discardCoinToCapture = card.effects.find((e) => e.trigger === 'onPlay' && e.type === 'discardCoinToCapture');
  if (discardCoinToCapture) return discardCoinToCaptureTargetSpecs(state, player, discardCoinToCapture);

  const discardCoinToPeek = card.effects.find((e) => e.trigger === 'onPlay' && e.type === 'discardCoinMinValueToPeekAndKeep');
  if (discardCoinToPeek) return discardCoinToPeekTargetSpecs(player, discardCoinToPeek);

  const drawOrReturnSelf = card.effects.find((e) => e.trigger === 'onPlay' && e.type === 'drawOrReturnSelfForSpecies');
  if (drawOrReturnSelf) return drawOrReturnSelfForSpeciesTargetSpecs(state, player, drawOrReturnSelf);

  const playerTargeted = card.effects.find((e) => e.trigger === 'onPlay' && PLAYER_TARGETED_EFFECT_TYPES.has(e.type));
  if (playerTargeted) {
    const candidates = state.players.filter((p) => p.id !== player.id);
    return candidates.length > 0 ? candidates.map((c) => ({ targetPlayerId: c.id })) : [{}];
  }

  const candidates = targetedEffectCandidates(state, player, card);
  if (candidates && candidates.length > 0) return candidates.map((c) => ({ targetInstanceId: c.instanceId }));
  return [{}];
}

export function getLegalActions(state: GameState, playerId: string): Action[] {
  if (state.gameOver) return [];

  // Serpiente: mientras quede pendiente elegir qué habilidad usar (ver
  // pendingAnimalAbilityChoice en model/state.ts), SOLO quien jugó la
  // Serpiente tiene alguna acción legal — igual que un descarte forzoso
  // pendiente bloquea a todos los demás. Nunca coincide con
  // state.pendingDecision a la vez (uno arranca justo cuando el otro se
  // vacía del todo), así que el orden entre ambos bloques no importa.
  if (state.pendingAnimalAbilityChoice) {
    const choice = state.pendingAnimalAbilityChoice;
    if (choice.sourcePlayerId !== playerId) return [];
    const player = state.players.find((p) => p.id === playerId);
    if (!player) return [];
    const actions: Action[] = [];
    for (const instanceId of choice.candidateInstanceIds) {
      const card = findInAnyDiscard(state, instanceId);
      if (!card) continue;
      // Sin excludeFromHandInstanceId: la carta elegida nunca está en la
      // mano de quien la usa (sigue en el descarte de quien la entregó), así
      // que no hay nada propio que excluir de las opciones del Tigre.
      for (const spec of effectTargetSpecsForCard(state, player, card)) {
        actions.push({ type: 'useDiscardedAnimalAbility', instanceId, ...spec });
      }
    }
    return actions;
  }

  // Con un descarte forzoso pendiente, NADIE tiene ninguna acción normal
  // (ni siquiera el jugador activo): solo pueden actuar quienes todavía
  // deban descartar, y solo resolveDiscard, una carta a la vez, restringida
  // a lo que les esté permitido elegir (ver PendingDiscardDecision).
  if (state.pendingDecision) {
    const decision = state.pendingDecision;
    const owed = decision.owed[playerId];
    if (!owed || owed.amount <= 0) return [];
    const player = state.players.find((p) => p.id === playerId);
    if (!player) return [];
    // eligibleInstanceIds puede incluir cartas de player.table (mantenidas
    // de turnos anteriores vía mayStayOnTable), no solo de la mano — ver
    // eachOpponentDestroysAnimalFromHand en registry.ts.
    const eligible = owed.eligibleInstanceIds
      ? [...player.hand, ...player.table].filter((c) => owed.eligibleInstanceIds!.includes(c.instanceId))
      : player.hand;
    // Perezoso: siempre se puede descartar en su lugar (aunque no esté entre
    // las elegibles "normales", como los animales más caros de la Hiena),
    // cubriendo TODA la entrega de una vez — ver el trato especial en
    // resolveDiscard. Solo aplica a entregas de tipo 'discard'. Murciélago:
    // mismo trato pero para cualquier 'destroy' (Tiburón/Halcón/León y
    // también Tiranosaurio/Pterodáctilo/Mosasaurio) — se protege
    // descartándose él en vez de perder el animal. Gato: mismo trato, pero
    // SOLO para el 'destroy' con requiredHabitats (la habilidad de "cada
    // oponente elimina un animal de X hábitat"), sea cual sea ese hábitat —
    // ver isCatSubstitute en resolveDiscard.
    const extra = [
      ...(decision.kind === 'discard' ? player.hand.filter((c) => c.id === 'sloth' && !eligible.includes(c)) : []),
      ...(decision.kind === 'destroy' ? player.hand.filter((c) => c.id === 'bat' && !eligible.includes(c)) : []),
      ...(decision.kind === 'destroy' && decision.requiredHabitats !== undefined
        ? player.hand.filter((c) => c.id === 'cat' && !eligible.includes(c))
        : []),
    ];
    return [...eligible, ...extra].map((c) => ({ type: 'resolveDiscard', instanceId: c.instanceId }));
  }

  const player = state.players.find((p) => p.id === playerId);
  if (!player || getActivePlayer(state).id !== playerId) return [];

  const actions: Action[] = [];

  for (const card of player.hand) {
    // Las monedas nunca se juegan: se gastan solas al pagar una compra.
    if (card.type === 'coin') continue;

    const mayStayOnTable = card.effects.some((e) => e.trigger === 'onPlay' && e.type === STAY_ON_TABLE_EFFECT_TYPE);
    for (const spec of effectTargetSpecsForCard(state, player, card, card.instanceId)) {
      actions.push({ type: 'playCard', instanceId: card.instanceId, ...spec });
      // Perro: misma jugada, pero dejándolo sobre la mesa en vez de en el descarte.
      if (mayStayOnTable) actions.push({ type: 'playCard', instanceId: card.instanceId, ...spec, keepOnTable: true });
    }
  }

  for (const trackAnimal of state.animalTrack) {
    const habitats = (trackAnimal.habitats as string[] | undefined) ?? [];
    if (canAffordMarket(player, effectiveMarketCost(player, trackAnimal), habitats) && canBuySpecies(player, trackAnimal)) {
      actions.push({ type: 'buyAnimal', trackInstanceId: trackAnimal.instanceId });
    }
  }

  for (const coinId of PURCHASABLE_COINS) {
    if (canAffordMarket(player, getCard(coinId).marketCost ?? 0)) {
      actions.push({ type: 'buyCoin', coinId });
    }
  }

  actions.push({ type: 'endTurn' });
  return actions;
}

export function playCard(
  state: GameState,
  playerId: string,
  instanceId: string,
  targetInstanceId?: string,
  secondaryTargetInstanceId?: string,
  targetPlayerId?: string,
  keepOnTable?: boolean
): void {
  const player = requireActivePlayer(state, playerId);

  const cardIndex = player.hand.findIndex((c) => c.instanceId === instanceId);
  if (cardIndex === -1) throw new Error(`La carta ${instanceId} no está en la mano de ${playerId}`);
  const card = player.hand[cardIndex];
  if (card.type === 'coin') throw new Error('Las monedas no se juegan: se gastan solas al pagar una compra');

  player.hand.splice(cardIndex, 1);
  // NO va al descarte todavía: se queda "en el limbo" (playedThisTurn) hasta
  // que termine el turno (ver endTurn), que es cuando de verdad se descarta
  // — igual que el resto de la mano no jugada. Antes de resolver el efecto:
  // para los efectos que cuentan animales "en tu mano" (ver effectiveHand),
  // esta carta debe contarse a sí misma, y seguir contando el resto del
  // turno. Solo lo que se COMPRA o se CAPTURA (buyAnimal/buyCoin/capturas
  // gratis de efectos) va directo al descarte de verdad.
  player.playedThisTurn.push(card);
  if (keepOnTable) {
    if (!card.effects.some((e) => e.trigger === 'onPlay' && e.type === STAY_ON_TABLE_EFFECT_TYPE)) {
      throw new Error(`${card.name} no se puede dejar sobre la mesa`);
    }
    // Sigue en playedThisTurn el resto del turno (cuenta para effectiveHand
    // como cualquier carta jugada); endTurn la pasa a player.table.
    (player.stayingOnTableIds ??= []).push(card.instanceId);
  }

  for (const effect of card.effects.filter((e) => e.trigger === 'onPlay')) {
    resolveEffect(state, player, effect, {
      targetInstanceId,
      secondaryTargetInstanceId,
      targetPlayerId,
      sourceCardName: card.name,
      sourceInstanceId: card.instanceId,
    });
  }
  // Si alguno de esos efectos ha dejado un descarte forzoso pendiente
  // (Buitre/Mono/Hiena/Murciélago), resuelve solo, sin esperar a nadie, a
  // cualquier afectado que en realidad no tenga elección que hacer (le
  // caben exactamente tantas cartas elegibles como debe descartar) — solo
  // debe bloquear la partida cuando de verdad haya que elegir.
  autoResolveForcedDiscards(state);
  // Algunas de esas habilidades dan valor de compra extra (Serpiente, Loro,
  // León, Delfín...): puede que este sea el pico de la partida para este
  // jugador, ver recordRichestTurn.
  recordRichestTurn(state, player);

  state.log.push(keepOnTable ? `${player.name} jugó ${card.name} y lo dejó sobre la mesa` : `${player.name} jugó ${card.name}`);
}

// Compra un animal del mercado pagando su coste; va directo al descarte
// (igual que cualquier compra), sin trabajador. Como mucho 1 compra de
// mercado por ESPECIE y turno (ver canBuySpecies): puedes comprar varios
// animales distintos en el mismo turno, pero no la misma especie 2 veces.
// No aplica a capturas gratis de efectos.
export function buyAnimal(state: GameState, playerId: string, trackInstanceId: string): void {
  const player = requireActivePlayer(state, playerId);

  const trackIndex = state.animalTrack.findIndex((c) => c.instanceId === trackInstanceId);
  if (trackIndex === -1) throw new Error(`El animal ${trackInstanceId} ya no está disponible en el mercado`);
  const animal = state.animalTrack[trackIndex];
  const habitats = (animal.habitats as string[] | undefined) ?? [];
  const cost = effectiveMarketCost(player, animal);

  if (!canAffordMarket(player, cost, habitats)) {
    throw new Error(`${playerId} no puede pagar ${cost}monedas por ${animal.name}`);
  }
  if (!canBuySpecies(player, animal)) {
    throw new Error(`${playerId} ya ha comprado esa especie este turno`);
  }

  payCoins(player, cost, habitats);
  state.animalTrack.splice(trackIndex, 1);
  player.discard.push(animal);
  if (animal.species) player.boughtSpeciesThisTurn.push(animal.species);
  player.purchasesCount += 1;
  refillAnimalMarket(state, animal.species);
  // payCoins puede dar cambio como bonus (ver comentario ahí): revisa el
  // pico DESPUÉS de pagar, no antes.
  recordRichestTurn(state, player);

  state.log.push(`${player.name} compró ${animal.name} por ${cost}monedas`);
}

// Compra una moneda de mayor valor pagando su coste; va directo al
// descarte. Suministro ilimitado: no hay mazo compartido que agotar.
export function buyCoin(state: GameState, playerId: string, coinId: (typeof PURCHASABLE_COINS)[number]): void {
  const player = requireActivePlayer(state, playerId);

  const coinCard = getCard(coinId);
  if (!canAffordMarket(player, coinCard.marketCost ?? 0)) {
    throw new Error(`${playerId} no puede pagar ${coinCard.marketCost}monedas por ${coinCard.name}`);
  }

  payCoins(player, coinCard.marketCost ?? 0);
  player.discard.push(mintInstance(state, coinCard));
  player.purchasesCount += 1;
  recordRichestTurn(state, player);

  state.log.push(`${player.name} compró ${coinCard.name} por ${coinCard.marketCost}monedas`);
}

export function endTurn(state: GameState, playerId: string): void {
  const player = requireActivePlayer(state, playerId);

  // Lo que quede en la mano sin jugar (monedas incluidas) se descarta, y
  // también lo jugado este turno (playedThisTurn: hasta ahora solo estaba
  // "en el limbo", contando para effectiveHand pero sin ser descarte de
  // verdad todavía — ver playCard). Volverá a circular cuando el mazo se
  // reponga del descarte. Justo después robas YA tu mano siguiente (como el
  // "clean-up" de Dominion), así la llevas contigo durante los turnos de los
  // demás: si no, un rival que juegue Mono/Buitre/Hiena/Pato (miran tu mano)
  // siempre te encontraría con la mano vacía y el efecto nunca haría nada.
  // Excepción — Perro dejado sobre la mesa (keepOnTable): pasa a
  // player.table y ya no vuelve a circular (si algún efecto lo sacó de
  // playedThisTurn durante el turno, p. ej. el Flamenco devolviéndolo, ya no
  // está aquí y simplemente no se mueve).
  const staying = new Set(player.stayingOnTableIds ?? []);
  player.table = [...(player.table ?? []), ...player.playedThisTurn.filter((c) => staying.has(c.instanceId))];
  player.discard.push(...player.hand, ...player.playedThisTurn.filter((c) => !staying.has(c.instanceId)));
  player.hand = [];
  player.playedThisTurn = [];
  player.stayingOnTableIds = [];
  drawCards(player, STARTING_HAND_SIZE);

  const nextIndex = (state.activePlayerIndex + 1) % state.players.length;
  state.turn += 1;
  // El turno vuelve a empezar por el primer jugador (índice 0, siempre
  // quien arranca la partida): esa vuelta completa es una ronda más.
  const startingNewRound = nextIndex === 0;
  if (startingNewRound) state.round += 1;

  // Si se ha elegido una duración (maxRounds), esa es la ÚNICA forma de
  // terminar la partida: el criterio de agotar mazos compartidos queda
  // desactivado (aunque checkFinalRoundTrigger lo siga marcando por si
  // acaso, se ignora aquí abajo). Sin maxRounds, se mantiene el criterio
  // de siempre: termina en cuanto le tocaría jugar de nuevo a quien
  // disparó el agotamiento (todos los demás ya han tenido su turno extra).
  const roundLimitReached = state.maxRounds !== null && startingNewRound && state.round > state.maxRounds;
  const deckDepletionReached =
    state.maxRounds === null &&
    state.finalRoundTriggerPlayerIndex !== null &&
    nextIndex === state.finalRoundTriggerPlayerIndex;
  if (roundLimitReached || deckDepletionReached) {
    state.activePlayerIndex = nextIndex;
    state.gameOver = true;
    state.log.push('Fin de la partida.');
    return;
  }

  state.activePlayerIndex = nextIndex;
  const next = getActivePlayer(state);
  beginPlayerTurn(state, next);
  state.log.push(`Turno de ${next.name}`);
}

// Resuelve UNA carta de una entrega forzosa pendiente (Buitre/Mono/Hiena/
// Murciélago/Tiburón/Halcón/León): el jugador afectado elige, de entre lo
// que le está permitido (owed[playerId].eligibleInstanceIds, o cualquier
// carta si es null), cuál entrega. Según decision.kind, va al propio
// descarte ('discard') o se elimina de la partida para siempre en la
// player.destroyedCards de quien capturó ('destroy'). EXCEPCIÓN — Perezoso:
// en una entrega de tipo
// 'discard', siempre se puede descartar el Perezoso aunque no esté entre las
// elegibles "normales" (p. ej. la Hiena solo deja elegir animales caros), y
// hacerlo cubre TODA la entrega pendiente de un jugador de una sola vez (por
// eso Buitre pide 2 y basta con 1 Perezoso), en vez de contar como 1 carta
// más de las debidas. EXCEPCIÓN — Murciélago: en una entrega de tipo
// 'destroy' (Tiburón/Halcón/León), siempre se puede descartar el Murciélago
// en su lugar aunque no esté entre las elegibles "normales" (nunca es del
// hábitat exigido), cubriendo TODA la entrega de una vez igual que el
// Perezoso — pero el Murciélago va al descarte normal, NO a
// player.destroyedCards: se salvó, no lo capturaron, así que ni cuenta para
// scorePerDestroyedCard del capturador ni le da su bonus de valor de compra
// por este animal. Cuando el último jugador que debía algo termina de
// resolver, se cierra la decisión (y si la disparó el Mono, es aquí cuando
// quien la jugó roba 1 carta por cada moneda que se haya descartado así en
// total — nunca se activa si se cubrió con el Perezoso, que no es moneda).
export function resolveDiscard(state: GameState, playerId: string, instanceId: string): void {
  const decision = state.pendingDecision;
  if (!decision) throw new Error('No hay ninguna entrega pendiente');
  const owed = decision.owed[playerId];
  if (!owed || owed.amount <= 0) throw new Error(`${playerId} no debe entregar nada ahora mismo`);

  const player = state.players.find((p) => p.id === playerId);
  if (!player) throw new Error(`Jugador desconocido: ${playerId}`);
  // La carta a entregar normalmente vive en la mano, pero desde 2026-09-21
  // (eachOpponentDestroysAnimalFromHand también alcanza player.table, ver
  // registry.ts) puede ser un animal mantenido sobre la mesa de turnos
  // anteriores (Gallina/Colibrí vía mayStayOnTable) — se busca primero en la
  // mano y, si no está ahí, en la mesa. Los sustitutos protectores (Perezoso/
  // Murciélago/Gato) siguen buscándose SOLO en la mano vía `idx` más abajo:
  // no tiene sentido "sustituir" entregando algo que ya está en la mesa.
  const idx = player.hand.findIndex((c) => c.instanceId === instanceId);
  const tableIdx = idx === -1 ? player.table.findIndex((c) => c.instanceId === instanceId) : -1;
  if (idx === -1 && tableIdx === -1) throw new Error(`La carta ${instanceId} no está en la mano ni en la mesa de ${playerId}`);

  const isSlothSubstitute = idx !== -1 && decision.kind === 'discard' && player.hand[idx].id === 'sloth';
  const isBatSubstitute = idx !== -1 && decision.kind === 'destroy' && player.hand[idx].id === 'bat';
  // Gato: protege sea cual sea el TIPO de animal exigido (land/bird/
  // aquatic) por la habilidad de "cada oponente elimina un animal de X
  // hábitat" (Tiranosaurio/Pterodáctilo/Mosasaurio, ver requiredHabitats en
  // registry.ts) — pedido explícito del usuario 2026-09-21: antes solo
  // protegía si lo exigido era terrestre (porque el Gato es terrestre y ya
  // estaba entre las elegibles "normales" en ese caso); ahora, igual que el
  // Murciélago, siempre se ofrece como sustituto aunque no encaje con el
  // hábitat exigido (ver decision.requiredHabitats más abajo en
  // getLegalActions). Nunca aplica a otras entregas 'destroy' sin
  // requiredHabitats (Tiburón/Halcón/León): esas no son "tipo de animal
  // eliminado", capturan por otro criterio, ajeno al Gato.
  const isCatSubstitute =
    idx !== -1 && decision.kind === 'destroy' && decision.requiredHabitats !== undefined && player.hand[idx].id === 'cat';
  if (
    !isSlothSubstitute &&
    !isBatSubstitute &&
    !isCatSubstitute &&
    owed.eligibleInstanceIds &&
    !owed.eligibleInstanceIds.includes(instanceId)
  ) {
    throw new Error(`${instanceId} no es una carta elegible para esta entrega`);
  }

  const [card] = idx !== -1 ? player.hand.splice(idx, 1) : player.table.splice(tableIdx, 1);
  const sourcePlayer = state.players.find((p) => p.id === decision.sourcePlayerId);
  if (isBatSubstitute || isCatSubstitute) {
    // Protegido: el Murciélago/Gato se descarta normal, no cuenta como capturado.
    player.discard.push(card);
  } else if (decision.kind === 'destroy') {
    // A la pila de eliminados de quien CAPTURÓ (sourcePlayer), no del rival
    // que la entrega: es él quien luego puntúa por ella con
    // scorePerDestroyedCard, no el rival que se la quedó sin comprarla.
    sourcePlayer?.destroyedCards.push(card);
    decision.returnedSoFar += 1;
  } else if (decision.kind === 'giveToPlayer') {
    sourcePlayer?.hand.push(card);
  } else {
    player.discard.push(card);
    if (decision.bonusDrawPerCoin && card.type === 'coin') decision.coinsDiscardedSoFar += 1;
    // Serpiente: registra qué se acaba de descartar (sea la carta pedida o
    // el Perezoso sustituto) para que luego quien la jugó pueda elegir
    // entre ellas — ver pendingAnimalAbilityChoice más abajo.
    if (decision.collectDiscardedForAbilityChoice) decision.collectedInstanceIds.push(card.instanceId);
  }

  if (isSlothSubstitute || isBatSubstitute) {
    owed.amount = 0;
  } else {
    owed.amount -= 1;
  }
  if (owed.amount <= 0) delete decision.owed[playerId];

  state.log.push(
    isSlothSubstitute
      ? `${player.name} descartó su Perezoso en lugar de entregar lo debido (${decision.sourceCardName})`
      : isBatSubstitute
        ? `${player.name} descartó su Murciélago para protegerse de ${decision.sourceCardName}`
        : isCatSubstitute
          ? `${player.name} descartó su Gato en vez de eliminar un animal (${decision.sourceCardName})`
        : decision.kind === 'destroy'
          ? `${player.name} perdió ${card.name} para siempre, capturado por ${sourcePlayer?.name ?? '?'} (${decision.sourceCardName})`
          : decision.kind === 'giveToPlayer'
            ? `${player.name} le dio ${card.name} a ${sourcePlayer?.name ?? '?'} (${decision.sourceCardName})`
            : `${player.name} descartó ${card.name} (${decision.sourceCardName})`
  );

  if (Object.keys(decision.owed).length === 0) {
    if (decision.bonusDrawPerCoin && decision.coinsDiscardedSoFar > 0) {
      const sourcePlayer = state.players.find((p) => p.id === decision.sourcePlayerId);
      if (sourcePlayer) {
        drawCards(sourcePlayer, decision.coinsDiscardedSoFar);
        state.log.push(`${sourcePlayer.name} robó ${decision.coinsDiscardedSoFar} carta(s) por monedas descartadas así`);
      }
    }
    if (decision.bonusPurchasingPowerPerAnimal && decision.returnedSoFar > 0) {
      const sourcePlayer = state.players.find((p) => p.id === decision.sourcePlayerId);
      if (sourcePlayer) {
        const amount = decision.bonusPurchasingPowerPerAnimal * decision.returnedSoFar;
        sourcePlayer.bonusPurchasingPowerThisTurn += amount;
        state.log.push(
          `${sourcePlayer.name} ganó ${amount} de valor de compra por capturar ${decision.returnedSoFar} animales con ${decision.sourceCardName}`
        );
      }
    }
    // Serpiente: si se descartó al menos un animal entre todos, ahora le
    // toca a quien la jugó elegir cuál usar — ver useDiscardedAnimalAbility.
    // Si nadie tenía ningún animal que entregar, collectedInstanceIds sigue
    // vacío y no hay nada que elegir: la Serpiente simplemente no hace nada
    // más esta vez.
    if (decision.collectDiscardedForAbilityChoice && decision.collectedInstanceIds.length > 0) {
      state.pendingAnimalAbilityChoice = {
        sourcePlayerId: decision.sourcePlayerId,
        sourceCardName: decision.sourceCardName,
        candidateInstanceIds: [...decision.collectedInstanceIds],
      };
    }
    state.pendingDecision = null;
  }
}

// Busca una carta en el descarte de CUALQUIER jugador (los candidatos de
// pendingAnimalAbilityChoice pueden estar en el descarte de otro jugador
// distinto de quien va a usar su habilidad — la carta nunca cambia de
// dueño). Usado tanto por getLegalActions (para calcular qué objetivos
// tiene esa habilidad concreta) como por useDiscardedAnimalAbility (para
// aplicarla de verdad).
function findInAnyDiscard(state: GameState, instanceId: string): CardInstance | undefined {
  for (const p of state.players) {
    const card = p.discard.find((c) => c.instanceId === instanceId);
    if (card) return card;
  }
  return undefined;
}

// Serpiente: resuelve la elección de pendingAnimalAbilityChoice (ver
// model/state.ts) — activa la habilidad onPlay de la carta elegida (que
// sigue en el descarte de quien la entregó, nunca cambia de dueño) a favor
// de quien jugó la Serpiente, exactamente igual que si la hubiera jugado él
// mismo (mismo resolveEffect que usa playCard, incluidos los objetivos
// target(Instance|Player)Id/secondaryTargetInstanceId que haga falta elegir
// — ver effectTargetSpecsForCard: antes esto llamaba a resolveEffect SIN
// ningún objetivo, así que un Elefante/Araña/Flamenco/Tigre/Jirafa/
// Murciélago prestado por la Serpiente no hacía nada en absoluto). Si esa
// habilidad deja a su vez un descarte forzoso pendiente (p. ej. si la carta
// elegida fuera un Buitre), se encadena con normalidad:
// autoResolveForcedDiscards ya se llama al final, igual que en playCard.
export function useDiscardedAnimalAbility(
  state: GameState,
  playerId: string,
  instanceId: string,
  targetInstanceId?: string,
  secondaryTargetInstanceId?: string,
  targetPlayerId?: string
): void {
  const choice = state.pendingAnimalAbilityChoice;
  if (!choice) throw new Error('No hay ninguna habilidad de animal descartado pendiente de elegir');
  if (choice.sourcePlayerId !== playerId) throw new Error(`${playerId} no puede elegir esta habilidad ahora`);
  if (!choice.candidateInstanceIds.includes(instanceId)) throw new Error(`${instanceId} no es una carta elegible`);

  const player = state.players.find((p) => p.id === playerId);
  if (!player) throw new Error(`Jugador desconocido: ${playerId}`);
  const card = findInAnyDiscard(state, instanceId);
  if (!card) throw new Error(`No se encuentra la carta ${instanceId} en ningún descarte`);

  state.pendingAnimalAbilityChoice = null;
  for (const effect of card.effects.filter((e) => e.trigger === 'onPlay')) {
    resolveEffect(state, player, effect, {
      targetInstanceId,
      secondaryTargetInstanceId,
      targetPlayerId,
      sourceCardName: card.name,
      sourceInstanceId: card.instanceId,
    });
  }
  autoResolveForcedDiscards(state);
  recordRichestTurn(state, player);

  state.log.push(`${player.name} usó la habilidad de ${card.name} gracias a la Serpiente`);
}

// Se llama justo después de resolver los efectos onPlay de una carta (ver
// playCard): si alguno dejó pendiente una devolución al mercado ('discard'
// tipo returnToMarket, Tiburón) resuelve automáticamente a cualquier
// afectado que en realidad no tenga ninguna elección que hacer — le caben
// exactamente tantas elegibles (owed.eligibleInstanceIds, o toda su mano si
// es null) como debe devolver, así que el resultado es el mismo elija lo que
// elija. Las entregas de tipo 'discard' (Buitre/Mono/Hiena) NUNCA se
// auto-resuelven, ni siquiera sin elección real entre las cartas
// "normales": desde que el Perezoso puede sustituir cualquier descarte
// entero por sí solo, SIEMPRE hay una elección real que hacer (¿sacrifico el
// Perezoso o las cartas pedidas?), así que el jugador afectado siempre debe
// decidir explícitamente. Mismo razonamiento para 'destroy'
// (Tiburón/Halcón/León) cuando el afectado tiene un Murciélago en mano:
// puede sacrificarlo para protegerse, así que tampoco se auto-resuelve para
// ÉL (otros afectados sin Murciélago sí se auto-resuelven con normalidad).
function autoResolveForcedDiscards(state: GameState): void {
  if (!state.pendingDecision || state.pendingDecision.kind === 'discard') return;
  for (const playerId of Object.keys(state.pendingDecision.owed)) {
    // Se recalcula en cada vuelta: resolveDiscard puede vaciar `owed` (y
    // hasta poner pendingDecision a null) según va resolviendo.
    while (state.pendingDecision?.owed[playerId]) {
      const owed = state.pendingDecision.owed[playerId];
      const player = state.players.find((p) => p.id === playerId);
      if (state.pendingDecision.kind === 'destroy' && player?.hand.some((c) => c.id === 'bat')) break;
      // Gato: mismo motivo que el Murciélago justo arriba — si puede
      // protegerse sacrificándolo, eso es una elección real que hacer, no
      // se auto-resuelve por él. Solo hace falta este chequeo aparte cuando
      // el Gato NO es ya una de las elegibles "normales" (destroy de
      // volador/acuático: el Gato es terrestre) — si ya lo es (destroy de
      // terrestre), el chequeo de "eligible.length > owed.amount" de más
      // abajo ya cubre el caso (y si el Gato es la única elegible, auto-
      // resolverlo A ÉL directamente sigue siendo protegerse, no hace falta
      // pausar). Solo aplica al 'destroy' con requiredHabitats (ver
      // isCatSubstitute en resolveDiscard).
      if (
        state.pendingDecision.kind === 'destroy' &&
        state.pendingDecision.requiredHabitats !== undefined &&
        player?.hand.some((c) => c.id === 'cat' && !(owed.eligibleInstanceIds ?? []).includes(c.instanceId))
      )
        break;
      const eligible = owed.eligibleInstanceIds ?? player?.hand.map((c) => c.instanceId) ?? [];
      if (eligible.length > owed.amount) break; // hay elección real: se deja pendiente
      const instanceId = eligible[0];
      if (instanceId === undefined) break;
      resolveDiscard(state, playerId, instanceId);
    }
  }
}

// Resuelve UN paso de la decisión pendiente actual (si hay alguna) con la
// heurística por defecto (ver pickDefaultDiscard), en nombre de cualquiera
// de los jugadores que todavía deban algo. Pensado para quien conduzca una
// partida sin UI real detrás de cada asiento afectado (bots en
// self-play/tests; la web, en cambio, deja elegir de verdad a los humanos y
// solo usa esto para los asientos de bot, ver useGame.ts). Devuelve false
// si no había ninguna decisión pendiente (nada que hacer).
export function autoResolvePendingDiscard(state: GameState): boolean {
  if (!state.pendingDecision) return false;
  const owedId = Object.keys(state.pendingDecision.owed)[0];
  if (!owedId) {
    // No debería pasar (beginPendingDiscard no deja `owed` vacío al crear la
    // decisión), pero por si acaso no se deja un estado inconsistente colgado.
    state.pendingDecision = null;
    return true;
  }
  const player = state.players.find((p) => p.id === owedId);
  const owed = state.pendingDecision.owed[owedId];
  // Gato: si la entrega exige un tipo concreto de animal (sea cual sea) y
  // tiene un Gato a mano, siempre es la mejor entrega (va al descarte, no se
  // pierde nada) — ver isCatSubstitute en resolveDiscard.
  const protectingCat =
    state.pendingDecision.kind === 'destroy' && state.pendingDecision.requiredHabitats !== undefined
      ? player?.hand.find((c) => c.id === 'cat')
      : undefined;
  const instanceId = protectingCat
    ? protectingCat.instanceId
    : player
    ? pickDefaultDiscard(
        // eligibleInstanceIds puede incluir cartas de player.table (ver
        // eachOpponentDestroysAnimalFromHand en registry.ts), no solo mano.
        [...player.hand, ...player.table],
        owed.eligibleInstanceIds,
        state.pendingDecision.kind === 'discard',
        state.pendingDecision.bonusDrawPerCoin
      )
    : null;
  if (!instanceId) {
    delete state.pendingDecision.owed[owedId];
    if (Object.keys(state.pendingDecision.owed).length === 0) state.pendingDecision = null;
    return true;
  }
  resolveDiscard(state, owedId, instanceId);
  return true;
}

export function applyAction(state: GameState, playerId: string, action: Action): void {
  switch (action.type) {
    case 'playCard':
      playCard(
        state,
        playerId,
        action.instanceId,
        action.targetInstanceId,
        action.secondaryTargetInstanceId,
        action.targetPlayerId,
        action.keepOnTable
      );
      return;
    case 'buyAnimal':
      buyAnimal(state, playerId, action.trackInstanceId);
      return;
    case 'buyCoin':
      buyCoin(state, playerId, action.coinId);
      return;
    case 'endTurn':
      endTurn(state, playerId);
      return;
    case 'resolveDiscard':
      resolveDiscard(state, playerId, action.instanceId);
      return;
    case 'useDiscardedAnimalAbility':
      useDiscardedAnimalAbility(
        state,
        playerId,
        action.instanceId,
        action.targetInstanceId,
        action.secondaryTargetInstanceId,
        action.targetPlayerId
      );
      return;
  }
}
