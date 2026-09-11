import type { Ref } from 'react';
import type { Player } from '@zoo/engine';
import { CardView } from './CardView';

// Mazo de robo (boca abajo a propósito: nunca se revela qué hay) de un
// jugador, con su recuento. Usado tanto en la fila de controles de turno
// (cuando es tu propio turno, ver GameBoard.tsx) como junto a "Mesa de X"
// (cuando es el turno de otro, ver ActivePlayerBoard.tsx).
export function DeckPile({ player }: { player: Player }) {
  return (
    <div className="pile pile--deck" title={`Mazo de ${player.name}`}>
      <div className="card card--compact card--facedown">
        <span className="card__icon">🂠</span>
        <span className="card__badge">{player.deck.length}</span>
      </div>
    </div>
  );
}

// Descarte de un jugador: solo la última carta en llegar, boca arriba, con
// el recuento total (no toda la pila). `pileRef` es opcional: lo usa
// GameBoard.tsx para saber hasta dónde debe "volar" la animación de compra
// (ver FlyingCard.tsx), apunte a esta pila o a la de ActivePlayerBoard,
// dondequiera que esté montada ahora mismo.
export function DiscardPile({ player, pileRef }: { player: Player; pileRef?: Ref<HTMLDivElement> }) {
  const lastDiscarded = player.discard[player.discard.length - 1];
  return (
    <div className="pile pile--discard" title={`Descarte de ${player.name}`} ref={pileRef}>
      {lastDiscarded ? (
        <CardView card={lastDiscarded} compact badgePrefix="" remainingLabel={String(player.discard.length)} />
      ) : (
        <div className="card card--compact card--empty" />
      )}
    </div>
  );
}
