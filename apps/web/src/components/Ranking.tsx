import { useEffect, useState } from 'react';
import { fetchMyHistory, fetchTopScores, type GameMode, type GameResultRow } from '../online/gameResults';
import { isOnlineAvailable } from '../online/supabaseClient';

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

function ResultsTable({ rows, showMedals }: { rows: GameResultRow[]; showMedals: boolean }) {
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
            <th>Jugadores</th>
            <th>Modo</th>
            <th>Fecha</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {showMedals && (
                <td aria-hidden="true">{i === 0 ? '🏆' : i === 1 ? '🥈' : i === 2 ? '🥉' : ''}</td>
              )}
              <td>
                <strong>{row.nick}</strong>
              </td>
              <td>{row.score}</td>
              <td>{row.num_players}</td>
              <td>{MODE_LABEL[row.mode]}</td>
              <td>{formatDate(row.created_at)}</td>
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
export function Ranking({ onClose }: RankingProps) {
  const [tab, setTab] = useState<'top' | 'mine'>('top');
  const [topScores, setTopScores] = useState<GameResultRow[] | null>(null);
  const [myHistory, setMyHistory] = useState<GameResultRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTopScores().then((rows) => {
      if (!cancelled) setTopScores(rows);
    });
    fetchMyHistory().then((rows) => {
      if (!cancelled) setMyHistory(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

        {tab === 'top' ? (
          topScores === null ? (
            <p className="setup-hint">Cargando...</p>
          ) : (
            <ResultsTable rows={topScores} showMedals />
          )
        ) : myHistory === null ? (
          <p className="setup-hint">Cargando...</p>
        ) : (
          <ResultsTable rows={myHistory} showMedals={false} />
        )}
      </div>
    </div>
  );
}
