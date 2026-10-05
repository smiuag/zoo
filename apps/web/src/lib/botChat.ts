import type { CardInstance } from '@zoo/engine';

// Emotes automáticos de los bots en el chat online (2026-10-01, pedido
// explícito del usuario) — SOLO en partidas online: en pase-y-juega local no
// existe ningún panel de chat donde mostrarlos (ver RoomChat.tsx). Un bot
// "reacciona" solas en 3 situaciones, reutilizando las mismas reacciones
// rápidas que ya puede mandar un humano (RoomChat.tsx REACTIONS), nunca un
// emoji nuevo que el jugador no pudiera usar él mismo:
//   1) Juega una carta "agresiva" (cada rival pierde/descarta/devuelve algo)
//      — Buitre, Hiena, Serpiente y cualquier carta con el mismo patrón.
//   2) Es víctima de una de esas cartas (le toca descartar/perder algo).
//   3) Hace una compra grande (coste >= BIG_PURCHASE_COST).
// Entre el agresor y la víctima de un mismo evento solo reacciona UNO,
// elegido al azar entre los candidatos que sean bots (pedido explícito del
// usuario: "uno de ellos al azar") — nunca los dos a la vez por el mismo
// evento, y nunca en nombre de un humano.

// Por FAMILIA de efecto (no por carta suelta): cubre Buitre
// (chooseDiscardFromEachOpponent), Hiena (discardAnimalFromEachOpponent),
// Serpiente (discardAnimalFromEachPlayerThenUseAbility) y, con el mismo
// patrón de "cada rival pierde algo", discardFromEachOpponent,
// returnAnimalFromEachOpponent y eachOpponentDestroysAnimalFromHand
// (Tiranosaurio/Mosasaurio/Pteranodon) — así una carta nueva con el mismo
// tipo de efecto queda cubierta sola, sin acordarse de añadirla aquí a mano.
export const AGGRESSIVE_EFFECT_TYPES = new Set([
  'discardFromEachOpponent',
  'discardAnimalFromEachPlayerThenUseAbility',
  'chooseDiscardFromEachOpponent',
  'discardAnimalFromEachOpponent',
  'returnAnimalFromEachOpponent',
  'eachOpponentDestroysAnimalFromHand',
]);

export function isAggressiveCard(card: CardInstance): boolean {
  return card.effects.some((e) => e.trigger === 'onPlay' && AGGRESSIVE_EFFECT_TYPES.has(e.type));
}

// A partir de qué coste de compra se considera "una compra grande" (pedido
// explícito del usuario: "si juntan muchas monedas para comprar"). 9 deja
// fuera a la práctica totalidad de la clásica (lo más caro ronda 7-8) y solo
// se enciende con animales realmente caros (dinosaurios grandes de la
// completa, Plesiosaurio...).
export const BIG_PURCHASE_COST = 9;

// Como mucho 1 reacción automática por bot cada COOLDOWN_ROUNDS rondas
// (pedido explícito del usuario, para que no se sature el chat con varios
// bots en la mesa) — independiente de cuántos motivos distintos se le
// disparen mientras tanto.
export const COOLDOWN_ROUNDS = 2;

export type BotEmoteRole = 'attacker' | 'victim' | 'bigBuy';

export interface BotEmoteEvent {
  id: number;
  seatId: string;
  name: string;
  reaction: string;
}

const VICTIM_REACTIONS = ['😡', '😢'];
const ATTACKER_REACTION = '¡Uy!';
const BIG_BUY_REACTIONS = ['🎉', '¡Buena!'];

export function reactionFor(role: BotEmoteRole): string {
  if (role === 'attacker') return ATTACKER_REACTION;
  if (role === 'victim') return VICTIM_REACTIONS[Math.floor(Math.random() * VICTIM_REACTIONS.length)];
  return BIG_BUY_REACTIONS[Math.floor(Math.random() * BIG_BUY_REACTIONS.length)];
}
