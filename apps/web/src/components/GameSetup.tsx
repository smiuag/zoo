import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GearIcon } from './icons/GearIcon';
import { GameConfigFields } from './GameConfigFields';
import { GameSettingsModal } from './GameSettingsModal';
import {
  CUSTOM_PICKABLE_SPECIES,
  DEFAULT_BOT_ALGORITHM,
  DEFAULT_CUSTOM_COPY_DELTAS,
  DEFAULT_ROUND_LIMIT,
  MAX_NICK_LENGTH,
  loadSavedNick,
  loadSavedSetupPrefs,
  saveNick,
  saveSetupPrefs,
  MAX_HUMANS,
  MIN_HUMANS,
  MIN_TOTAL_PLAYERS,
  type BotAlgorithm,
  type CustomCopyDeltas,
  type GameConfig,
  type RoundLimit,
} from '../lib/gameConfig';
import { isOnlineAvailable } from '../online/supabaseClient';
import { loadSavedEdition, saveEdition } from '../lib/edition';
import { LANGS, LANG_LABELS, loadDeviceLang, saveDeviceLang, useT, type Lang } from '../lib/i18n';

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
  // Abre el tutorial paso a paso (ver Tutorial.tsx). Solo se ofrece con la
  // edición Aprendizaje seleccionada — pedido explícito del usuario
  // 2026-09-22.
  onOpenTutorial: () => void;
  // Presente solo si hay una sala online guardada en localStorage (ver
  // App.tsx/online/onlineRoomStorage.ts) — normalmente porque el host
  // refrescó por accidente a mitad de partida. Mostrar el aviso ANTES que
  // el formulario, para que sea imposible pasarlo por alto y arrancar una
  // partida nueva sin darse cuenta de que había una a medias.
  resumableOnlineRoomCode?: string;
  onResumeOnlineRoom?: () => void;
  onDiscardResumableOnlineRoom?: () => void;
}

export function GameSetup({
  onStart,
  onCreateOnlineRoom,
  onOpenScoreCalculator,
  onOpenRanking,
  onOpenTutorial,
  resumableOnlineRoomCode,
  onResumeOnlineRoom,
  onDiscardResumableOnlineRoom,
}: GameSetupProps) {
  const navigate = useNavigate();
  const { t, setLang } = useT();
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
  // Idioma de QUIEN CREA la partida (también el de este formulario: cambia
  // la interfaz en el acto). Los demás jugadores eligen el suyo ellos
  // mismos: los invitados online al unirse (GuestApp) y, en pase-y-juega en
  // el mismo dispositivo, con el botón de idioma durante la partida.
  const [langChoice, setLangChoice] = useState<Lang>(loadDeviceLang);
  useEffect(() => {
    setLang(langChoice);
  }, [langChoice, setLang]);
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
    saveDeviceLang(langChoice);
    return {
      numHumans,
      nick: cleanNick,
      botAlgorithms,
      roundLimit,
      animationsEnabled,
      edition,
      langs: [langChoice],
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
            <h2>{t('🌐 Partida online sin terminar')}</h2>
          </div>
          <p className="setup-hint">
            {t('Parece que refrescaste la página a mitad de la sala')} <strong>{resumableOnlineRoomCode}</strong>.{' '}
            {t('Puedes seguir donde lo dejaste, con los mismos enlaces ya repartidos.')}
          </p>
          <div className="setup-round-options">
            <button className="btn btn--primary" type="button" onClick={onResumeOnlineRoom}>
              {t('▶ Reanudar partida')}
            </button>
            <button className="btn btn--ghost" type="button" onClick={onDiscardResumableOnlineRoom}>
              {t('Descartar')}
            </button>
          </div>
        </div>
      )}
      <form className="panel setup-panel" onSubmit={handleSubmit}>
        <div className="panel__header">
          <h2>{t('Nueva partida')}</h2>
          <button
            type="button"
            className="btn btn--ghost btn--settings-gear"
            title={t('Configuración de la partida')}
            onClick={() => setSettingsOpen(true)}
          >
            <GearIcon /><span className="btn__label"> {t('Configuración')}</span>
          </button>
        </div>

        <div className="setup-row">
          <label htmlFor="setup-nick">{t('Tu nick')}</label>
          <input
            id="setup-nick"
            className="setup-nick"
            type="text"
            value={nick}
            maxLength={MAX_NICK_LENGTH}
            placeholder={t('Tú')}
            autoComplete="nickname"
            spellCheck={false}
            onChange={(e) => setNick(e.target.value)}
          />
          <span className="setup-hint">
            {t('Hasta {n} letras, para que el marcador quepa en el móvil. Se recuerda en este dispositivo.', {
              n: MAX_NICK_LENGTH,
            })}
          </span>
        </div>

        <div className="setup-row">
          <label htmlFor="setup-humans">{t('Jugadores humanos')}</label>
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
              {t('Turno rotatorio en este mismo dispositivo: el indicador de turno siempre muestra a quién le toca.')}
            </span>
          )}
        </div>

        <div className="setup-row">
          <label htmlFor="setup-lang">{t('Idioma')}</label>
          <select id="setup-lang" value={langChoice} onChange={(e) => setLangChoice(e.target.value as Lang)}>
            {LANGS.map((l) => (
              <option key={l} value={l}>
                {LANG_LABELS[l]}
              </option>
            ))}
          </select>
          {numHumans > 1 && (
            <span className="setup-hint">
              {t('Es tu idioma: cada jugador elige el suyo (online, al unirse; en este dispositivo, con el botón de idioma durante la partida).')}
            </span>
          )}
        </div>

        <GameConfigFields
          botAlgorithms={botAlgorithms}
          onBotAlgorithmsChange={setBotAlgorithms}
          roundLimit={roundLimit}
          onRoundLimitChange={setRoundLimit}
          edition={edition}
          onEditionChange={setEdition}
          onOpenTutorial={onOpenTutorial}
        />
        {/* Acciones (empezar / online / marcador / ranking) al FINAL del
            formulario, debajo de toda la configuración — pedido explícito
            del usuario 2026-09-22 (antes iban arriba, justo bajo el título). */}
        <div className="setup-row">
          <div className="setup-round-options setup-round-options--full">
            <button className="btn btn--primary" type="submit" disabled={!canStart}>
              {t('Empezar partida')}
            </button>
            {onCreateOnlineRoom && (
              <button className="btn btn--ghost" type="button" disabled={!canGoOnline} onClick={handleCreateOnlineRoom}>
                {t('🌐 Crear partida online')}
              </button>
            )}
          </div>
          {totalPlayers < MIN_TOTAL_PLAYERS && (
            <p className="setup-error">
              {t('Con 1 solo jugador humano hace falta al menos 1 bot rival: sube el número de bots o de jugadores.')}
            </p>
          )}
          {edition === 'custom' && customSpecies.size === 0 && (
            <p className="setup-error">
              {t('Elige al menos una especie en Configuración → Personalizado antes de empezar.')}
            </p>
          )}
          {onCreateOnlineRoom && !isOnlineAvailable && (
            <p className="setup-hint">{t('No configurada en este despliegue (falta VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY).')}</p>
          )}
        </div>

        <div className="setup-row">
          <div className="setup-round-options setup-round-options--full">
            <button className="btn btn--ghost" type="button" onClick={onOpenScoreCalculator}>
              {t('🌰 Calculadora')}
            </button>
            <button className="btn btn--ghost" type="button" onClick={onOpenRanking}>
              {t('🏆 Ranking')}
            </button>
            <button className="btn btn--ghost" type="button" onClick={() => navigate('/cartas')}>
              {t('📖 Cartas')}
            </button>
          </div>
        </div>

      </form>
    </div>
  );
}
