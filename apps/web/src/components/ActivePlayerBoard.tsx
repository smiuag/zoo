import type { RefObject } from 'react';
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

// "Disponible / total de este turno" del jugador activo — definición explícita
// del usuario (2026-09-21): a la izquierda lo que tiene disponible AHORA, y el
// total es ese disponible MÁS lo que ya ha gastado en compras este turno. Sin
// haber comprado nada, los dos números son siempre iguales.
//
// Lo gastado lo lleva el motor (player.spentThisTurn, ver payCoins en
// engine.ts): antes se deducía aquí sumando cada SUBIDA del valor de compra
// entre un render y el siguiente, y eso fallaba con cualquier carta que lo
// mueve sin comprar — las que descartan una moneda (Cerdo, Nutria, Gallina),
// la que la cambia por otra (Pez Dorado), las que roban monedas o las que
// devuelven cartas al mazo: salía un "7/12" sin haber gastado nada. Distinto
// del richestTurn del motor, que es un máximo instantáneo para el resumen
// final de la partida.
//
// Extraído a un hook propio para que GameBoard.tsx muestre la misma cifra en
// la barra de móvil sin duplicar el cálculo. "Reiniciar turno" restaura el
// GameState entero, spentThisTurn incluido, así que ya no hace falta ningún
// contador aparte para eso: turnRestartCount se conserva en la firma solo para
// no tocar a quienes llaman.
export function useActivePlayerMoney(state: GameState, _turnRestartCount?: number) {
  const activePlayer = getActivePlayer(state);
  const purchasingPower = currentPurchasingPower(activePlayer);
  const peak = purchasingPower + (activePlayer.spentThisTurn ?? 0);
  return { activePlayer, purchasingPower, peak };
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
    <div className="panel panel--table">
      <div className="panel__header panel__header--with-piles">
        <DeckPile player={activePlayer} />
        <div className="panel__header-center">
          <h2>Mesa de {activePlayerName}</h2>
          <p
            className="active-player-money"
            title={`Valor de compra de ${activePlayerName}: ${purchasingPower} disponibles; ${peak} en total este turno contando lo ya gastado`}
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
