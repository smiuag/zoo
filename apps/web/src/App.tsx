import { useEffect, useRef, useState } from 'react';
import { getLegalActions } from '@zoo/engine';
import { GameBoard } from './components/GameBoard';
import { GameSetup } from './components/GameSetup';
import { GuestApp } from './components/GuestApp';
import { OnlineWaitingRoom } from './components/OnlineWaitingRoom';
import { ScoreCalculator } from './components/ScoreCalculator';
import { createHostRoom, type CreatedRoom } from './online/createHostRoom';
import { useHostRoom } from './online/useHostRoom';
import { clearOnlineRoom, loadOnlineRoom, saveOnlineRoom } from './online/onlineRoomStorage';
import { DEFAULT_ROUND_LIMIT, useGame, type GameConfig } from './state/useGame';

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
    actingHumanId,
    scores,
    canRestartTurn,
    botAlgorithms,
    animationsEnabled,
    tick,
    startGame,
    resumeGame,
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
  // Última sala online guardada en localStorage (ver online/onlineRoomStorage.ts),
  // leída una sola vez al montar: si el host refresca por accidente a mitad
  // de partida, esto es lo que permite ofrecerle "Reanudar" en vez de que la
  // partida (y los enlaces ya repartidos) queden muertos para siempre. Se
  // pone a null en cuanto se reanuda o se descarta, para que el aviso
  // desaparezca sin depender de releer localStorage.
  const [resumableOnlineRoom, setResumableOnlineRoom] = useState(loadOnlineRoom);
  // Calculadora de puntos suelta (ver ScoreCalculator.tsx): pantalla
  // completa, independiente de `phase`/`onlineRoom` — se puede abrir y
  // cerrar sin tocar ninguna partida en curso ni su configuración.
  const [showScoreCalculator, setShowScoreCalculator] = useState(false);

  // Mientras juegan los bots, se sigue mostrando el último humano con
  // agencia (pase-y-juega local): nada interactivo depende de esto, solo
  // evita que el panel "desaparezca" entre turno humano y turno de bots. Si
  // un descarte pendiente le toca a OTRO humano que el activo, también se
  // cambia aquí — así "se le pasa el turno" un momento para que elija. En
  // modo online el host es siempre human-0, así que esto nunca cambia el
  // valor devuelto ahí.
  const lastHumanIdRef = useRef<string>(humanIds[0]);
  if (actingHumanId) lastHumanIdRef.current = actingHumanId;

  const isOnlineHost = onlineRoom !== null;
  const viewerPlayerId = isOnlineHost ? 'human-0' : lastHumanIdRef.current;
  // Cada visor calcula sus propias acciones legales directamente (igual que
  // ya hace el invitado online, ver useGuestRoom): es lo único que funciona
  // sin ambigüedad tanto en pase-y-juega local como de host, ya que
  // actingHumanId (el humano con agencia AHORA MISMO) no tiene por qué
  // coincidir con este visor concreto (p. ej. en el host, mientras un
  // invitado resuelve su propio descarte pendiente).
  const legalActions = phase === 'playing' ? getLegalActions(state, viewerPlayerId) : [];

  const { connectedSeatIds } = useHostRoom({
    roomCode: onlineRoom?.roomCode ?? '',
    seats: onlineRoom?.seats ?? [],
    state,
    humanIds,
    botAlgorithms,
    scores,
    animationsEnabled,
    doAction,
    tick,
    active: isOnlineHost && phase === 'playing',
  });

  // Guarda el estado de la sala online cada vez que cambia de verdad
  // (mismo tick que usa useHostRoom para retransmitir a los invitados): así,
  // si el host refresca por accidente, hay algo reciente que ofrecer
  // reanudar. Solo la pestaña host guarda nada — un invitado nunca necesita
  // esto, su propio reconectar ya está resuelto en useGuestRoom.
  useEffect(() => {
    if (!isOnlineHost || phase !== 'playing' || !onlineRoom) return;
    saveOnlineRoom({
      roomCode: onlineRoom.roomCode,
      seats: onlineRoom.seats,
      state,
      humanIds,
      botAlgorithms,
      animationsEnabled,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, isOnlineHost, phase]);

  function handleResumeOnlineRoom() {
    if (!resumableOnlineRoom) return;
    setOnlineRoom({
      roomCode: resumableOnlineRoom.roomCode,
      seats: resumableOnlineRoom.seats,
      config: {
        numHumans: resumableOnlineRoom.humanIds.length,
        nick: '',
        botAlgorithms: Object.values(resumableOnlineRoom.botAlgorithms),
        roundLimit: DEFAULT_ROUND_LIMIT,
        animationsEnabled: resumableOnlineRoom.animationsEnabled,
      },
    });
    resumeGame(resumableOnlineRoom);
    setResumableOnlineRoom(null);
  }

  function handleDiscardResumableOnlineRoom() {
    clearOnlineRoom();
    setResumableOnlineRoom(null);
  }

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
    clearOnlineRoom();
    restart();
  }

  if (showScoreCalculator) {
    return <ScoreCalculator onClose={() => setShowScoreCalculator(false)} />;
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
    return (
      <GameSetup
        onStart={startGame}
        onCreateOnlineRoom={handleCreateOnlineRoom}
        onOpenScoreCalculator={() => setShowScoreCalculator(true)}
        resumableOnlineRoomCode={resumableOnlineRoom?.roomCode}
        onResumeOnlineRoom={handleResumeOnlineRoom}
        onDiscardResumableOnlineRoom={handleDiscardResumableOnlineRoom}
      />
    );
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
        legalActions={legalActions}
        scores={scores}
        botAlgorithms={botAlgorithms}
        animationsEnabled={animationsEnabled}
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
