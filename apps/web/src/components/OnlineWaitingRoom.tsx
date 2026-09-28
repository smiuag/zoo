import { useState } from 'react';
import { GearIcon } from './icons/GearIcon';
import { GameConfigFields } from './GameConfigFields';
import { GameSettingsModal } from './GameSettingsModal';
import {
  DEFAULT_CUSTOM_COPY_DELTAS,
  CUSTOM_PICKABLE_SPECIES,
  loadSavedSetupPrefs,
  type GameConfig,
} from '../lib/gameConfig';
import type { HostRoomSeat } from '../online/useHostRoom';

interface OnlineWaitingRoomProps {
  roomCode: string;
  seats: HostRoomSeat[];
  connectedSeatIds: Set<string>;
  // Nick que cada invitado escribió antes de entrar (ver GuestApp.tsx), por
  // seatId — ausente mientras ese asiento no se haya conectado todavía.
  connectedSeatNicks: Map<string, string>;
  // Config vigente de la sala, editable aquí sin destruirla: cambiarla no
  // toca roomCode ni enlaces, así que los invitados ya conectados siguen
  // dentro (ver App.tsx: handleUpdateOnlineConfig). El nº de humanos no se
  // puede cambiar porque ya hay un enlace repartido por cada asiento.
  config: GameConfig;
  onConfigChange: (config: GameConfig) => void;
  onStart: () => void;
  onCancel: () => void;
}

function seatLabel(seatId: string, nick: string | undefined): string {
  if (nick) return nick;
  const n = Number(seatId.split('-')[1]) + 1;
  return `Jugador ${n}`;
}

export function OnlineWaitingRoom({
  roomCode,
  seats,
  connectedSeatIds,
  connectedSeatNicks,
  config,
  onConfigChange,
  onStart,
  onCancel,
}: OnlineWaitingRoomProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const edition = config.edition ?? 'classic';
  const [savedPrefs] = useState(loadSavedSetupPrefs);
  const customSpecies = new Set(config.customSpecies ?? savedPrefs?.customSpecies ?? CUSTOM_PICKABLE_SPECIES);
  const customCopyDeltas = config.customCopyDeltas ?? savedPrefs?.customCopyDeltas ?? DEFAULT_CUSTOM_COPY_DELTAS;
  // customSpecies/customCopyDeltas solo viajan en la config con edición
  // 'custom' (igual que buildConfig en GameSetup), pero se conservan aparte
  // mientras se edita para no perder la selección al alternar de edición.
  const [customDraft, setCustomDraft] = useState({ species: customSpecies, deltas: customCopyDeltas });

  // Misma regla que canStart en GameSetup: 'custom' sin ninguna especie
  // daría un mercado vacío.
  const canStart = edition !== 'custom' || customDraft.species.size > 0;

  function updateConfig(patch: Partial<GameConfig>, draft = customDraft) {
    const next: GameConfig = { ...config, ...patch };
    const nextEdition = next.edition ?? 'classic';
    if (nextEdition === 'custom') {
      next.customSpecies = [...draft.species];
      next.customCopyDeltas = draft.deltas;
    } else {
      delete next.customSpecies;
      delete next.customCopyDeltas;
    }
    onConfigChange(next);
  }

  function updateDraft(patch: Partial<typeof customDraft>) {
    const draft = { ...customDraft, ...patch };
    setCustomDraft(draft);
    updateConfig({}, draft);
  }

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

  // Pantalla completa que sustituye a la sala mientras está abierta, mismo
  // patrón que en GameSetup.tsx.
  if (settingsOpen) {
    return (
      <GameSettingsModal
        animationsEnabled={config.animationsEnabled}
        onAnimationsEnabledChange={(value) => updateConfig({ animationsEnabled: value })}
        customSpecies={customDraft.species}
        onCustomSpeciesChange={(species) => updateDraft({ species })}
        customCopyDeltas={customDraft.deltas}
        onCustomCopyDeltasChange={(deltas) => updateDraft({ deltas })}
        onClose={() => setSettingsOpen(false)}
      />
    );
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
                {seatLabel(seat.seatId, connectedSeatNicks.get(seat.seatId))}{' '}
                {connectedSeatIds.has(seat.seatId) ? '🟢 conectado' : '⏳ esperando'}
              </label>
              <button className="btn btn--ghost" type="button" onClick={() => copyLink(seat.seatId, seat.inviteUrl)}>
                {copied === seat.seatId ? '✓ copiado' : '📋 copiar enlace'}
              </button>
            </div>
          ))}
        </div>

        <div className="panel__header">
          <h3>Configuración de la partida</h3>
          <button
            type="button"
            className="btn btn--ghost btn--settings-gear"
            title="Configuración de la partida"
            onClick={() => setSettingsOpen(true)}
          >
            <GearIcon /><span className="btn__label"> Configuración</span>
          </button>
        </div>
        <p className="setup-hint">Los invitados ven estos cambios al momento. Los enlaces no cambian.</p>

        <GameConfigFields
          botAlgorithms={config.botAlgorithms}
          onBotAlgorithmsChange={(botAlgorithms) => updateConfig({ botAlgorithms })}
          roundLimit={config.roundLimit}
          onRoundLimitChange={(roundLimit) => updateConfig({ roundLimit })}
          edition={edition}
          onEditionChange={(next) => updateConfig({ edition: next })}
        />

        <button className="btn btn--primary" onClick={onStart} disabled={!canStart}>
          Empezar partida
        </button>
        {!canStart && (
          <p className="setup-error">Elige al menos una especie en Configuración → Personalizado antes de empezar.</p>
        )}
      </div>
    </div>
  );
}
