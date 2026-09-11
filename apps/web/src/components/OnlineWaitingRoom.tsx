import { useState } from 'react';
import type { HostRoomSeat } from '../online/useHostRoom';

interface OnlineWaitingRoomProps {
  roomCode: string;
  seats: HostRoomSeat[];
  connectedSeatIds: Set<string>;
  onStart: () => void;
  onCancel: () => void;
}

function seatLabel(seatId: string): string {
  const n = Number(seatId.split('-')[1]) + 1;
  return `Jugador ${n}`;
}

export function OnlineWaitingRoom({ roomCode, seats, connectedSeatIds, onStart, onCancel }: OnlineWaitingRoomProps) {
  const [copied, setCopied] = useState<string | null>(null);

  async function copyLink(seatId: string, url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(seatId);
      setTimeout(() => setCopied((c) => (c === seatId ? null : c)), 1500);
    } catch {
      // Sin permiso de portapapeles (poco habitual): el enlace sigue
      // visible en pantalla para copiarlo a mano.
    }
  }

  return (
    <div className="app app--setup">
      <div className="panel setup-panel">
        <div className="panel__header">
          <h2>Sala {roomCode}</h2>
          <button className="btn btn--ghost" onClick={onCancel}>
            ✕ cancelar
          </button>
        </div>

        <p className="setup-hint">
          Manda cada enlace a una persona distinta por el chat que prefieras. Al abrirlo, esa persona ya está en la
          partida como ese jugador — no hace falta que se registre en nada.
        </p>

        <div className="setup-bot-list">
          {seats.map((seat) => (
            <div key={seat.seatId} className="setup-row setup-row--bot">
              <label>
                {seatLabel(seat.seatId)} {connectedSeatIds.has(seat.seatId) ? '🟢 conectado' : '⏳ esperando'}
              </label>
              <button className="btn btn--ghost" type="button" onClick={() => copyLink(seat.seatId, seat.inviteUrl)}>
                {copied === seat.seatId ? '✓ copiado' : '📋 copiar enlace'}
              </button>
            </div>
          ))}
        </div>

        <button className="btn btn--primary" onClick={onStart}>
          Empezar partida
        </button>
      </div>
    </div>
  );
}
