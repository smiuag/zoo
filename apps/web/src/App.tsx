import { useEffect, useRef, useState } from 'react';
import { getLegalActions } from '@zoo/engine';
import { GameBoard, type ReplayProps } from './components/GameBoard';
import { GameSetup } from './components/GameSetup';
import { GuestApp } from './components/GuestApp';
import { OnlineWaitingRoom } from './components/OnlineWaitingRoom';
import { Ranking } from './components/Ranking';
import { ScoreCalculator } from './components/ScoreCalculator';
import { ArtStyleProvider } from './lib/artStyle';
import { createHostRoom, type CreatedRoom } from './online/createHostRoom';
import { computePosition, recordGameResult, summarizeCollection, type GameMode } from './online/gameResults';
import { useHostRoom } from './online/useHostRoom';
import { clearOnlineRoom, loadOnlineRoom, saveOnlineRoom } from './online/onlineRoomStorage';
import { DEFAULT_ROUND_LIMIT, useGame, type GameConfig, type RoundLimit } from './state/useGame';

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
  return (
    <ArtStyleProvider>
      {guestParams ? (
        <GuestApp roomCode={guestParams.roomCode} seatId={guestParams.seatId} seatKey={guestParams.seatKey} />
      ) : (
        <HostOrLocalApp />
      )}
    </ArtStyleProvider>
  );
}

function HostOrLocalApp() {
  const {
    phase,
    state,
    humanIds,
    actingHumanId,
    scores,
    canRestartTurn,
    turnRestartCount,
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
  // Ranking/histórico (ver Ranking.tsx): mismo trato que la calculadora.
  const [showRanking, setShowRanking] = useState(false);

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

  // "Repetir partida" online (ver ReplayStatus en online/protocol.ts): en
  // cuanto todos los humanos han aceptado, se reinicia con la MISMA config
  // exacta con la que se creó esta sala (mismos nicks/bots/duración) — ni
  // siquiera hace falta reconstruirla, onlineRoom.config ya la conserva tal
  // cual desde el principio.
  function handleOnlineReplayAccepted() {
    if (!onlineRoom) return;
    startGame(onlineRoom.config);
  }

  const { connectedSeatIds, connectedSeatNicks, replayStatus, proposeReplay, respondReplay } = useHostRoom({
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
    onReplayAccepted: handleOnlineReplayAccepted,
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

  // Ranking/histórico (pedido explícito del usuario): en cuanto la partida
  // termina, cada dispositivo registra SOLO los humanos que controla de
  // verdad, con SU propio device_id — el host de una sala online nunca
  // registra por los invitados (cada uno se registra a sí mismo, ver
  // GuestApp.tsx); en local/solitario, "los que controla" son todos los
  // humanos de la partida (mismo dispositivo, pase y juega). Guardado en
  // una ref (no en el propio `phase`) para no repetir el registro en cada
  // re-render mientras la pantalla de resumen sigue montada.
  const recordedResultRef = useRef(false);
  useEffect(() => {
    if (!state.gameOver) {
      recordedResultRef.current = false;
      return;
    }
    if (recordedResultRef.current) return;
    recordedResultRef.current = true;
    const mode: GameMode = isOnlineHost ? 'online' : humanIds.length > 1 ? 'local' : 'solo';
    const myHumanIds = isOnlineHost ? ['human-0'] : humanIds;
    for (const humanId of myHumanIds) {
      const player = state.players.find((p) => p.id === humanId);
      const score = scores.find((s) => s.playerId === humanId)?.score;
      if (!player || score === undefined) continue;
      recordGameResult({
        nick: player.name,
        score,
        mode,
        numPlayers: state.players.length,
        roundLimit: state.maxRounds,
        position: computePosition(scores, humanId),
        deck: summarizeCollection([...player.deck, ...player.hand, ...player.discard, ...player.playedThisTurn, ...(player.table ?? [])]),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.gameOver]);

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
    // Los nicks de los invitados (escritos en su propia sala de espera, ver
    // GuestApp.tsx) llegan aquí vía presencia (ver useHostRoom.ts) — se
    // incorporan a la config justo ahora, la única vez que se usa de
    // verdad para crear la partida.
    const config: GameConfig = { ...onlineRoom.config, guestNicks: Object.fromEntries(connectedSeatNicks) };
    setOnlineRoom({ ...onlineRoom, config });
    startGame(config);
  }

  function handleCancelOnlineRoom() {
    setOnlineRoom(null);
  }

  function handleRestart() {
    setOnlineRoom(null);
    clearOnlineRoom();
    restart();
  }

  // "Repetir partida" en local/solitario (ver ReplayProps en
  // GameBoard.tsx): un solo clic ya vale (pedido explícito del usuario,
  // todos los humanos están delante de la misma pantalla), así que aquí
  // solo hace falta reconstruir una config equivalente a la que se usó —
  // mismos humanos/bots/duración — y arrancar directamente.
  function handleLocalReplay() {
    const nick = state.players.find((p) => p.id === 'human-0')?.name ?? '';
    const botSeatIds = Object.keys(botAlgorithms).sort(
      (a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1])
    );
    const config: GameConfig = {
      numHumans: humanIds.length,
      nick,
      botAlgorithms: botSeatIds.map((id) => botAlgorithms[id]),
      roundLimit: (state.maxRounds as RoundLimit | null) ?? DEFAULT_ROUND_LIMIT,
      animationsEnabled,
    };
    startGame(config);
  }

  if (showScoreCalculator) {
    return <ScoreCalculator onClose={() => setShowScoreCalculator(false)} />;
  }

  if (showRanking) {
    return <Ranking onClose={() => setShowRanking(false)} />;
  }

  if (phase === 'setup') {
    if (onlineRoom) {
      return (
        <OnlineWaitingRoom
          roomCode={onlineRoom.roomCode}
          seats={onlineRoom.seats}
          connectedSeatIds={connectedSeatIds}
          connectedSeatNicks={connectedSeatNicks}
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
        onOpenRanking={() => setShowRanking(true)}
        resumableOnlineRoomCode={resumableOnlineRoom?.roomCode}
        onResumeOnlineRoom={handleResumeOnlineRoom}
        onDiscardResumableOnlineRoom={handleDiscardResumableOnlineRoom}
      />
    );
  }

  const replay: ReplayProps = isOnlineHost
    ? {
        mode: 'online',
        status: replayStatus,
        viewerSeatId: 'human-0',
        // Repetir exige que todos los invitados humanos sigan conectados
        // (ver useHostRoom.ts): si alguien cerró la pestaña, proponer o
        // aceptar no serviría de nada, así que el botón lo refleja en vez de
        // fallar en silencio al pulsarlo.
        allGuestsConnected: onlineRoom.seats.every((seat) => connectedSeatIds.has(seat.seatId)),
        onPropose: () => proposeReplay('human-0', state.players.find((p) => p.id === 'human-0')?.name ?? 'Host'),
        onRespond: (accept) => respondReplay('human-0', accept),
      }
    : { mode: 'local', onReplay: handleLocalReplay };

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
        turnRestartCount={turnRestartCount}
        doAction={doAction}
        onNewGame={handleRestart}
        // "Reiniciar turno" se desactiva online: la foto que usa (ver
        // turnSnapshotRef en useGame) se toma en CUALQUIER turno humano, no
        // solo en el del host, así que sin esto el host podría deshacer a
        // ciegas el turno en curso de un invitado.
        onRestartTurn={isOnlineHost ? undefined : restartTurn}
        onSetBotAlgorithm={setBotAlgorithm}
        replay={replay}
      />
    </>
  );
}
