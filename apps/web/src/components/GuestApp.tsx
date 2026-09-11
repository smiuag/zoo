import { GameBoard } from './GameBoard';
import { useGuestRoom } from '../online/useGuestRoom';

interface GuestAppProps {
  roomCode: string;
  seatId: string;
  seatKey: string;
}

export function GuestApp({ roomCode, seatId, seatKey }: GuestAppProps) {
  const { status, state, humanIds, botAlgorithms, scores, legalActions, myTurn, sendAction } = useGuestRoom(
    roomCode,
    seatId,
    seatKey
  );

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
        </div>
      </div>
    );
  }

  return (
    <GameBoard
      state={state}
      humanIds={humanIds}
      viewerPlayerId={seatId}
      isMyTurn={myTurn}
      legalActions={legalActions}
      scores={scores}
      botAlgorithms={botAlgorithms}
      canRestartTurn={false}
      doAction={sendAction}
    />
  );
}
