import { useEffect, useState } from 'react';
import { GameBoard } from './GameBoard';
import { useGuestRoom } from '../online/useGuestRoom';

interface GuestAppProps {
  roomCode: string;
  seatId: string;
  seatKey: string;
}

// Tras esto sin recibir el primer estado, se avisa de que se sigue
// reintentando en vez de dejar "Conectando..." fijo para siempre (ver el
// retry en useGuestRoom): antes, cualquier fallo en la primera petición de
// estado dejaba al invitado colgado ahí sin ninguna pista de que algo
// seguía intentándolo por su cuenta.
const SLOW_CONNECT_HINT_MS = 6000;

export function GuestApp({ roomCode, seatId, seatKey }: GuestAppProps) {
  const { status, state, humanIds, botAlgorithms, scores, legalActions, animationsEnabled, sendAction } = useGuestRoom(
    roomCode,
    seatId,
    seatKey
  );
  const [slowConnect, setSlowConnect] = useState(false);

  useEffect(() => {
    if (status === 'playing') {
      setSlowConnect(false);
      return;
    }
    const id = window.setTimeout(() => setSlowConnect(true), SLOW_CONNECT_HINT_MS);
    return () => window.clearTimeout(id);
  }, [status]);

  if (status !== 'playing' || !state) {
    return (
      <div className="app app--setup">
        <div className="panel setup-panel">
          <div className="panel__header">
            <h2>Sala {roomCode}</h2>
          </div>
          <p className="setup-hint">
            {status === 'connecting' && 'Conectando...'}
            {status === 'waitingForHost' && 'Conectado. Esperando a que el anfitrión empiece la partida...'}
          </p>
          {slowConnect && (
            <p className="setup-hint">
              Está tardando más de lo normal — seguimos intentándolo solos. Si el anfitrión también refrescó su
              pantalla, dile que pulse "Reanudar partida online" en la suya.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <GameBoard
      state={state}
      humanIds={humanIds}
      viewerPlayerId={seatId}
      legalActions={legalActions}
      scores={scores}
      botAlgorithms={botAlgorithms}
      animationsEnabled={animationsEnabled}
      canRestartTurn={false}
      doAction={sendAction}
    />
  );
}
