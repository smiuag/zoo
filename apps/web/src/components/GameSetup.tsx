import { useState } from 'react';
import { BOT_ALGORITHM_OPTIONS } from '../lib/botAlgorithms';
import {
  DEFAULT_BOT_ALGORITHMS_BY_SEAT,
  DEFAULT_ROUND_LIMIT,
  MAX_BOTS,
  MAX_HUMANS,
  MIN_BOTS,
  MIN_HUMANS,
  MIN_TOTAL_PLAYERS,
  ROUND_LIMIT_OPTIONS,
  type BotAlgorithm,
  type GameConfig,
  type RoundLimit,
} from '../lib/gameConfig';

interface GameSetupProps {
  onStart: (config: GameConfig) => void;
}

// Alarga o recorta la lista de algoritmos al nuevo nº de bots, conservando
// lo ya elegido para los huecos que se mantienen (solo se pierde/genera lo
// que cambia), en vez de resetear todo el formulario cada vez que se toca
// el número de bots.
function resizeBotAlgorithms(current: BotAlgorithm[], count: number): BotAlgorithm[] {
  if (count <= current.length) return current.slice(0, count);
  const extra = Array.from(
    { length: count - current.length },
    (_, i) => DEFAULT_BOT_ALGORITHMS_BY_SEAT[(current.length + i) % DEFAULT_BOT_ALGORITHMS_BY_SEAT.length]
  );
  return [...current, ...extra];
}

export function GameSetup({ onStart }: GameSetupProps) {
  const [numHumans, setNumHumans] = useState(1);
  const [botAlgorithms, setBotAlgorithms] = useState<BotAlgorithm[]>(DEFAULT_BOT_ALGORITHMS_BY_SEAT.slice(0, 4));
  const [roundLimit, setRoundLimit] = useState<RoundLimit>(DEFAULT_ROUND_LIMIT);

  const totalPlayers = numHumans + botAlgorithms.length;
  const canStart = totalPlayers >= MIN_TOTAL_PLAYERS;

  function handleNumHumansChange(value: number) {
    setNumHumans(value);
  }

  function handleNumBotsChange(value: number) {
    setBotAlgorithms((prev) => resizeBotAlgorithms(prev, value));
  }

  function handleBotAlgorithmChange(index: number, algorithm: BotAlgorithm) {
    setBotAlgorithms((prev) => prev.map((a, i) => (i === index ? algorithm : a)));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canStart) return;
    onStart({ numHumans, botAlgorithms, roundLimit });
  }

  return (
    <div className="app app--setup">
      <form className="panel setup-panel" onSubmit={handleSubmit}>
        <div className="panel__header">
          <h2>Nueva partida</h2>
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
              Turno rotatorio en este mismo dispositivo: cuando le toque a cada jugador, se le pedirá pasar el
              turno antes de ver su mano.
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
          <label htmlFor="setup-rounds">Duración</label>
          <select
            id="setup-rounds"
            value={roundLimit}
            onChange={(e) => setRoundLimit(Number(e.target.value) as RoundLimit)}
          >
            {ROUND_LIMIT_OPTIONS.map((rounds) => (
              <option key={rounds} value={rounds}>
                {rounds} rondas
              </option>
            ))}
          </select>
        </div>

        {!canStart && (
          <p className="setup-error">
            Con 1 solo jugador humano hace falta al menos 1 bot rival: sube el número de bots o de jugadores.
          </p>
        )}

        <button className="btn btn--primary" type="submit" disabled={!canStart}>
          Empezar partida
        </button>
      </form>
    </div>
  );
}
