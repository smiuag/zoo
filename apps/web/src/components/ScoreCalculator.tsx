import { useState } from 'react';

interface ScoreCalculatorProps {
  onClose: () => void;
}

// Las 6 cartas cuyo PV final depende de un conteo (ver
// packages/engine/src/effects/registry.ts, scorePer*): cada una MULTIPLICA
// (nº copias de la carta bonus) × (nº de lo que cuenta), no suma — de ahí que
// cada fila 'product' tenga 2 casillas en vez de 1. La fila 'direct' es solo
// el PV ya impreso en cada carta (animales + bellotas), que se suma tal cual.
interface ScoreRowDef {
  key: string;
  label: string;
  icon: string;
  hint: string;
  kind: 'direct' | 'product';
  f1?: string;
  f2?: string;
}

const ROWS: ScoreRowDef[] = [
  { key: 'direct', label: 'Puntos directos', icon: '🌰', kind: 'direct', hint: 'PV impreso en animales y bellotas' },
  { key: 'eagle', label: 'Águila', icon: '🦅', kind: 'product', hint: 'nº Águilas × nº voladores', f1: 'águilas', f2: 'voladores' },
  {
    key: 'polarbear',
    label: 'Oso polar',
    icon: '🐻‍❄️',
    kind: 'product',
    hint: 'nº Osos polares × nº terrestres',
    f1: 'osos polares',
    f2: 'terrestres',
  },
  { key: 'orca', label: 'Orca', icon: '🐋', kind: 'product', hint: 'nº Orcas × nº acuáticos', f1: 'orcas', f2: 'acuáticos' },
  {
    key: 'albatross',
    label: 'Albatros',
    icon: '🕊️',
    kind: 'product',
    hint: 'nº Albatros × nº especies distintas',
    f1: 'albatros',
    f2: 'especies',
  },
  {
    key: 'toucan',
    label: 'Tucán',
    icon: '🦜',
    kind: 'product',
    hint: 'nº Tucanes × nº animales de coste 5+',
    f1: 'tucanes',
    f2: 'coste 5+',
  },
  {
    key: 'shark',
    label: 'Tiburón',
    icon: '🦈',
    kind: 'product',
    hint: 'nº Tiburones × nº cartas de bellota',
    f1: 'tiburones',
    f2: 'bellotas',
  },
];

const PRODUCT_ROWS = ROWS.filter((r) => r.kind === 'product');

interface PlayerScoreState {
  id: number;
  name: string;
  direct: string;
  factors: Record<string, [string, string]>;
}

let nextPlayerId = 1;

function emptyPlayer(name: string): PlayerScoreState {
  return {
    id: nextPlayerId++,
    name,
    direct: '',
    factors: Object.fromEntries(PRODUCT_ROWS.map((r) => [r.key, ['', ''] as [string, string]])),
  };
}

function num(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function totalFor(player: PlayerScoreState): number {
  let total = num(player.direct);
  for (const row of PRODUCT_ROWS) {
    const [a, b] = player.factors[row.key] ?? ['', ''];
    total += num(a) * num(b);
  }
  return total;
}

// Calculadora suelta para puntuar a mano una partida FÍSICA (impresa), desde
// el móvil — no lee ni escribe ningún estado de partida de la app (ver
// pedido explícito del usuario: "no de partidas de la app"), solo hace la
// aritmética de las 6 cartas de conteo. nº de jugadores libre (añadir/quitar
// tarjeta), no limitado a los 4 humanos de una partida real.
export function ScoreCalculator({ onClose }: ScoreCalculatorProps) {
  const [players, setPlayers] = useState<PlayerScoreState[]>(() => [emptyPlayer('Jugador 1'), emptyPlayer('Jugador 2')]);

  function addPlayer() {
    setPlayers((prev) => [...prev, emptyPlayer(`Jugador ${prev.length + 1}`)]);
  }

  function removePlayer(id: number) {
    setPlayers((prev) => (prev.length <= 1 ? prev : prev.filter((p) => p.id !== id)));
  }

  function updateName(id: number, name: string) {
    setPlayers((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
  }

  function updateDirect(id: number, value: string) {
    setPlayers((prev) => prev.map((p) => (p.id === id ? { ...p, direct: value } : p)));
  }

  function updateFactor(id: number, rowKey: string, slot: 0 | 1, value: string) {
    setPlayers((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const current = p.factors[rowKey] ?? ['', ''];
        const next: [string, string] = slot === 0 ? [value, current[1]] : [current[0], value];
        return { ...p, factors: { ...p.factors, [rowKey]: next } };
      })
    );
  }

  return (
    <div className="app app--setup">
      <div className="panel setup-panel setup-panel--wide">
        <div className="panel__header">
          <h2>🌰 Marcador final</h2>
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            ✕ cerrar
          </button>
        </div>

        <p className="setup-hint">
          Una tarjeta por jugador con lo que tenga en su colección (mazo + mano + descarte) al terminar la partida.
          Las filas con dos casillas se multiplican solas.
        </p>
        <p className="setup-hint score-warning">
          🐊 ¿Alguien tiene Cocodrilo? Antes de contar, esa persona retira de su colección su animal no volador de
          menor coste — deja de contar en cualquier fila.
        </p>

        <div className="score-players">
          {players.map((player) => (
            <div key={player.id} className="score-card">
              <div className="score-card__header">
                <input
                  className="score-card__name"
                  type="text"
                  value={player.name}
                  onChange={(e) => updateName(player.id, e.target.value)}
                  aria-label="Nombre del jugador"
                />
                {players.length > 1 && (
                  <button
                    className="btn btn--ghost score-card__remove"
                    type="button"
                    title="Quitar jugador"
                    aria-label={`Quitar a ${player.name}`}
                    onClick={() => removePlayer(player.id)}
                  >
                    🗑
                  </button>
                )}
              </div>

              {ROWS.map((row) => (
                <div key={row.key} className="score-row">
                  <span className="score-row__label">
                    <span aria-hidden="true">{row.icon}</span> {row.label}
                    <small>{row.hint}</small>
                  </span>

                  {row.kind === 'direct' ? (
                    <input
                      className="score-input"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      placeholder="0"
                      value={player.direct}
                      onChange={(e) => updateDirect(player.id, e.target.value)}
                      aria-label={`${row.label} de ${player.name}`}
                    />
                  ) : (
                    <div className="score-formula">
                      <input
                        className="score-input"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        placeholder="0"
                        value={player.factors[row.key]?.[0] ?? ''}
                        onChange={(e) => updateFactor(player.id, row.key, 0, e.target.value)}
                        aria-label={`nº ${row.f1} de ${player.name}`}
                      />
                      <span className="score-formula__sign">×</span>
                      <input
                        className="score-input"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        placeholder="0"
                        value={player.factors[row.key]?.[1] ?? ''}
                        onChange={(e) => updateFactor(player.id, row.key, 1, e.target.value)}
                        aria-label={`nº ${row.f2} de ${player.name}`}
                      />
                      <span className="score-formula__sign">=</span>
                      <span className="score-formula__result">
                        {num(player.factors[row.key]?.[0] ?? '') * num(player.factors[row.key]?.[1] ?? '')}
                      </span>
                    </div>
                  )}
                </div>
              ))}

              <div className="score-row score-row--total">
                <span className="score-row__label">🏆 Total</span>
                <span className="score-total">{totalFor(player)}</span>
              </div>
            </div>
          ))}
        </div>

        <button className="btn btn--ghost" type="button" onClick={addPlayer}>
          ➕ Añadir jugador
        </button>
      </div>
    </div>
  );
}
