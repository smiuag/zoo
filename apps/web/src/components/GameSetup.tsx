import { useState } from 'react';
import { BOT_ALGORITHM_OPTIONS } from '../lib/botAlgorithms';
import {
  DEFAULT_BOT_ALGORITHM,
  DEFAULT_ROUND_LIMIT,
  MAX_BOTS,
  MAX_NICK_LENGTH,
  loadSavedNick,
  loadSavedSetupPrefs,
  saveNick,
  saveSetupPrefs,
  MAX_HUMANS,
  MIN_BOTS,
  MIN_HUMANS,
  MIN_TOTAL_PLAYERS,
  ROUND_LIMIT_OPTIONS,
  type BotAlgorithm,
  type GameConfig,
  type RoundLimit,
} from '../lib/gameConfig';
import { isOnlineAvailable } from '../online/supabaseClient';

interface GameSetupProps {
  onStart: (config: GameConfig) => void;
  // Ausente en contextos donde no aplica (no debería pasar en el flujo
  // normal, pero por si acaso) — cuando está presente Y hay más de 1 humano
  // configurado, se ofrece "Crear partida online" además de "Empezar
  // partida" (pase-y-juega local, sin cambios).
  onCreateOnlineRoom?: (config: GameConfig) => void;
}

// Alarga o recorta la lista de algoritmos al nuevo nº de bots, conservando
// lo ya elegido para los huecos que se mantienen (solo se pierde/genera lo
// que cambia), en vez de resetear todo el formulario cada vez que se toca
// el número de bots. Los huecos nuevos siempre arrancan con el algoritmo
// genérico (ver DEFAULT_BOT_ALGORITHM): el usuario decide luego si le da
// preferencia de hábitat a alguno.
function resizeBotAlgorithms(current: BotAlgorithm[], count: number): BotAlgorithm[] {
  if (count <= current.length) return current.slice(0, count);
  const extra = Array.from({ length: count - current.length }, () => DEFAULT_BOT_ALGORITHM);
  return [...current, ...extra];
}

export function GameSetup({ onStart, onCreateOnlineRoom }: GameSetupProps) {
  // Se lee una sola vez (lazy initializer de useState, no en cada render):
  // nº de humanos, bots elegidos y animaciones de la última partida creada
  // en este dispositivo (ver saveSetupPrefs en buildConfig más abajo). null
  // la primera vez (o si lo guardado ya no es válido) — se usan los valores
  // por defecto de siempre en ese caso.
  const [savedSetupPrefs] = useState(loadSavedSetupPrefs);
  const [numHumans, setNumHumans] = useState(savedSetupPrefs?.numHumans ?? 1);
  const [nick, setNick] = useState(loadSavedNick);
  const [botAlgorithms, setBotAlgorithms] = useState<BotAlgorithm[]>(
    savedSetupPrefs ? savedSetupPrefs.botAlgorithms : Array.from({ length: 4 }, () => DEFAULT_BOT_ALGORITHM)
  );
  const [roundLimit, setRoundLimit] = useState<RoundLimit>(savedSetupPrefs?.roundLimit ?? DEFAULT_ROUND_LIMIT);
  const [animationsEnabled, setAnimationsEnabled] = useState(savedSetupPrefs?.animationsEnabled ?? true);

  const totalPlayers = numHumans + botAlgorithms.length;
  const canStart = totalPlayers >= MIN_TOTAL_PLAYERS;
  // Online hace falta al menos 1 hueco humano más aparte del propio host, si
  // no no hay a quién invitar.
  const canGoOnline = isOnlineAvailable && Boolean(onCreateOnlineRoom) && numHumans >= 2 && canStart;

  function handleNumHumansChange(value: number) {
    setNumHumans(value);
  }

  function handleNumBotsChange(value: number) {
    setBotAlgorithms((prev) => resizeBotAlgorithms(prev, value));
  }

  function handleBotAlgorithmChange(index: number, algorithm: BotAlgorithm) {
    setBotAlgorithms((prev) => prev.map((a, i) => (i === index ? algorithm : a)));
  }

  function buildConfig(): GameConfig {
    const cleanNick = nick.trim().slice(0, MAX_NICK_LENGTH);
    // Se recuerda para la próxima partida en este dispositivo en el momento
    // de empezar (no al teclear/tocar cada campo).
    saveNick(cleanNick);
    saveSetupPrefs({ numHumans, botAlgorithms, roundLimit, animationsEnabled });
    return { numHumans, nick: cleanNick, botAlgorithms, roundLimit, animationsEnabled };
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canStart) return;
    onStart(buildConfig());
  }

  function handleCreateOnlineRoom() {
    if (!canGoOnline || !onCreateOnlineRoom) return;
    onCreateOnlineRoom(buildConfig());
  }

  return (
    <div className="app app--setup">
      <form className="panel setup-panel" onSubmit={handleSubmit}>
        <div className="panel__header">
          <h2>Nueva partida</h2>
        </div>

        <div className="setup-row">
          <label htmlFor="setup-nick">Tu nick</label>
          <input
            id="setup-nick"
            className="setup-nick"
            type="text"
            value={nick}
            maxLength={MAX_NICK_LENGTH}
            placeholder="Tú"
            autoComplete="nickname"
            spellCheck={false}
            onChange={(e) => setNick(e.target.value)}
          />
          <span className="setup-hint">
            Hasta {MAX_NICK_LENGTH} letras, para que el marcador quepa en el móvil. Se recuerda en este dispositivo.
          </span>
        </div>

        <div className="setup-row">
          <label htmlFor="setup-humans">Jugadores humanos</label>
          <select
            id="setup-humans"
            value={numHumans}
            onChange={(e) => handleNumHumansChange(Number(e.target.value))}
          >
            {Array.from({ length: MAX_HUMANS - MIN_HUMANS + 1 }, (_, i) => MIN_HUMANS + i).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          {numHumans > 1 && (
            <span className="setup-hint">
              Turno rotatorio en este mismo dispositivo: el indicador de turno siempre muestra a quién le toca.
            </span>
          )}
        </div>

        <div className="setup-row">
          <label htmlFor="setup-bots">Número de bots</label>
          <select
            id="setup-bots"
            value={botAlgorithms.length}
            onChange={(e) => handleNumBotsChange(Number(e.target.value))}
          >
            {Array.from({ length: MAX_BOTS - MIN_BOTS + 1 }, (_, i) => MIN_BOTS + i).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        {botAlgorithms.length > 0 && (
          <div className="setup-bot-list">
            {botAlgorithms.map((algorithm, i) => (
              <div key={i} className="setup-row setup-row--bot">
                <label htmlFor={`setup-bot-${i}`}>Bot {i + 1}</label>
                <select
                  id={`setup-bot-${i}`}
                  value={algorithm}
                  onChange={(e) => handleBotAlgorithmChange(i, e.target.value as BotAlgorithm)}
                >
                  {BOT_ALGORITHM_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}

        <div className="setup-row">
          <label>Duración</label>
          <div className="setup-round-options">
            {ROUND_LIMIT_OPTIONS.map((rounds) => (
              <button
                key={rounds}
                type="button"
                className={`btn ${roundLimit === rounds ? 'btn--primary' : 'btn--ghost'}`}
                aria-pressed={roundLimit === rounds}
                onClick={() => setRoundLimit(rounds)}
              >
                {rounds} rondas
              </button>
            ))}
          </div>
        </div>

        <div className="setup-row">
          <label htmlFor="setup-animations">Animaciones</label>
          <input
            id="setup-animations"
            type="checkbox"
            checked={animationsEnabled}
            onChange={(e) => setAnimationsEnabled(e.target.checked)}
          />
          <span className="setup-hint">
            Ritmo de 1s entre acciones de los bots y la carta comprada volando al descarte. Se decide una vez, para
            toda la partida.
          </span>
        </div>

        {!canStart && (
          <p className="setup-error">
            Con 1 solo jugador humano hace falta al menos 1 bot rival: sube el número de bots o de jugadores.
          </p>
        )}

        <button className="btn btn--primary" type="submit" disabled={!canStart}>
          Empezar partida
        </button>

        {onCreateOnlineRoom && (
          <>
            <button className="btn btn--ghost" type="button" disabled={!canGoOnline} onClick={handleCreateOnlineRoom}>
              🌐 Crear partida online
            </button>
            {!isOnlineAvailable && (
              <p className="setup-hint">
                No configurada en este despliegue (falta VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY).
              </p>
            )}
            {isOnlineAvailable && numHumans < 2 && (
              <p className="setup-hint">Sube "Jugadores humanos" a 2 o más para poder invitar a alguien.</p>
            )}
          </>
        )}
      </form>
    </div>
  );
}
