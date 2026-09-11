import type { Action, GameState, PlayerScore } from '@zoo/engine';
import type { BotAlgorithm } from '../lib/gameConfig';

// Código corto de sala: solo sirve para AGRUPAR los canales de una partida,
// nunca es secreto por sí mismo (a diferencia de `seatKey`, ver más abajo) —
// se puede decir en voz alta o escribir a mano sin problema.
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin O/0/I/1, para evitar confusiones al leerlo
export function randomRoomCode(length = 6): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

// Secreto largo por asiento: va incrustado en el enlace de invitación de ESE
// asiento y en el nombre de su canal privado (ver seatChannelName). Nunca se
// transmite por ningún canal compartido con otros asientos: es la única
// "credencial" que demuestra que un cliente es dueño de ese hueco, sin
// necesidad de cuentas ni login.
export function randomSeatKey(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

export function lobbyChannelName(roomCode: string): string {
  return `room:${roomCode}:lobby`;
}

export function actionsChannelName(roomCode: string): string {
  return `room:${roomCode}:actions`;
}

export function seatChannelName(roomCode: string, seatKey: string): string {
  return `room:${roomCode}:seat:${seatKey}`;
}

// Mensaje enviado por un invitado en el canal de acciones (compartido, no
// secreto) para pedir que el host aplique una jugada en su nombre. El host
// descarta cualquier mensaje cuyo `seatKey` no coincida con el secreto real
// de `seatId` (ver useHostRoom): eso es lo que impide que alguien suplante
// un asiento sin conocer su enlace de invitación.
export interface ActionMessage {
  type: 'action';
  seatId: string;
  seatKey: string;
  action: Action;
}

// Mensaje retransmitido por el host, en el canal PRIVADO de un asiento
// (room:CODE:seat:SEATKEY), tras cada acción aplicada (propia, de otro
// invitado o de un bot). `state` ya viene redactado para ese asiento
// concreto (ver redact.ts) — nunca contiene las manos/mazos reales de otros
// humanos mientras la partida está en curso. `scores` viaja aparte, ya
// calculado por el host con el estado real, porque el marcador siempre ha
// sido información pública (ver scoreGame) aunque las cartas no lo sean.
export interface StateSyncMessage {
  type: 'stateSync';
  state: GameState;
  humanIds: string[];
  botAlgorithms: Record<string, BotAlgorithm>;
  scores: PlayerScore[];
  // Decidido por el host al crear la sala (ver GameConfig): se aplica igual
  // para todos los que se unan, así que viaja aquí en vez de dejar que cada
  // invitado lo decida por su cuenta.
  animationsEnabled: boolean;
}

// Mensaje de un invitado recién conectado (o que acaba de refrescar la
// página) pidiendo al host que le reenvíe el último estado, en vez de
// esperar en blanco hasta la próxima jugada de alguien.
export interface RequestStateMessage {
  type: 'requestState';
  seatId: string;
  seatKey: string;
}

export type ActionsChannelMessage = ActionMessage | RequestStateMessage;
