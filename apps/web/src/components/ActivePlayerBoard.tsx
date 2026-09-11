import { getActivePlayer, type CardInstance, type GameState } from '@zoo/engine';
import { CardView } from './CardView';

interface ActivePlayerBoardProps {
  state: GameState;
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

// Zona pública de mesa de quien tenga el turno ahora mismo (humano o bot):
// lo que va jugando este turno (apilado, ver .card-stack en styles.css). A
// propósito NO depende de quién mira la pantalla — es una revelación
// deliberada de lo que hace el jugador activo mientras juega (ver
// redactStateForSeat en online/redact.ts: el jugado de un humano solo viaja
// sin redactar mientras tiene el turno). La mano y el mazo de robo siguen
// siendo siempre privados, esto no los toca. El mazo/descarte del jugador
// activo se muestran aparte, en la fila de controles de turno (ver
// GameBoard.tsx), no aquí.
export function ActivePlayerBoard({ state }: ActivePlayerBoardProps) {
  if (state.gameOver) return null;
  const activePlayer = getActivePlayer(state);
  const played = groupByCard(activePlayer.playedThisTurn);

  return (
    <div className="panel">
      <div className="panel__header">
        <h2>Mesa de {activePlayer.name}</h2>
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
