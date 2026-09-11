import { useRef, useState } from 'react';
import { getActivePlayer } from '@zoo/engine';
import { GameBoard } from './components/GameBoard';
import { GameSetup } from './components/GameSetup';
import { GuestApp } from './components/GuestApp';
import { OnlineWaitingRoom } from './components/OnlineWaitingRoom';
import { createHostRoom, type CreatedRoom } from './online/createHostRoom';
import { useHostRoom } from './online/useHostRoom';
import { useGame, type GameConfig } from './state/useGame';

function useGuestRouteParams(): { roomCode: string; seatId: string; seatKey: string } | null {
  const params = new URLSearchParams(window.location.search);
  const roomCode = params.get('room');
  const seatId = params.get('seat');
  const seatKey = params.get('key');
  if (!roomCode || !seatId || !seatKey) return null;
  return { roomCode, seatId, seatKey };
}

export default function App() {
  const guestParams = useGuestRouteParams();
  if (guestParams) {
    return <GuestApp roomCode={guestParams.roomCode} seatId={guestParams.seatId} seatKey={guestParams.seatKey} />;
  }
  return <HostOrLocalApp />;
}

function HostOrLocalApp() {
  const {
    phase,
    state,
    humanIds,
    humanTurn,
    legalActions,
    scores,
    canRestartTurn,
    botAlgorithms,
    tick,
    startGame,
    doAction,
    restart,
    restartTurn,
    setBotAlgorithm,
  } = useGame();

  // No nulo en cuanto se pulsa "Crear partida online" en el formulario (aún
  // en phase 'setup': primero se decide la sala, y solo al pulsar "Empezar
  // partida" en la sala de espera se llama a startGame de verdad). Se
  // mantiene también mientras phase === 'playing': es lo que decide que esta
  // pestaña es el host y debe retransmitir el estado a los invitados.
  const [onlineRoom, setOnlineRoom] = useState<(CreatedRoom & { config: GameConfig }) | null>(null);

  const activePlayer = getActivePlayer(state);
  // Mientras juegan los bots, se sigue mostrando el último humano activo
  // (pase-y-juega local): nada interactivo depende de esto, solo evita que
  // el panel "desaparezca" entre turno humano y turno de bots. En modo
  // online el host es siempre human-0, así que esto nunca cambia el valor
  // devuelto ahí.
  const lastHumanIdRef = useRef<string>(humanIds[0]);
  if (humanTurn) lastHumanIdRef.current = activePlayer.id;

  const isOnlineHost = onlineRoom !== null;
  const viewerPlayerId = isOnlineHost ? 'human-0' : lastHumanIdRef.current;
  const isMyTurn = isOnlineHost ? humanTurn && activePlayer.id === 'human-0' : humanTurn;

  const { connectedSeatIds } = useHostRoom({
    roomCode: onlineRoom?.roomCode ?? '',
    seats: onlineRoom?.seats ?? [],
    state,
    humanIds,
    botAlgorithms,
    scores,
    doAction,
    tick,
    active: isOnlineHost && phase === 'playing',
  });

  function handleCreateOnlineRoom(config: GameConfig) {
    const room = createHostRoom(config.numHumans);
    setOnlineRoom({ ...room, config });
  }

  function handleStartOnlineGame() {
    if (!onlineRoom) return;
    startGame(onlineRoom.config);
  }

  function handleCancelOnlineRoom() {
    setOnlineRoom(null);
  }

  function handleRestart() {
    setOnlineRoom(null);
    restart();
  }

  if (phase === 'setup') {
    if (onlineRoom) {
      return (
        <OnlineWaitingRoom
          roomCode={onlineRoom.roomCode}
          seats={onlineRoom.seats}
          connectedSeatIds={connectedSeatIds}
          onStart={handleStartOnlineGame}
          onCancel={handleCancelOnlineRoom}
        />
      );
    }
    return <GameSetup onStart={startGame} onCreateOnlineRoom={handleCreateOnlineRoom} />;
  }

  return (
    <>
      {isOnlineHost && (
        <div className="panel">
          <span className="chip">🌐 Sala {onlineRoom.roomCode}</span>
        </div>
      )}
      <GameBoard
        state={state}
        humanIds={humanIds}
        viewerPlayerId={viewerPlayerId}
        isMyTurn={isMyTurn}
        legalActions={legalActions}
        scores={scores}
        botAlgorithms={botAlgorithms}
        canRestartTurn={canRestartTurn}
        doAction={doAction}
        onNewGame={handleRestart}
        // "Reiniciar turno" se desactiva online: la foto que usa (ver
        // turnSnapshotRef en useGame) se toma en CUALQUIER turno humano, no
        // solo en el del host, así que sin esto el host podría deshacer a
        // ciegas el turno en curso de un invitado.
        onRestartTurn={isOnlineHost ? undefined : restartTurn}
        onSetBotAlgorithm={setBotAlgorithm}
      />
    </>
  );
}
