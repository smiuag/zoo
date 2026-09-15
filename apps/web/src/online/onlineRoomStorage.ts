import type { GameState } from '@zoo/engine';
import type { BotAlgorithm } from '../lib/gameConfig';
import type { HostRoomSeat } from './useHostRoom';

// Guarda lo mínimo que el HOST necesita para reanudar su propia sala online
// tras un refresco accidental (pedido explícito del usuario: "si refrescaba
// el navegador... se desconectaba de la partida y ya no podíamos seguir").
// Sin esto, todo el estado de la partida online vivía solo en la memoria de
// React de la pestaña del host — un refresco lo borraba del todo y los
// enlaces de invitación ya repartidos apuntaban a una sala muerta (nuevo
// roomCode/seatKeys en cuanto se creaba otra sala). Esto NO es una solución
// para "el host pierde el dispositivo/pestaña del todo" (para eso haría
// falta guardar el estado en Supabase, no solo en localStorage) — solo para
// el caso real reportado, refrescar por accidente en el mismo navegador.
export interface SavedOnlineRoom {
  roomCode: string;
  seats: HostRoomSeat[];
  state: GameState;
  humanIds: string[];
  botAlgorithms: Record<string, BotAlgorithm>;
  animationsEnabled: boolean;
}

const STORAGE_KEY = 'zoo.onlineRoom';

export function saveOnlineRoom(room: SavedOnlineRoom): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(room));
  } catch {
    // Sin almacenamiento (modo privado, cuota llena...): la partida sigue
    // jugándose con normalidad en esta pestaña, solo no habrá nada que
    // reanudar si se refresca.
  }
}

export function loadOnlineRoom(): SavedOnlineRoom | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedOnlineRoom> | null;
    if (
      !parsed ||
      typeof parsed.roomCode !== 'string' ||
      !parsed.state ||
      !Array.isArray(parsed.seats) ||
      !Array.isArray(parsed.humanIds) ||
      !parsed.botAlgorithms
    ) {
      return null;
    }
    return parsed as SavedOnlineRoom;
  } catch {
    return null;
  }
}

export function clearOnlineRoom(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ver saveOnlineRoom
  }
}
