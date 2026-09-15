import { useEffect, useState } from 'react';

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
const MEDALS = ['🥇', '🥈', '🥉'];

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
// aritmética de las 6 cartas de conteo. nº de jugadores libre (añadir/quitar),
// no limitado a los 4 humanos de una partida real.
//
// Flujo pensado para rellenar de uno en uno con el móvil en la mano (pedido
// explícito del usuario): una pestaña por jugador + "Resultado final", nunca
// todas las tarjetas a la vez — eso obligaba a hacer scroll horizontal o
// dejaba los campos demasiado pequeños en pantallas estrechas.
export function ScoreCalculator({ onClose }: ScoreCalculatorProps) {
  const [players, setPlayers] = useState<PlayerScoreState[]>(() => [emptyPlayer('Jugador 1'), emptyPlayer('Jugador 2')]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [mode, setMode] = useState<'edit' | 'summary'>('edit');

  // Al cambiar de jugador (añadir uno, pestaña siguiente/anterior, elegir
  // una pestaña) se sube al principio de la pantalla: si se venía de rellenar
  // filas más abajo del jugador anterior, sin esto el nuevo jugador aparecía
  // a medio scroll en vez de arrancar por su nombre y "Puntos directos",
  // rompiendo el orden de rellenar uno detrás de otro.
  useEffect(() => {
    if (mode === 'edit') window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [activeIndex, mode]);

  function addPlayer() {
    setPlayers((prev) => {
      const next = [...prev, emptyPlayer(`Jugador ${prev.length + 1}`)];
      setActiveIndex(next.length - 1);
      return next;
    });
    setMode('edit');
  }

  function removePlayer(index: number) {
    setPlayers((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((_, i) => i !== index);
      setActiveIndex((i) => Math.min(i, next.length - 1));
      return next;
    });
  }

  function updateActive(patch: Partial<PlayerScoreState>) {
    setPlayers((prev) => prev.map((p, i) => (i === activeIndex ? { ...p, ...patch } : p)));
  }

  function updateFactor(rowKey: string, slot: 0 | 1, value: string) {
    setPlayers((prev) =>
      prev.map((p, i) => {
        if (i !== activeIndex) return p;
        const current = p.factors[rowKey] ?? ['', ''];
        const next: [string, string] = slot === 0 ? [value, current[1]] : [current[0], value];
        return { ...p, factors: { ...p.factors, [rowKey]: next } };
      })
    );
  }

  function openPlayer(index: number) {
    setActiveIndex(index);
    setMode('edit');
  }

  const active = players[activeIndex];
  const ranked = [...players].map((p, i) => ({ p, i, total: totalFor(p) })).sort((a, b) => b.total - a.total);

  return (
    <div className="app app--setup">
      <div className="panel setup-panel setup-panel--wide">
        <div className="panel__header">
          <h2>🌰 Marcador final</h2>
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            ✕ cerrar
          </button>
        </div>

        <div className="score-tabs">
          {players.map((p, i) => (
            <button
              key={p.id}
              type="button"
              className={`score-tab ${mode === 'edit' && i === activeIndex ? 'score-tab--active' : ''}`}
              onClick={() => openPlayer(i)}
            >
              {p.name || `Jugador ${i + 1}`}
            </button>
          ))}
        </div>

        {mode === 'summary' || !active ? (
          <div className="score-summary">
            <h3>🏆 Resultado final</h3>
            {ranked.map((entry, rank) => (
              <div
                key={entry.p.id}
                className={`score-summary-item ${rank === 0 && ranked.length > 1 ? 'score-summary-item--winner' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => openPlayer(entry.i)}
                onKeyDown={(e) => e.key === 'Enter' && openPlayer(entry.i)}
              >
                <span className="score-summary-rank">{MEDALS[rank] ?? `${rank + 1}º`}</span>
                <span className="score-summary-name">
                  {entry.p.name || `Jugador ${entry.i + 1}`}
                  <small>Puntos directos {num(entry.p.direct)} + bonus de conteo</small>
                </span>
                <span className="score-summary-total">{entry.total}</span>
              </div>
            ))}
            <div className="score-summary-actions">
              <button className="btn" type="button" onClick={() => setMode('edit')}>
                ✏️ Volver a editar
              </button>
            </div>
          </div>
        ) : (
          <div className="score-form">
            <div className="score-form__header">
              <input
                className="score-name"
                type="text"
                value={active.name}
                onChange={(e) => updateActive({ name: e.target.value })}
                aria-label="Nombre del jugador"
              />
              {players.length > 1 && (
                <button
                  className="icon-btn"
                  type="button"
                  title="Quitar jugador"
                  aria-label={`Quitar a ${active.name}`}
                  onClick={() => removePlayer(activeIndex)}
                >
                  🗑
                </button>
              )}
            </div>

            {ROWS.map((row) => (
              <div key={row.key} className="score-row">
                <span className="score-row__label">
                  <span className="score-row__title">
                    <span aria-hidden="true">{row.icon}</span>
                    <span>{row.label}</span>
                  </span>
                  <small>{row.hint}</small>
                </span>

                {row.kind === 'direct' ? (
                  <input
                    className="score-input"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    placeholder="0"
                    value={active.direct}
                    onChange={(e) => updateActive({ direct: e.target.value })}
                    aria-label={`${row.label} de ${active.name}`}
                  />
                ) : (
                  <div className="score-formula">
                    <input
                      className="score-input"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      placeholder="0"
                      value={active.factors[row.key]?.[0] ?? ''}
                      onChange={(e) => updateFactor(row.key, 0, e.target.value)}
                      aria-label={`nº ${row.f1} de ${active.name}`}
                    />
                    <span className="score-formula__sign">×</span>
                    <input
                      className="score-input"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      placeholder="0"
                      value={active.factors[row.key]?.[1] ?? ''}
                      onChange={(e) => updateFactor(row.key, 1, e.target.value)}
                      aria-label={`nº ${row.f2} de ${active.name}`}
                    />
                    <span className="score-formula__sign">=</span>
                    <span className="score-formula__result">
                      {num(active.factors[row.key]?.[0] ?? '') * num(active.factors[row.key]?.[1] ?? '')}
                    </span>
                  </div>
                )}
              </div>
            ))}

            <div className="score-row score-row--total">
              <span className="score-row__label">
                <span className="score-row__title">
                  <span aria-hidden="true">🌰</span>
                  <span>Total de {active.name || 'este jugador'}</span>
                </span>
              </span>
              <span className="score-total">{totalFor(active)}</span>
            </div>

            <div className="score-nav">
              <button className="btn" type="button" disabled={activeIndex === 0} onClick={() => setActiveIndex((i) => i - 1)}>
                ◀ Anterior
              </button>
              {activeIndex === players.length - 1 ? (
                <button className="btn" type="button" onClick={addPlayer}>
                  ➕ Otro jugador
                </button>
              ) : (
                <button className="btn" type="button" onClick={() => setActiveIndex((i) => i + 1)}>
                  Siguiente ▶
                </button>
              )}
            </div>

            <button className="btn btn--primary score-finish" type="button" onClick={() => setMode('summary')}>
              🏁 Finalizar y ver resultado
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
