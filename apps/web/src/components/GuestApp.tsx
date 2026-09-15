import { useEffect, useRef, useState } from 'react';
import { GameBoard } from './GameBoard';
import { useGuestRoom } from '../online/useGuestRoom';
import { loadSavedNick, saveNick, MAX_NICK_LENGTH } from '../lib/gameConfig';
import { recordGameResult } from '../online/gameResults';

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
  // Vacío = todavía no ha confirmado el formulario de nick de abajo (ver
  // useGuestRoom: con nick vacío no conecta a nada todavía). Precargado con
  // el último usado en este dispositivo (mismo mecanismo que el nick del
  // host, ver lib/gameConfig.ts) para no tener que volver a escribirlo cada
  // vez, pero editable antes de unirse.
  const [nickInput, setNickInput] = useState(loadSavedNick);
  const [joinedNick, setJoinedNick] = useState('');

  const { status, state, humanIds, botAlgorithms, scores, legalActions, animationsEnabled, sendAction, replayStatus, proposeReplay, respondReplay } =
    useGuestRoom(roomCode, seatId, seatKey, joinedNick);
  const [slowConnect, setSlowConnect] = useState(false);

  useEffect(() => {
    if (status === 'playing') {
      setSlowConnect(false);
      return;
    }
    const id = window.setTimeout(() => setSlowConnect(true), SLOW_CONNECT_HINT_MS);
    return () => window.clearTimeout(id);
  }, [status]);

  // Ranking/histórico (ver App.tsx para el mismo mecanismo en el host): este
  // invitado se registra a SÍ MISMO en cuanto la partida termina, con su
  // propio nick y su propio device_id — el host nunca lo hace por él.
  const recordedResultRef = useRef(false);
  useEffect(() => {
    if (!state?.gameOver) {
      recordedResultRef.current = false;
      return;
    }
    if (recordedResultRef.current) return;
    recordedResultRef.current = true;
    const player = state.players.find((p) => p.id === seatId);
    const score = scores.find((s) => s.playerId === seatId)?.score;
    if (!player || score === undefined) return;
    recordGameResult({ nick: player.name, score, mode: 'online', numPlayers: state.players.length, roundLimit: state.maxRounds });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.gameOver]);

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const clean = nickInput.trim().slice(0, MAX_NICK_LENGTH);
    saveNick(clean);
    setJoinedNick(clean || 'J');
  }

  if (!joinedNick) {
    return (
      <div className="app app--setup">
        <form className="panel setup-panel" onSubmit={handleJoin}>
          <div className="panel__header">
            <h2>Sala {roomCode}</h2>
          </div>
          <div className="setup-row">
            <label htmlFor="guest-nick">Tu nick</label>
            <input
              id="guest-nick"
              className="setup-nick"
              type="text"
              value={nickInput}
              maxLength={MAX_NICK_LENGTH}
              placeholder="Tú"
              autoComplete="nickname"
              spellCheck={false}
              autoFocus
              onChange={(e) => setNickInput(e.target.value)}
            />
            <span className="setup-hint">Hasta {MAX_NICK_LENGTH} letras. Así te verán el resto en la partida.</span>
          </div>
          <button className="btn btn--primary" type="submit">
            Unirse
          </button>
        </form>
      </div>
    );
  }

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
      replay={{ mode: 'online', status: replayStatus, viewerSeatId: seatId, onPropose: proposeReplay, onRespond: respondReplay }}
    />
  );
}
