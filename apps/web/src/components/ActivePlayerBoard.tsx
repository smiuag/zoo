import { useRef, type RefObject } from 'react';
import { currentPurchasingPower, getActivePlayer, type CardInstance, type GameState } from '@zoo/engine';
import { CardView } from './CardView';
import { DeckPile, DiscardPile } from './PlayerPiles';

interface ActivePlayerBoardProps {
  state: GameState;
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
export function ActivePlayerBoard({ state, discardPileRef, hiddenDiscardCount = 0 }: ActivePlayerBoardProps) {
  const activePlayer = getActivePlayer(state);
  // "Disponible/pico de este turno" — el pico es lo más alto que ha tenido
  // ESTE turno (sube cuando juega algo que le da más valor de compra, nunca
  // baja), no el pico de toda la partida (eso ya lo guarda richestTurn en
  // el motor, para el resumen final). Se recalcula en cada render leyendo/
  // actualizando la misma ref, igual que lastHumanIdRef en App.tsx — no
  // hace falta un useEffect para esto. El hook va ANTES del `if
  // (state.gameOver)` de abajo: las reglas de hooks no permiten saltárselo
  // condicionalmente.
  const turnPeakRef = useRef<{ turn: number; peak: number }>({ turn: state.turn, peak: 0 });
  const purchasingPower = currentPurchasingPower(activePlayer);
  if (turnPeakRef.current.turn !== state.turn) {
    turnPeakRef.current = { turn: state.turn, peak: purchasingPower };
  } else if (purchasingPower > turnPeakRef.current.peak) {
    turnPeakRef.current.peak = purchasingPower;
  }

  if (state.gameOver) return null;
  const played = groupByCard(activePlayer.playedThisTurn);

  return (
    <div className="panel">
      <div className="panel__header panel__header--with-piles">
        <DeckPile player={activePlayer} />
        <div className="panel__header-center">
          <h2>Mesa de {activePlayer.name}</h2>
          <p
            className="active-player-money"
            title={`Valor de compra de ${activePlayer.name}: ${purchasingPower} disponibles de ${turnPeakRef.current.peak} que ha llegado a tener este turno`}
          >
            💰 Valor de compra: {purchasingPower}/{turnPeakRef.current.peak}
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
                  <CardView card={card} compact />
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
