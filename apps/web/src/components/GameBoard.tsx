import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  getActivePlayer,
  getCard,
  scoreCardContributions,
  type Action,
  type CardInstance,
  type GameState,
  type Player,
  type PlayerScore,
} from '@zoo/engine';
import { ActivePlayerBoard } from './ActivePlayerBoard';
import { CardView } from './CardView';
import { FlyingCard, type FlightSpec } from './FlyingCard';
import { buyAnimalActionFor, buyCoinActionFor, playCardActionsFor, resolveDiscardActionFor } from '../lib/actionQuery';
import { BOT_ALGORITHM_OPTIONS } from '../lib/botAlgorithms';
import { buildPlayCardTargetChoice, type PendingChoice } from '../lib/pendingChoice';
import type { BotAlgorithm } from '../lib/gameConfig';

// Cuántas rondas del final se consideran "recta final" (contador de ronda
// en rojo, ver .status-pill__round--final).
const FINAL_ROUNDS_WARNING = 5;

const PURCHASABLE_COIN_IDS = ['coin-2', 'coin-3', 'coin-5'];

export interface GameBoardProps {
  state: GameState;
  humanIds: string[];
  // Qué asiento es "el mío" en esta pantalla: pase-y-juega local lo va
  // recalculando (el humano activo, con memoria del último mientras juegan
  // los bots — ver App.tsx); online (host o invitado) es siempre el mismo
  // asiento fijo durante toda la partida.
  viewerPlayerId: string;
  legalActions: Action[];
  scores: PlayerScore[];
  botAlgorithms: Record<string, BotAlgorithm>;
  // Decidido al crear la partida (ver GameConfig): con esto desactivado no
  // se genera la animación de "vuelo" de compra (ver FlyingCard.tsx) — el
  // ritmo de 1s entre acciones de los bots se controla aparte, en
  // useGame.ts, con el mismo valor.
  animationsEnabled: boolean;
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
  legalActions,
  scores,
  botAlgorithms,
  animationsEnabled,
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

  // legalActions siempre son LAS DE ESTE VISOR concreto (ver App.tsx/
  // GuestApp.tsx): si tiene alguna, puede actuar ahora mismo, sea porque es
  // su turno o porque le toca resolver un descarte forzoso pendiente (ver
  // PendingDiscardDecision) aunque no tenga el turno. Nunca hay una mezcla
  // de ambos tipos de acción a la vez (ver el motor: un descarte pendiente
  // deja sin ninguna acción normal al jugador activo).
  const canAct = legalActions.length > 0;
  const owedDiscard = state.pendingDecision?.owed[viewerPlayerId];
  // Tiburón: la carta elegida vuelve al mercado en vez de ir al descarte —
  // solo cambia el texto mostrado, la mecánica de elegir es idéntica.
  const isReturnToMarket = state.pendingDecision?.kind === 'returnToMarket';
  const discardVerb = isReturnToMarket ? 'Devuelve' : 'Descarta';
  // Cartas de tu propia mano que puedes elegir ahora mismo para el
  // descarte pendiente (se muestran en el popup de abajo): se derivan de
  // legalActions, nunca de owedDiscard.eligibleInstanceIds directamente,
  // para que sea SIEMPRE justo lo que de verdad se puede pulsar.
  const eligibleDiscardCards = owedDiscard
    ? human.hand.filter((c) => resolveDiscardActionFor(legalActions, c.instanceId))
    : [];
  const discardSourcePlayerName = state.pendingDecision
    ? (state.players.find((p) => p.id === state.pendingDecision!.sourcePlayerId)?.name ?? '')
    : '';
  // A quién se está esperando para el banner de estado: si hay un descarte
  // pendiente, el primero de la lista que todavía lo deba (puede haber
  // varios a la vez, p. ej. el Buitre afecta a todos los rivales); si no,
  // el propio jugador activo.
  const waitingOnPlayer = state.pendingDecision
    ? (state.players.find((p) => p.id === Object.keys(state.pendingDecision!.owed)[0]) ?? activePlayer)
    : activePlayer;
  // Si el visor tiene el turno ahora mismo: decide dónde se ven el
  // mazo/descarte del jugador activo (que en ese caso es el propio visor) y
  // si tiene sentido mostrar los controles de turno (Terminar/Reiniciar) —
  // ver más abajo y ActivePlayerBoard.tsx.
  const isOwnTurn = activePlayer.id === viewerPlayerId;

  // --- Animación "vuelo" de compra: mercado -> descarte ------------------
  // Recuerda la última posición en pantalla de cada carta del mercado
  // mientras siga montada (ref-callback en cada render): al desaparecer
  // (comprada), esa última posición conocida se queda un instante en el
  // mapa, justo lo que hace falta para saber "de dónde viene volando".
  const marketRectsRef = useRef<Map<string, DOMRect>>(new Map());
  const discardPileRef = useRef<HTMLDivElement>(null);
  const [flights, setFlights] = useState<FlightSpec[]>([]);
  // Qué instanceId había en el descarte del jugador ACTIVO la última vez
  // (y de quién): para detectar cuáles son nuevos de un render a otro sin
  // comparar entre turnos de jugadores distintos.
  const prevActiveDiscardRef = useRef<{ playerId: string; ids: Set<string> } | null>(null);

  // useLayoutEffect (no useEffect): tiene que registrar el vuelo ANTES de
  // que el navegador pinte, para que el descarte de verdad nunca llegue a
  // mostrarse ni un solo fotograma antes de que el fantasma "llegue" (ver
  // hiddenCount en PlayerPiles.tsx) — con useEffect normal (que se dispara
  // DESPUÉS de pintar) se veía un parpadeo de un fotograma con la carta ya
  // puesta antes de ocultarse de nuevo.
  useLayoutEffect(() => {
    if (!animationsEnabled) return;
    const prev = prevActiveDiscardRef.current;
    if (prev && prev.playerId === activePlayer.id) {
      const newlyDiscarded = activePlayer.discard.filter((c) => !prev.ids.has(c.instanceId));
      if (newlyDiscarded.length > 0 && discardPileRef.current) {
        const toRect = discardPileRef.current.getBoundingClientRect();
        const toCenter = { x: toRect.left + toRect.width / 2, y: toRect.top + toRect.height / 2 };
        const newFlights: FlightSpec[] = [];
        for (const card of newlyDiscarded) {
          // Solo si de verdad la vimos hace un instante en el mercado (p.
          // ej. un descarte forzoso que aterriza en el descarte no debe
          // "volar" desde ningún sitio): sin posición conocida, sin animación.
          const fromRect = marketRectsRef.current.get(card.instanceId);
          if (!fromRect) continue;
          newFlights.push({
            key: `${card.instanceId}-${activePlayer.discard.length}`,
            card,
            toPlayerId: activePlayer.id,
            fromCenter: { x: fromRect.left + fromRect.width / 2, y: fromRect.top + fromRect.height / 2 },
            toCenter,
          });
        }
        if (newFlights.length > 0) setFlights((f) => [...f, ...newFlights]);
      }
    }
    prevActiveDiscardRef.current = { playerId: activePlayer.id, ids: new Set(activePlayer.discard.map((c) => c.instanceId)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlayer.id, activePlayer.discard.length]);

  function removeFlight(key: string) {
    setFlights((f) => f.filter((fl) => fl.key !== key));
  }

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

  function handleRestartTurn() {
    onRestartTurn?.();
    setPendingChoice(null);
  }

  function handleHandCardClick(card: CardInstance) {
    // Un descarte forzoso pendiente tiene prioridad y aplica a CUALQUIER
    // tipo de carta, monedas incluidas (p. ej. el Buitre deja elegir
    // cualquier carta de la mano) — se comprueba antes que nada, ni
    // siquiera el "las monedas nunca se juegan" de abajo debe bloquearlo.
    const discardAction = resolveDiscardActionFor(legalActions, card.instanceId);
    if (discardAction) {
      runAction(discardAction);
      return;
    }

    if (card.type === 'coin') return; // las monedas nunca se JUEGAN: se gastan solas al pagar

    const acts = playCardActionsFor(legalActions, card.instanceId);
    if (acts.length === 0) return;
    if (acts.length === 1) {
      runAction(acts[0]);
      return;
    }
    setPendingChoice(buildPlayCardTargetChoice(acts, state, human, card));
  }

  function isHandCardClickable(card: CardInstance): boolean {
    if (resolveDiscardActionFor(legalActions, card.instanceId)) return true;
    if (card.type === 'coin') return false;
    return playCardActionsFor(legalActions, card.instanceId).length > 0;
  }

  function handleMarketCardClick(card: CardInstance) {
    runAction(buyAnimalActionFor(legalActions, card.instanceId));
  }

  function isMarketCardClickable(card: CardInstance): boolean {
    return Boolean(buyAnimalActionFor(legalActions, card.instanceId));
  }

  function handleBuyCoinClick(coinId: string) {
    runAction(buyCoinActionFor(legalActions, coinId));
  }

  function isCoinShopClickable(coinId: string): boolean {
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
              ) : owedDiscard ? (
                <span className="status-pill status-pill--discard">
                  {discardVerb} {owedDiscard.amount} carta{owedDiscard.amount === 1 ? '' : 's'} — {state.pendingDecision!.sourceCardName}
                </span>
              ) : (
                <span className="status-pill">
                  {/* Recta final: el contador de ronda pasa a rojo en las 5
                      últimas rondas, para que se vea de un vistazo que la
                      partida se acaba (y compense ya comprar PV en vez de
                      economía). */}
                  <span
                    className={
                      state.maxRounds != null && state.round > state.maxRounds - FINAL_ROUNDS_WARNING
                        ? 'status-pill__round status-pill__round--final'
                        : 'status-pill__round'
                    }
                  >
                    Ronda {state.round}/{state.maxRounds ?? '∞'}
                  </span>{' '}
                  — {canAct ? `turno de ${activePlayer.name}` : `esperando a ${waitingOnPlayer.name}`}
                </span>
              )}
              {onNewGame && (
                <button className="btn btn--ghost btn--new-game" onClick={onNewGame} title="Nueva partida">
                  ↺ <span className="btn__label">Nueva partida</span>
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
                    title={`${p.name}: ${scoreFor(p.id)} PV${clickable ? ' · ver mazo' : ' · mazo privado hasta que termine la partida'}`}
                  >
                    <strong>{p.name}</strong>
                    <span className="scoreboard__pv">
                      {scoreFor(p.id)}
                      <small>PV</small>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <ActivePlayerBoard
            state={state}
            discardPileRef={discardPileRef}
            hiddenDiscardCount={flights.filter((f) => f.toPlayerId === activePlayer.id).length}
          />

          {human.hand.length > 0 && (
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
                    // Sin nada que hacer ahora mismo (no es tu turno y no
                    // debes ningún descarte), ninguna carta se marca
                    // "disabled": ese aspecto semitransparente es para "esto
                    // en concreto no se puede, aunque otras cosas sí" — no
                    // para "ahora mismo no te toca nada", que no es un estado
                    // roto, solo de espera. Las monedas, aparte, NUNCA se
                    // marcan disabled ni en tu propio turno: no son "carta que
                    // no se puede jugar ahora", son cartas que nunca se juegan
                    // (se gastan solas al pagar) — deben verse normales
                    // aunque no reaccionen al clic, salvo que un descarte
                    // pendiente sí las haga elegibles.
                    onClick={isHandCardClickable(card) ? () => handleHandCardClick(card) : undefined}
                    disabled={canAct && card.type !== 'coin' && !isHandCardClickable(card)}
                  />
                ))}
              </div>
            </div>
          )}

          {isOwnTurn && (
            <div className="panel">
              <div className="turn-controls">
                <button
                  className="btn btn--primary"
                  disabled={!legalActions.some((a) => a.type === 'endTurn')}
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
          )}

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
                <div
                  key={card.instanceId}
                  ref={(el) => {
                    if (el) marketRectsRef.current.set(card.instanceId, el.getBoundingClientRect());
                  }}
                >
                  <CardView
                    card={card}
                    onClick={() => handleMarketCardClick(card)}
                    disabled={!isMarketCardClickable(card)}
                    remainingLabel={String((state.sharedDecks[card.species ?? ''] ?? []).length + 1)}
                  />
                </div>
              ))}
              {PURCHASABLE_COIN_IDS.map((coinId) => {
                const card = { ...getCard(coinId), instanceId: coinId } as CardInstance;
                return (
                  <CardView
                    key={coinId}
                    card={card}
                    onClick={() => handleBuyCoinClick(coinId)}
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

      {owedDiscard && (
        // Sin onClick en el backdrop ni botón de cerrar a propósito: un
        // descarte forzoso no se puede cancelar, hay que elegir sí o sí.
        <div className="modal-backdrop">
          <div className="modal modal--discard">
            <div className="panel__header">
              <h2>
                {discardVerb} {owedDiscard.amount} carta{owedDiscard.amount === 1 ? '' : 's'}
              </h2>
            </div>
            <p className="modal__message">
              {discardSourcePlayerName} ha jugado <strong>{state.pendingDecision?.sourceCardName}</strong>: tienes
              que {isReturnToMarket ? 'devolver al mercado' : 'descartar'}{' '}
              {owedDiscard.amount === 1 ? 'una carta' : `${owedDiscard.amount} cartas`} de tu mano.
              Elige cuál{owedDiscard.amount === 1 ? '' : 'es'}.
            </p>
            <div className="card-row">
              {eligibleDiscardCards.map((card) => (
                <CardView
                  key={card.instanceId}
                  card={card}
                  onClick={() => runAction(resolveDiscardActionFor(legalActions, card.instanceId))}
                />
              ))}
            </div>
          </div>
        </div>
      )}

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

      {flights.map((flight) => (
        <FlyingCard key={flight.key} flight={flight} onDone={() => removeFlight(flight.key)} />
      ))}
    </div>
  );
}
