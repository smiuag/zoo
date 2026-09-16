import { useEffect, useState } from 'react';
import { getCard, type CardInstance } from '@zoo/engine';
import {
  fetchMyHistory,
  fetchTopScores,
  type DeckSummaryEntry,
  type GameMode,
  type GameResultRow,
} from '../online/gameResults';
import { isOnlineAvailable } from '../online/supabaseClient';
import { DEFAULT_ROUND_LIMIT, ROUND_LIMIT_OPTIONS } from '../lib/gameConfig';
import { CardView } from './CardView';

interface RankingProps {
  onClose: () => void;
}

const MODE_LABEL: Record<GameMode, string> = { solo: 'Solitario', local: 'Local', online: '🌐 Online' };

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });
  } catch {
    return iso;
  }
}

function positionLabel(position: number | null): string {
  if (position === null) return '—';
  if (position === 1) return '🥇 1º';
  if (position === 2) return '🥈 2º';
  if (position === 3) return '🥉 3º';
  return `${position}º`;
}

// Reconstruye una carta "jugable" a partir de un id guardado en la baraja
// (ver DeckSummaryEntry): null si ese id ya no existe en los datos de carta
// actuales (rebalance/especie retirada desde que se guardó esa partida) —
// se descarta esa entrada en vez de reventar toda la vista.
function toCardInstance(id: string): CardInstance | null {
  try {
    return { ...getCard(id), instanceId: id };
  } catch {
    return null;
  }
}

function ResultsTable({
  rows,
  showMedals,
  showRounds,
  onViewDeck,
}: {
  rows: GameResultRow[];
  showMedals: boolean;
  showRounds: boolean;
  onViewDeck: (deck: DeckSummaryEntry[]) => void;
}) {
  if (rows.length === 0) {
    return <p className="market-empty">Todavía no hay partidas registradas aquí.</p>;
  }
  return (
    <div className="summary-table-wrap">
      <table className="summary-table">
        <thead>
          <tr>
            {showMedals && <th></th>}
            <th>Nick</th>
            <th>PV</th>
            <th>Puesto</th>
            <th>Jugadores</th>
            {showRounds && <th>Rondas</th>}
            <th>Modo</th>
            <th>Fecha</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {showMedals && <td aria-hidden="true">{i === 0 ? '🏆' : i === 1 ? '🥈' : i === 2 ? '🥉' : ''}</td>}
              <td>
                <strong>{row.nick}</strong>
              </td>
              <td>{row.score}</td>
              <td>{positionLabel(row.position)}</td>
              <td>{row.num_players}</td>
              {showRounds && <td>{row.round_limit ?? '—'}</td>}
              <td>{MODE_LABEL[row.mode]}</td>
              <td>{formatDate(row.created_at)}</td>
              <td>
                {row.deck && row.deck.length > 0 && (
                  <button className="btn btn--ghost" type="button" onClick={() => onViewDeck(row.deck!)}>
                    Ver baraja
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Ranking (pedido explícito del usuario, sin autenticar a nadie): dos
// listas de solo lectura sobre la tabla game_results de Supabase (ver
// online/gameResults.ts + supabase/game_results.sql) — top puntuaciones
// públicas por nick, y el histórico de ESTE dispositivo (ver
// lib/deviceId.ts). Pantalla completa igual que ScoreCalculator.tsx, sin
// ninguna relación con la partida en curso.
//
// El "top" se separa en una pestaña POR duración (ROUND_LIMIT_OPTIONS): una
// partida a 10 rondas y otra a 20 no son comparables por puntuación bruta
// (pedido explícito del usuario), así que mezclarlas en un único ranking
// premiaría siempre a las partidas más largas.
export function Ranking({ onClose }: RankingProps) {
  const [tab, setTab] = useState<'top' | 'mine'>('top');
  const [roundsTab, setRoundsTab] = useState<number>(DEFAULT_ROUND_LIMIT);
  const [topByRounds, setTopByRounds] = useState<Partial<Record<number, GameResultRow[]>>>({});
  const [myHistory, setMyHistory] = useState<GameResultRow[] | null>(null);
  const [viewedDeck, setViewedDeck] = useState<DeckSummaryEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    for (const rounds of ROUND_LIMIT_OPTIONS) {
      fetchTopScores(rounds).then((rows) => {
        if (!cancelled) setTopByRounds((prev) => ({ ...prev, [rounds]: rows }));
      });
    }
    fetchMyHistory().then((rows) => {
      if (!cancelled) setMyHistory(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const deckCards = viewedDeck
    ?.map((entry) => ({ instance: toCardInstance(entry.id), count: entry.count }))
    .filter((e): e is { instance: CardInstance; count: number } => e.instance !== null)
    .sort((a, b) => (a.instance.marketCost ?? 0) - (b.instance.marketCost ?? 0) || a.instance.name.localeCompare(b.instance.name));

  return (
    <div className="app app--setup">
      <div className="panel setup-panel setup-panel--wide">
        <div className="panel__header">
          <h2>🏆 Ranking</h2>
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            ✕ cerrar
          </button>
        </div>

        {!isOnlineAvailable && (
          <p className="setup-hint">No configurado en este despliegue (falta VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY).</p>
        )}

        <div className="score-tabs">
          <button type="button" className={`score-tab ${tab === 'top' ? 'score-tab--active' : ''}`} onClick={() => setTab('top')}>
            Top puntuaciones
          </button>
          <button type="button" className={`score-tab ${tab === 'mine' ? 'score-tab--active' : ''}`} onClick={() => setTab('mine')}>
            Mis partidas
          </button>
        </div>

        {tab === 'top' && (
          <div className="score-tabs score-tabs--secondary">
            {ROUND_LIMIT_OPTIONS.map((rounds) => (
              <button
                key={rounds}
                type="button"
                className={`score-tab ${roundsTab === rounds ? 'score-tab--active' : ''}`}
                onClick={() => setRoundsTab(rounds)}
              >
                {rounds} rondas
              </button>
            ))}
          </div>
        )}

        {tab === 'top' ? (
          topByRounds[roundsTab] === undefined ? (
            <p className="setup-hint">Cargando...</p>
          ) : (
            <ResultsTable rows={topByRounds[roundsTab]!} showMedals showRounds={false} onViewDeck={setViewedDeck} />
          )
        ) : myHistory === null ? (
          <p className="setup-hint">Cargando...</p>
        ) : (
          <ResultsTable rows={myHistory} showMedals={false} showRounds onViewDeck={setViewedDeck} />
        )}
      </div>

      {viewedDeck && (
        <div className="modal-backdrop" onClick={() => setViewedDeck(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel__header">
              <h2>Baraja · {viewedDeck.reduce((n, e) => n + e.count, 0)} cartas</h2>
              <button className="btn btn--ghost" onClick={() => setViewedDeck(null)}>
                ✕ cerrar
              </button>
            </div>
            <div className="card-row">
              {deckCards?.map(({ instance, count }) => (
                <div key={instance.id} className="collection-entry">
                  <CardView card={instance} />
                  {count > 1 && <span className="collection-entry__count">×{count}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
