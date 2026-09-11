import { randomRoomCode, randomSeatKey } from './protocol';
import type { HostRoomSeat } from './useHostRoom';

export interface CreatedRoom {
  roomCode: string;
  seats: HostRoomSeat[];
}

// El host es siempre el asiento human-0 (mismo convenio que newGame() en
// useGame.ts) y nunca necesita un enlace: ya está jugando en este mismo
// dispositivo. Se genera un enlace independiente para cada hueco humano
// adicional (human-1, human-2...), cada uno con su propio secreto: ver el
// diseño de canales en el plan (la privacidad de las manos depende de que
// ese secreto nunca viaje por un canal compartido).
export function createHostRoom(numHumans: number): CreatedRoom {
  const roomCode = randomRoomCode();
  const seats: HostRoomSeat[] = [];
  for (let i = 1; i < numHumans; i++) {
    const seatId = `human-${i}`;
    const seatKey = randomSeatKey();
    const url = new URL(window.location.href);
    url.search = `?room=${roomCode}&seat=${seatId}&key=${seatKey}`;
    url.hash = '';
    seats.push({ seatId, seatKey, inviteUrl: url.toString() });
  }
  return { roomCode, seats };
}
