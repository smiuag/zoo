import { useRef, type RefObject } from 'react';
import { currentPurchasingPower, getActivePlayer, type CardInstance, type GameState } from '@zoo/engine';
import { CardView } from './CardView';
import { DeckPile, DiscardPile } from './PlayerPiles';
import { displayName } from '../lib/botAlgorithms';
import type { BotAlgorithm } from '../lib/gameConfig';

interface ActivePlayerBoardProps {
  state: GameState;
  // Ver turnRestartCount en useGame.ts: se pasa tal cual a useActivePlayerMoney
  // para que "reiniciar turno" también reinicie el general acumulado.
  turnRestartCount: number;
  // Igual que en el marcador de GameBoard.tsx: para mostrar el mismo
  // nombre ahí que aquí (código corto del algoritmo para un bot, nunca su
  // "B1"/"B2" interno, ver displayName en lib/botAlgorithms.ts).
  humanIds: string[];
  botAlgorithms: Record<string, BotAlgorithm>;
  // Dónde debe "aterrizar" la animación de compra (ver FlyingCard.tsx).
  discardPileRef?: RefObject<HTMLDivElement>;
  // Cuántas de las últimas cartas del descarte del jugador activo no se
  // muestran todavía porque su vuelo sigue en el aire (ver
  // FlightSpec.toPlayerId y DiscardPile en PlayerPiles.tsx).
  hiddenDiscardCount?: number;
}

function groupByCard(cards: CardInstance[]): { card: CardInstance; count: number }[] {
  const byId = new Map<string, { card: CardInstance; count: number }>();
  for (const card of cards) {
    const entry = byId.get(card.id);
    if (entry) entry.count += 1;
    else byId.set(card.id, { card, count: 1 });
  }
  return [...byId.values()];
}

// "Disponible/general de este turno" del jugador activo. El "general" NO es
// el máximo instantáneo que ha llegado a tener (eso lo confundía con
// richestTurn, ver abajo): es la suma de TODO lo que ha ganado este turno,
// aunque ya se haya gastado parte — pedido explícito del usuario: con 6/8 y
// ganas 2 más, el actual sube a 8 y el general a 10 (nunca se queda en 8/8),
// y así con cualquier ganancia. Por eso se compara contra el valor del
// render ANTERIOR (prev), no contra el propio pico: solo un aumento cuenta
// como "ganancia" y suma al general; un descenso (gastar) nunca lo baja ni
// lo toca. Distinto del richestTurn que guarda el motor para el resumen
// final de la partida (ese sí es un máximo instantáneo de verdad, ver
// recordRichestTurn en engine.ts — no se toca aquí). Se recalcula en cada
// render leyendo/actualizando la misma ref, igual que lastHumanIdRef en
// App.tsx — no hace falta un useEffect para esto. Extraído a un hook propio
// (antes vivía solo dentro de ActivePlayerBoard) para que GameBoard.tsx
// pueda mostrar la misma cifra en un badge flotante en móvil, sin duplicar
// el cálculo ni arriesgarse a que las dos copias diverjan.
//
// turnRestartCount (ver useGame.ts): "reiniciar turno" restaura el GameState
// de la foto de inicio de turno, pero NO cambia state.turn (sigue siendo el
// mismo turno, deshecho) — sin esto, el general se quedaba con lo acumulado
// del intento descartado y seguía sumando desde ahí en vez de volver a
// arrancar desde el valor real de inicio de turno.
export function useActivePlayerMoney(state: GameState, turnRestartCount: number) {
  const activePlayer = getActivePlayer(state);
  const purchasingPower = currentPurchasingPower(activePlayer);
  const key = `${state.turn}:${turnRestartCount}`;
  const turnRef = useRef<{ key: string; peak: number; prev: number }>({
    key,
    peak: purchasingPower,
    prev: purchasingPower,
  });
  if (turnRef.current.key !== key) {
    turnRef.current = { key, peak: purchasingPower, prev: purchasingPower };
  } else {
    const gained = purchasingPower - turnRef.current.prev;
    if (gained > 0) turnRef.current.peak += gained;
    turnRef.current.prev = purchasingPower;
  }
  return { activePlayer, purchasingPower, peak: turnRef.current.peak };
}

// Zona pública de mesa de quien tenga el turno ahora mismo (humano o bot,
// seas tú o no): mazo/descarte y valor de compra en la cabecera (mazo a la
// izquierda, descarte a la derecha, dinero debajo del título — igual seas
// tú quien juega o estés viendo a otro), y lo que va jugando este turno
// (apilado, ver .card-stack en styles.css) debajo. A propósito NO depende
// de quién mira la pantalla — es una revelación deliberada de lo que hace
// el jugador activo mientras juega (ver redactStateForSeat en
// online/redact.ts: el jugado de un humano solo viaja sin redactar
// mientras tiene el turno). La mano y el mazo de robo siguen siendo
// siempre privados, esto no los toca.
export function ActivePlayerBoard({
  state,
  turnRestartCount,
  humanIds,
  botAlgorithms,
  discardPileRef,
  hiddenDiscardCount = 0,
}: ActivePlayerBoardProps) {
  // El hook va ANTES del `if (state.gameOver)` de abajo: las reglas de
  // hooks no permiten saltárselo condicionalmente.
  const { activePlayer, purchasingPower, peak } = useActivePlayerMoney(state, turnRestartCount);
  const activePlayerName = displayName(activePlayer, humanIds, botAlgorithms);

  if (state.gameOver) return null;
  const played = groupByCard(activePlayer.playedThisTurn);

  return (
    <div className="panel">
      <div className="panel__header panel__header--with-piles">
        <DeckPile player={activePlayer} />
        <div className="panel__header-center">
          <h2>Mesa de {activePlayerName}</h2>
          <p
            className="active-player-money"
            title={`Valor de compra de ${activePlayerName}: ${purchasingPower} disponibles de ${peak} que ha llegado a tener este turno`}
          >
            💰 Valor de compra: {purchasingPower}/{peak}
          </p>
        </div>
        <DiscardPile player={activePlayer} pileRef={discardPileRef} hiddenCount={hiddenDiscardCount} />
      </div>

      <div className="board-section">
        <span className="panel__hint">Jugado este turno</span>
        <div className="card-row card-row--board">
          {played.length === 0 && <span className="market-empty">(nada todavía)</span>}
          {played.map(({ card, count }) => (
            <div key={card.instanceId} className="card-stack">
              {Array.from({ length: Math.min(count, 4) }, (_, i) => (
                <div key={i} className="card-stack__item">
                  <CardView card={card} compact hideType />
                </div>
              ))}
              {count > 1 && <span className="card-stack__count">×{count}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
