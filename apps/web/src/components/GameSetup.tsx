import { useState } from 'react';
import { LEARNING_EDITION_MAX_COST } from '@zoo/engine';
import { BOT_ALGORITHM_OPTIONS } from '../lib/botAlgorithms';
import { GameSettingsModal } from './GameSettingsModal';
import {
  CUSTOM_PICKABLE_SPECIES,
  DEFAULT_BOT_ALGORITHM,
  DEFAULT_CUSTOM_COPY_DELTAS,
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
  type CustomCopyDeltas,
  type GameConfig,
  type RoundLimit,
} from '../lib/gameConfig';
import { isOnlineAvailable } from '../online/supabaseClient';
import { loadSavedEdition, saveEdition } from '../lib/edition';

interface GameSetupProps {
  onStart: (config: GameConfig) => void;
  // Ausente en contextos donde no aplica (no debería pasar en el flujo
  // normal, pero por si acaso) — cuando está presente Y hay más de 1 humano
  // configurado, se ofrece "Crear partida online" además de "Empezar
  // partida" (pase-y-juega local, sin cambios).
  onCreateOnlineRoom?: (config: GameConfig) => void;
  // Abre la calculadora de puntos suelta (ver ScoreCalculator.tsx): no tiene
  // nada que ver con esta partida ni con ninguna configuración de arriba, así
  // que siempre está disponible sin más condición.
  onOpenScoreCalculator: () => void;
  // Abre el ranking/histórico (ver Ranking.tsx): igual que la calculadora,
  // sin relación con esta partida.
  onOpenRanking: () => void;
  // Presente solo si hay una sala online guardada en localStorage (ver
  // App.tsx/online/onlineRoomStorage.ts) — normalmente porque el host
  // refrescó por accidente a mitad de partida. Mostrar el aviso ANTES que
  // el formulario, para que sea imposible pasarlo por alto y arrancar una
  // partida nueva sin darse cuenta de que había una a medias.
  resumableOnlineRoomCode?: string;
  onResumeOnlineRoom?: () => void;
  onDiscardResumableOnlineRoom?: () => void;
}

// Alarga o recorta la lista de algoritmos al nuevo nº de bots, conservando
// lo ya elegido para los huecos que se mantienen (solo se pierde/genera lo
// que cambia), en vez de resetear todo el formulario cada vez que se toca
// el número de bots. Los huecos nuevos arrancan con el genérico
// (DEFAULT_BOT_ALGORITHM): el usuario decide luego si le da preferencia de
// hábitat a alguno. Los 4 algoritmos son edición-agnósticos (ver
// botAlgorithms.ts: resolveBot decide qué bot de verdad usar según la
// edición de la partida), así que no hace falta ningún caso especial aquí.
function resizeBotAlgorithms(current: BotAlgorithm[], count: number): BotAlgorithm[] {
  if (count <= current.length) return current.slice(0, count);
  const extra = Array.from({ length: count - current.length }, () => DEFAULT_BOT_ALGORITHM);
  return [...current, ...extra];
}

export function GameSetup({
  onStart,
  onCreateOnlineRoom,
  onOpenScoreCalculator,
  onOpenRanking,
  resumableOnlineRoomCode,
  onResumeOnlineRoom,
  onDiscardResumableOnlineRoom,
}: GameSetupProps) {
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
  const [edition, setEdition] = useState(loadSavedEdition);
  // Solo tienen efecto con edition === 'custom' (ver GameSettingsModal.tsx).
  // Por defecto, si nunca se ha usado "Personalizado" en este dispositivo,
  // arranca con TODO marcado (mismo mercado que tenía antes "Completa").
  const [customSpecies, setCustomSpecies] = useState<Set<string>>(
    new Set(savedSetupPrefs?.customSpecies ?? CUSTOM_PICKABLE_SPECIES)
  );
  const [customCopyDeltas, setCustomCopyDeltas] = useState<CustomCopyDeltas>(
    savedSetupPrefs?.customCopyDeltas ?? DEFAULT_CUSTOM_COPY_DELTAS
  );
  // Panel de configuración (ver GameSettingsModal.tsx): engranaje junto al
  // título "Nueva partida" — pedido explícito del usuario 2026-09-21.
  const [settingsOpen, setSettingsOpen] = useState(false);

  const totalPlayers = numHumans + botAlgorithms.length;
  // 'custom' sin ninguna especie marcada daría un mercado vacío (createGame
  // no revienta, pero la partida sería injugable: nunca habría nada que
  // comprar) — se bloquea aquí, no en el motor.
  const canStart = totalPlayers >= MIN_TOTAL_PLAYERS && (edition !== 'custom' || customSpecies.size > 0);
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
    const customSpeciesArray = [...customSpecies];
    saveSetupPrefs({
      numHumans,
      botAlgorithms,
      roundLimit,
      animationsEnabled,
      customSpecies: customSpeciesArray,
      customCopyDeltas,
    });
    saveEdition(edition);
    return {
      numHumans,
      nick: cleanNick,
      botAlgorithms,
      roundLimit,
      animationsEnabled,
      edition,
      ...(edition === 'custom' ? { customSpecies: customSpeciesArray, customCopyDeltas } : {}),
    };
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

  // Sección de pantalla completa, no un popup encima del formulario (ver
  // GameSettingsModal.tsx) — mismo patrón que Ranking.tsx en App.tsx: un
  // return anticipado que sustituye toda la pantalla mientras está abierta.
  if (settingsOpen) {
    return (
      <GameSettingsModal
        animationsEnabled={animationsEnabled}
        onAnimationsEnabledChange={setAnimationsEnabled}
        customSpecies={customSpecies}
        onCustomSpeciesChange={setCustomSpecies}
        customCopyDeltas={customCopyDeltas}
        onCustomCopyDeltasChange={setCustomCopyDeltas}
        onClose={() => setSettingsOpen(false)}
      />
    );
  }

  return (
    <div className="app app--setup">
      {resumableOnlineRoomCode && (
        <div className="panel panel--choice setup-panel setup-resume">
          <div className="panel__header">
            <h2>🌐 Partida online sin terminar</h2>
          </div>
          <p className="setup-hint">
            Parece que refrescaste la página a mitad de la sala <strong>{resumableOnlineRoomCode}</strong>. Puedes
            seguir donde lo dejaste, con los mismos enlaces ya repartidos.
          </p>
          <div className="setup-round-options">
            <button className="btn btn--primary" type="button" onClick={onResumeOnlineRoom}>
              ▶ Reanudar partida
            </button>
            <button className="btn btn--ghost" type="button" onClick={onDiscardResumableOnlineRoom}>
              Descartar
            </button>
          </div>
        </div>
      )}
      <form className="panel setup-panel" onSubmit={handleSubmit}>
        <div className="panel__header">
          <h2>Nueva partida</h2>
          <button
            type="button"
            className="btn btn--ghost btn--settings-gear"
            title="Configuración de la partida"
            onClick={() => setSettingsOpen(true)}
          >
            ⚙️<span className="btn__label"> Configuración</span>
          </button>
        </div>

        <div className="setup-row">
          <div className="setup-round-options setup-round-options--full">
            <button className="btn btn--primary" type="submit" disabled={!canStart}>
              Empezar partida
            </button>
            {onCreateOnlineRoom && (
              <button className="btn btn--ghost" type="button" disabled={!canGoOnline} onClick={handleCreateOnlineRoom}>
                🌐 Crear partida online
              </button>
            )}
          </div>
          {totalPlayers < MIN_TOTAL_PLAYERS && (
            <p className="setup-error">
              Con 1 solo jugador humano hace falta al menos 1 bot rival: sube el número de bots o de jugadores.
            </p>
          )}
          {edition === 'custom' && customSpecies.size === 0 && (
            <p className="setup-error">
              Elige al menos una especie en Configuración → Personalizado antes de empezar.
            </p>
          )}
          {onCreateOnlineRoom && !isOnlineAvailable && (
            <p className="setup-hint">No configurada en este despliegue (falta VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY).</p>
          )}
        </div>

        <div className="setup-row">
          <div className="setup-round-options setup-round-options--full">
            <button className="btn btn--ghost" type="button" onClick={onOpenScoreCalculator}>
              🌰 Marcador final (sin partida)
            </button>
            <button className="btn btn--ghost" type="button" onClick={onOpenRanking}>
              🏆 Ranking
            </button>
          </div>
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
          <div className="setup-round-options setup-round-options--full">
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
          <div className="setup-round-options setup-round-options--full">
            <button
              type="button"
              className={`btn ${edition === 'learning' ? 'btn--primary' : 'btn--ghost'}`}
              aria-pressed={edition === 'learning'}
              onClick={() => setEdition('learning')}
            >
              Aprendizaje
            </button>
            <button
              type="button"
              className={`btn ${edition === 'classic' ? 'btn--primary' : 'btn--ghost'}`}
              aria-pressed={edition === 'classic'}
              onClick={() => setEdition('classic')}
            >
              Clásica
            </button>
            <button
              type="button"
              className={`btn ${edition === 'custom' ? 'btn--primary' : 'btn--ghost'}`}
              aria-pressed={edition === 'custom'}
              onClick={() => setEdition('custom')}
            >
              Personalizado
            </button>
          </div>
          <p className="setup-hint">
            {edition === 'learning'
              ? `Mismo mazo clásico de siempre, pero el mercado solo ofrece animales de coste ${LEARNING_EDITION_MAX_COST} o menos: partidas más sencillas y rápidas para aprender.`
              : edition === 'custom'
                ? 'Elige tú qué especies entran en el mercado y cuántas copias hay de cada una, desde ⚙️ Configuración.'
                : 'La oficial: 33 especies, sin restricciones.'}
          </p>
        </div>
      </form>
    </div>
  );
}
