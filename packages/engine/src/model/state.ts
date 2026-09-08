import type { Card } from '../cards/schema';

export interface CardInstance extends Card {
  instanceId: string;
}

export interface Player {
  id: string;
  name: string;
  deck: CardInstance[];
  hand: CardInstance[];
  discard: CardInstance[];
  // Moneda extra de compra dada por algún efecto jugado este turno (p. ej.
  // Serpiente / Loro / León): NO es una carta, no se añade al mazo ni se
  // puede robar; solo aumenta lo que puedes gastar hasta que termine el
  // turno. Se puede usar para pagar CUALQUIER compra (animal de cualquier
  // hábitat, o moneda).
  bonusPurchasingPowerThisTurn: number;
  // Igual que bonusPurchasingPowerThisTurn (Delfín), pero restringida:
  // solo sirve para pagar animales ACUÁTICOS, nunca monedas ni animales de
  // otro hábitat. Se gasta primero que la genérica cuando aplica (ver
  // payCoins en engine.ts), porque no sirve para nada más.
  aquaticBonusPurchasingPowerThisTurn: number;
  // Especies de las que ya se ha comprado un animal del mercado ESTE TURNO
  // (buyAnimal, no efectos de captura gratis): como mucho 1 compra por
  // especie y turno (no puedes comprar 2 copias del mismo animal seguidas,
  // pero sí animales distintos aunque compartan hábitat).
  boughtSpeciesThisTurn: string[];
  // Cartas jugadas ESTE TURNO (ya en el descarte, playCard las saca de
  // `hand` antes de resolver su efecto): para los efectos que cuentan
  // animales "en tu mano" (Serpiente/Loro/Foca), siguen contando como si
  // siguieran en la mano hasta que termine el turno — así una carta se
  // cuenta a sí misma, y también cuentan las que ya hayas jugado antes este
  // mismo turno. Ver effectiveHand().
  playedThisTurn: CardInstance[];
  // Nº total de compras hechas en TODA la partida (buyAnimal + buyCoin).
  // No cuenta capturas gratis de efectos (Elefante/Araña/Flamenco): esas no
  // pasan por buyAnimal/buyCoin. Solo para el resumen final de la partida.
  purchasesCount: number;
  // En qué ronda tuvo más monedas en mano al EMPEZAR su turno (antes de
  // jugar nada): se actualiza en beginPlayerTurn, leyendo la mano recién
  // robada al final de su turno anterior. Solo cuenta monedas de verdad
  // (cartas tipo 'coin'), no el valor de compra extra de algún efecto (que
  // se resetea a 0 en ese mismo instante y no refleja dinero "guardado").
  // null hasta el primer beginPlayerTurn. Solo para el resumen final.
  richestTurn: { round: number; coins: number } | null;
}

export interface GameState {
  players: Player[];
  activePlayerIndex: number;
  turn: number;
  // Número de ronda actual (empieza en 1): una ronda es 1 turno de CADA
  // jugador. Se incrementa cada vez que el turno vuelve a empezar por el
  // primer jugador (índice 0, que siempre empieza la partida). Distinto de
  // `turn`, que cuenta turnos individuales (1 por jugador y ronda).
  round: number;
  // Duración elegida de la partida en rondas (15/30/50), o null para usar
  // solo el criterio de siempre (agotar mazos compartidos, ver
  // finalRoundTriggerPlayerIndex). Si se fija, la partida termina al
  // completarse esta ronda aunque los mazos no se hayan agotado — ver
  // endTurn en engine.ts.
  maxRounds: number | null;
  log: string[];
  // Contador global para generar instanceId únicos al acuñar cartas nuevas
  // (mazo inicial, capturas, monedas ganadas, etc.).
  nextInstanceId: number;
  // Un mazo compartido (boca abajo) por cada especie de animal, del que se
  // repone el mercado de animales. Clave: el id de especie (p. ej. "lion").
  sharedDecks: Record<string, CardInstance[]>;
  // Mercado de animales boca arriba: siempre intenta tener 1 hueco por
  // especie (macho o hembra al azar), repuesto en cuanto se captura uno.
  animalTrack: CardInstance[];
  // true en cuanto se agotan 5 de los mazos compartidos por primera vez
  // (dispara la ronda final). No null mientras esa ronda final está en
  // curso: índice del jugador que la disparó, para saber cuándo completar
  // la vuelta y terminar la partida.
  finalRoundTriggerPlayerIndex: number | null;
  // true una vez terminada la ronda final tras agotarse 5 mazos
  // compartidos. Ninguna acción es válida después de esto.
  gameOver: boolean;
  // true en cuanto se ha resuelto YA UNA VEZ la fase destructiva de
  // puntuación (el Cocodrilo) tras terminar la partida. Necesario porque
  // scoreGame() se llama en cada render de la web (para el marcador en
  // vivo), así que sin este cerrojo, cada render posterior al fin de la
  // partida volvería a encontrar el Cocodrilo "todavía en la colección" y
  // repetiría su sacrificio una y otra vez, devorando toda la colección
  // acuática en vez de sacrificar solo un animal una única vez. Ver
  // scoring.ts.
  scoringFinalized: boolean;
}

// Acuña una nueva instancia de carta con un instanceId único dentro de la
// partida. Vive aquí (no en engine.ts) para que tanto el motor como los
// handlers de efectos puedan usarla sin crear una dependencia circular.
export function mintInstance(state: GameState, card: Card): CardInstance {
  const instanceId = `${card.id}#${state.nextInstanceId}`;
  state.nextInstanceId += 1;
  return { ...card, instanceId };
}

export function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// El "final" del mazo (índice más alto) es la cima: robar hace pop(),
// guardar/devolver una carta encima del mazo hace push().
export function drawCards(player: Player, count: number): void {
  for (let i = 0; i < count; i++) {
    if (player.deck.length === 0) {
      if (player.discard.length === 0) return;
      player.deck = shuffle(player.discard);
      player.discard = [];
    }
    const card = player.deck.pop();
    if (card) player.hand.push(card);
  }
}

// "Mano efectiva" para cualquier efecto que cuente animales "en tu mano":
// incluye la mano real MÁS lo ya jugado este turno (ver playedThisTurn), no
// solo `player.hand`. Úsalo en vez de leer `player.hand` directamente en
// cualquier efecto de este tipo, presente o futuro.
export function effectiveHand(player: Player): CardInstance[] {
  return [...player.hand, ...player.playedThisTurn];
}

// Quita y devuelve una carta cualquiera de la mano del jugador, elegida al
// azar. Usado por efectos que afectan a las manos de otros jugadores sin
// que el motor tenga que pedirles una elección interactiva (p. ej. el mono
// o la araña).
export function takeRandomFromHand(player: Player): CardInstance | undefined {
  if (player.hand.length === 0) return undefined;
  const index = Math.floor(Math.random() * player.hand.length);
  return player.hand.splice(index, 1)[0];
}
