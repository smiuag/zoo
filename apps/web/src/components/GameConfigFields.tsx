import { LEARNING_EDITION_MAX_COST, type GameEdition } from '@zoo/engine';
import { BOT_ALGORITHM_OPTIONS } from '../lib/botAlgorithms';
import {
  MAX_BOTS,
  MIN_BOTS,
  ROUND_LIMIT_OPTIONS,
  resizeBotAlgorithms,
  type BotAlgorithm,
  type RoundLimit,
} from '../lib/gameConfig';

interface GameConfigFieldsProps {
  botAlgorithms: BotAlgorithm[];
  onBotAlgorithmsChange: (value: BotAlgorithm[]) => void;
  roundLimit: RoundLimit;
  onRoundLimitChange: (value: RoundLimit) => void;
  edition: GameEdition;
  onEditionChange: (value: GameEdition) => void;
  // Solo se ofrece "Ver tutorial" si el llamador lo pasa (el formulario de
  // creación de partida sí; la sala online no).
  onOpenTutorial?: () => void;
}

// Campos de configuración de partida compartidos por el formulario de
// creación (GameSetup.tsx) y la sala de espera online (OnlineWaitingRoom.tsx):
// nº de bots y algoritmo de cada uno, duración y edición. Componente
// controlado, sin estado propio. El nº de humanos y el nick NO están aquí a
// propósito: en una sala online el nº de humanos ya está fijado por los
// enlaces repartidos.
export function GameConfigFields({
  botAlgorithms,
  onBotAlgorithmsChange,
  roundLimit,
  onRoundLimitChange,
  edition,
  onEditionChange,
  onOpenTutorial,
}: GameConfigFieldsProps) {
  function handleBotAlgorithmChange(index: number, algorithm: BotAlgorithm) {
    onBotAlgorithmsChange(botAlgorithms.map((a, i) => (i === index ? algorithm : a)));
  }

  return (
    <>
      <div className="setup-row">
        <label htmlFor="setup-bots">Número de bots</label>
        <select
          id="setup-bots"
          value={botAlgorithms.length}
          onChange={(e) => onBotAlgorithmsChange(resizeBotAlgorithms(botAlgorithms, Number(e.target.value)))}
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
              onClick={() => onRoundLimitChange(rounds)}
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
            onClick={() => onEditionChange('learning')}
          >
            Aprendizaje
          </button>
          <button
            type="button"
            className={`btn ${edition === 'classic' ? 'btn--primary' : 'btn--ghost'}`}
            aria-pressed={edition === 'classic'}
            onClick={() => onEditionChange('classic')}
          >
            Clásica
          </button>
          <button
            type="button"
            className={`btn ${edition === 'custom' ? 'btn--primary' : 'btn--ghost'}`}
            aria-pressed={edition === 'custom'}
            onClick={() => onEditionChange('custom')}
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
        {edition === 'learning' && onOpenTutorial && (
          <button className="btn btn--primary setup-tutorial-btn" type="button" onClick={onOpenTutorial}>
            🎓 Ver tutorial
          </button>
        )}
      </div>
    </>
  );
}
