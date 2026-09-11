import { useEffect, useRef, useState } from 'react';
import { getActivePlayer, getCard, scoreCardContributions, type Action, type CardInstance, type GameState, type Player, type PlayerScore } from '@zoo/engine';
import { CardView } from './CardView';
import { buyAnimalActionFor, buyCoinActionFor, playCardActionsFor } from '../lib/actionQuery';
import { BOT_ALGORITHM_OPTIONS } from '../lib/botAlgorithms';
import { buildPlayCardTargetChoice, type PendingChoice } from '../lib/pendingChoice';
import type { BotAlgorithm } from '../lib/gameConfig';

const PURCHASABLE_COIN_IDS = ['coin-2', 'coin-3', 'coin-5'];

export interface GameBoardProps {
  state: GameState;
  humanIds: string[];
  // Qué asiento es "el mío" en esta pantalla: pase-y-juega local lo va
  // recalculando (el humano activo, con memoria del último mientras juegan
  // los bots — ver App.tsx); online (host o invitado) es siempre el mismo
  // asiento fijo durante toda la partida.
  viewerPlayerId: string;
  isMyTurn: boolean;
  legalActions: Action[];
  scores: PlayerScore[];
  botAlgorithms: Record<string, BotAlgorithm>;
  canRestartTurn: boolean;
  doAction: (action: Action) => void;
  // Ausentes = ocultan el control correspondiente: online no ofrece
  // reiniciar turno (no hay foto local que restaurar) ni cambiar el
  // algoritmo de un bot desde una pestaña invitada.
  onNewGame?: () => void;
  onRestartTurn?: () => void;
  onSetBotAlgorithm?: (botId: string, algorithm: BotAlgorithm) => void;
}

export function GameBoard({
  state,
  humanIds,
  viewerPlayerId,
  isMyTurn,
  legalActions,
  scores,
  botAlgorithms,
  canRestartTurn,
  doAction,
  onNewGame,
  onRestartTurn,
  onSetBotAlgorithm,
}: GameBoardProps) {
  const activePlayer = getActivePlayer(state);
  const human = state.players.find((p) => p.id === viewerPlayerId) ?? state.players[0];
  const bots = state.players.filter((p) => !humanIds.includes(p.id));
  const scoreFor = (playerId: string) => scores.find((s) => s.playerId === playerId)?.score ?? 0;
  // Mientras la partida sigue en curso, el mazo de OTRO jugador humano es
  // información privada: solo se puede "ver el mazo" de un bot en cualquier
  // momento, del propio jugador que mira esta pantalla, o de cualquiera una
  // vez terminada la partida (el resumen final es público a propósito).
  function canViewPlayer(p: Player): boolean {
    return state.gameOver || !humanIds.includes(p.id) || p.id === viewerPlayerId;
  }
  const sortedAnimalTrack = [...state.animalTrack].sort(
    (a, b) => (a.marketCost ?? 0) - (b.marketCost ?? 0) || a.name.localeCompare(b.name)
  );

  const [pendingChoice, setPendingChoice] = useState<PendingChoice | null>(null);
  const [viewedPlayerId, setViewedPlayerId] = useState<string | null>(null);
  const choiceRef = useRef<HTMLDivElement>(null);
  const viewedPlayer = state.players.find((p) => p.id === viewedPlayerId) ?? null;

  useEffect(() => {
    setPendingChoice(null);
    setViewedPlayerId(null);
  }, [state.turn]);

  useEffect(() => {
    if (pendingChoice) choiceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [pendingChoice]);

  function runAction(action: Action | undefined) {
    if (!action) return;
    doAction(action);
    setPendingChoice(null);
  }

  function chooseOption(option: { action?: Action; next?: PendingChoice }) {
    if (option.next) {
      setPendingChoice(option.next);
      return;
    }
    runAction(option.action);
  }

  const purchasingPower =
    human.hand.filter((c) => c.type === 'coin').reduce((sum, c) => sum + (c.value ?? 0), 0) +
    human.bonusPurchasingPowerThisTurn;

  function handleRestartTurn() {
    onRestartTurn?.();
    setPendingChoice(null);
  }

  function handleHandCardClick(card: CardInstance) {
    if (!isMyTurn || card.type === 'coin') return;

    const acts = playCardActionsFor(legalActions, card.instanceId);
    if (acts.length === 0) return;
    if (acts.length === 1) {
      runAction(acts[0]);
      return;
    }
    setPendingChoice(buildPlayCardTargetChoice(acts, state, human, card));
  }

  function isHandCardClickable(card: CardInstance): boolean {
    if (!isMyTurn || card.type === 'coin') return false;
    return playCardActionsFor(legalActions, card.instanceId).length > 0;
  }

  function handleMarketCardClick(card: CardInstance) {
    if (!isMyTurn) return;
    runAction(buyAnimalActionFor(legalActions, card.instanceId));
  }

  function isMarketCardClickable(card: CardInstance): boolean {
    if (!isMyTurn) return false;
    return Boolean(buyAnimalActionFor(legalActions, card.instanceId));
  }

  function handleBuyCoinClick(coinId: string) {
    if (!isMyTurn) return;
    runAction(buyCoinActionFor(legalActions, coinId));
  }

  function isCoinShopClickable(coinId: string): boolean {
    if (!isMyTurn) return false;
    return Boolean(buyCoinActionFor(legalActions, coinId));
  }

  function groupedCollection(
    player: (typeof state.players)[number]
  ): { card: CardInstance; count: number; perCardPoints: number[] }[] {
    const all = [...player.deck, ...player.hand, ...player.discard, ...player.playedThisTurn];
    const contributions = scoreCardContributions(player);
    const byId = new Map<string, { card: CardInstance; count: number; perCardPoints: number[] }>();
    for (const card of all) {
      const points = contributions.get(card.instanceId) ?? 0;
      const entry = byId.get(card.id);
      if (entry) {
        entry.count += 1;
        entry.perCardPoints.push(points);
      } else {
        byId.set(card.id, { card, count: 1, perCardPoints: [points] });
      }
    }
    return [...byId.values()].sort(
      (a, b) => (a.card.marketCost ?? 0) - (b.card.marketCost ?? 0) || a.card.name.localeCompare(b.card.name)
    );
  }

  function groupedDestroyed(player: (typeof state.players)[number]): { card: CardInstance; count: number }[] {
    const byId = new Map<string, { card: CardInstance; count: number }>();
    for (const card of player.destroyedCards) {
      const entry = byId.get(card.id);
      if (entry) entry.count += 1;
      else byId.set(card.id, { card, count: 1 });
    }
    return [...byId.values()].sort(
      (a, b) => (a.card.marketCost ?? 0) - (b.card.marketCost ?? 0) || a.card.name.localeCompare(b.card.name)
    );
  }

  function pointsLabel(count: number, perCardPoints: number[]): string {
    const [first, ...rest] = perCardPoints;
    const allEqual = rest.every((p) => p === first);
    if (count > 1 && allEqual) return `${count}× ${first} PV`;
    const total = perCardPoints.reduce((sum, p) => sum + p, 0);
    return `${total} PV`;
  }

  function habitatCounts(player: (typeof state.players)[number]): { land: number; bird: number; aquatic: number } {
    const all = [...player.deck, ...player.hand, ...player.discard, ...player.playedThisTurn].filter(
      (c) => c.type === 'animal'
    );
    return {
      land: all.filter((c) => c.habitats?.includes('land')).length,
      bird: all.filter((c) => c.habitats?.includes('bird')).length,
      aquatic: all.filter((c) => c.habitats?.includes('aquatic')).length,
    };
  }

  function deckValue(player: (typeof state.players)[number]): number {
    return [...player.deck, ...player.hand, ...player.discard, ...player.playedThisTurn].reduce(
      (sum, c) => sum + (c.marketCost ?? 0),
      0
    );
  }

  return (
    <div className="app">
      {state.gameOver && (
        <div className="panel">
          <div className="panel__header">
            <h2>Resumen de la partida</h2>
          </div>
          <p>
            {(() => {
              const best = Math.max(...scores.map((s) => s.score));
              const winners = state.players.filter((p) => scoreFor(p.id) === best);
              return winners.length > 1
                ? `Empate entre ${winners.map((w) => w.name).join(' y ')} con ${best} PV.`
                : `${winners[0]?.name} gana con ${best} PV.`;
            })()}
          </p>
          <div className="summary-table-wrap">
            <table className="summary-table">
              <thead>
                <tr>
                  <th>Jugador</th>
                  <th>PV</th>
                  <th>Valor baraja</th>
                  <th>Compras</th>
                  <th>Terrestres</th>
                  <th>Voladores</th>
                  <th>Acuáticos</th>
                  <th>Turno con más dinero</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {state.players.map((p) => {
                  const habitats = habitatCounts(p);
                  return (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.name}</strong>
                      </td>
                      <td>{scoreFor(p.id)}</td>
                      <td>{deckValue(p)}</td>
                      <td>{p.purchasesCount}</td>
                      <td>{habitats.land}</td>
                      <td>{habitats.bird}</td>
                      <td>{habitats.aquatic}</td>
                      <td>
                        {p.richestTurn
                          ? `Ronda ${p.richestTurn.round} · ${p.richestTurn.amount} moneda${p.richestTurn.amount === 1 ? '' : 's'}`
                          : '—'}
                      </td>
                      <td>
                        <button className="btn btn--ghost" onClick={() => setViewedPlayerId(p.id)}>
                          Ver mazo →
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="layout">
        <div className="layout__left">
          <div className="panel">
            <div className="status-row">
              {state.gameOver ? (
                <span className="status-pill status-pill--over">Partida terminada</span>
              ) : (
                <span className="status-pill">
                  Ronda {state.round}/{state.maxRounds ?? '∞'} —{' '}
                  {isMyTurn ? `turno de ${activePlayer.name}` : `esperando a ${activePlayer.name}`}
                </span>
              )}
              {onNewGame && (
                <button className="btn btn--ghost" onClick={onNewGame}>
                  ↺ Nueva partida
                </button>
              )}
            </div>

            <ul className="scoreboard">
              {state.players.map((p) => {
                const clickable = canViewPlayer(p);
                return (
                  <li
                    key={p.id}
                    className={[p.id === viewerPlayerId && 'scoreboard__me', clickable && 'scoreboard__clickable']
                      .filter(Boolean)
                      .join(' ')}
                    onClick={clickable ? () => setViewedPlayerId(p.id) : undefined}
                    title={clickable ? 'Ver mazo' : 'Mazo privado hasta que termine la partida'}
                  >
                    <strong>{p.name}</strong>: {scoreFor(p.id)} PV
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="panel">
            <div className="turn-controls">
              <span className="chip chip--resource">
                💰 Valor de compra: {purchasingPower} moneda{purchasingPower === 1 ? '' : 's'}
              </span>
              {human.aquaticBonusPurchasingPowerThisTurn > 0 && (
                <span className="chip chip--resource" title="Solo se puede gastar en animales acuáticos">
                  🌊 Solo acuáticos: {human.aquaticBonusPurchasingPowerThisTurn} moneda
                  {human.aquaticBonusPurchasingPowerThisTurn === 1 ? '' : 's'}
                </span>
              )}
              <button
                className="btn btn--primary"
                disabled={!isMyTurn}
                onClick={() => runAction(legalActions.find((a) => a.type === 'endTurn'))}
              >
                Terminar turno
              </button>
              {onRestartTurn && (
                <button className="btn btn--ghost" disabled={!canRestartTurn} onClick={handleRestartTurn}>
                  ↺ Reiniciar turno
                </button>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel__header">
              <h2>Tu mano</h2>
              <span className="panel__hint">
                {human.hand.length} cartas · 🂠 {human.deck.length} en el mazo · 🗑️ {human.discard.length} en el
                descarte
              </span>
            </div>
            <div className="card-row card-row--hand">
              {human.hand.map((card) => (
                <CardView
                  key={card.instanceId}
                  card={card}
                  onClick={isMyTurn && card.type !== 'coin' ? () => handleHandCardClick(card) : undefined}
                  disabled={card.type !== 'coin' && !isHandCardClickable(card)}
                />
              ))}
              {human.hand.length === 0 && <span className="market-empty">(vacía)</span>}
            </div>
          </div>

          {pendingChoice && (
            <div className="panel panel--choice" ref={choiceRef}>
              <div className="panel__header">
                <h2>{pendingChoice.title}</h2>
                <button className="btn btn--ghost" onClick={() => setPendingChoice(null)}>
                  ✕ cancelar
                </button>
              </div>
              <div className="action-list">
                {pendingChoice.options.map((opt, i) => (
                  <button
                    key={i}
                    className={['btn', 'btn--primary', opt.accentClassName].filter(Boolean).join(' ')}
                    disabled={!opt.action && !opt.next}
                    onClick={() => chooseOption(opt)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="layout__right">
          <div className="panel">
            <div className="card-row card-row--market">
              {sortedAnimalTrack.map((card) => (
                <CardView
                  key={card.instanceId}
                  card={card}
                  onClick={isMyTurn ? () => handleMarketCardClick(card) : undefined}
                  disabled={!isMarketCardClickable(card)}
                  remainingLabel={String((state.sharedDecks[card.species ?? ''] ?? []).length + 1)}
                />
              ))}
              {PURCHASABLE_COIN_IDS.map((coinId) => {
                const card = { ...getCard(coinId), instanceId: coinId } as CardInstance;
                return (
                  <CardView
                    key={coinId}
                    card={card}
                    onClick={isMyTurn ? () => handleBuyCoinClick(coinId) : undefined}
                    disabled={!isCoinShopClickable(coinId)}
                    remainingLabel="∞"
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <details className="log-details" open>
        <summary>Log de la partida</summary>
        <pre>{state.log.slice(-40).join('\n')}</pre>
      </details>

      <div className="panel">
        <div className="panel__header">
          <h2>Bots</h2>
        </div>
        <div className="player-strip">
          {bots.map((bot) => (
            <span key={bot.id} className="chip">
              <strong>{bot.name}</strong> · mano: {bot.hand.length} · descarte: {bot.discard.length}
              {onSetBotAlgorithm ? (
                <select
                  className="bot-algorithm-select"
                  value={botAlgorithms[bot.id] ?? 'rl'}
                  onChange={(e) => onSetBotAlgorithm(bot.id, e.target.value as BotAlgorithm)}
                >
                  {BOT_ALGORITHM_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="chip__hint">
                  {' '}
                  · {BOT_ALGORITHM_OPTIONS.find((o) => o.value === botAlgorithms[bot.id])?.label ?? botAlgorithms[bot.id]}
                </span>
              )}
            </span>
          ))}
        </div>
      </div>

      {viewedPlayer && (
        <div className="modal-backdrop" onClick={() => setViewedPlayerId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel__header">
              <h2>
                Mazo de {viewedPlayer.name} · {groupedCollection(viewedPlayer).reduce((n, e) => n + e.count, 0)}{' '}
                cartas · {scoreFor(viewedPlayer.id)} PV
              </h2>
              <button className="btn btn--ghost" onClick={() => setViewedPlayerId(null)}>
                ✕ cerrar
              </button>
            </div>
            <div className="card-row">
              {groupedCollection(viewedPlayer).map(({ card, count, perCardPoints }) => {
                const total = perCardPoints.reduce((sum, p) => sum + p, 0);
                return (
                  <div key={card.id} className="collection-entry">
                    <CardView card={card} />
                    {count > 1 && <span className="collection-entry__count">×{count}</span>}
                    <div
                      className={['collection-entry__points', total < 0 && 'collection-entry__points--negative']
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {pointsLabel(count, perCardPoints)}
                    </div>
                  </div>
                );
              })}
            </div>
            {viewedPlayer.destroyedCards.length > 0 && (
              <div className="collection-destroyed">
                <p className="collection-destroyed__title">
                  🐊 Eliminadas por el Cocodrilo ({viewedPlayer.destroyedCards.length}, ya no puntúan)
                </p>
                <div className="card-row">
                  {groupedDestroyed(viewedPlayer).map(({ card, count }) => (
                    <div key={card.id} className="collection-entry">
                      <CardView card={card} destroyed />
                      {count > 1 && <span className="collection-entry__count">×{count}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
