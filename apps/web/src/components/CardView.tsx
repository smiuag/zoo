import { useState } from 'react';
import type { CardInstance } from '@zoo/engine';
import { cardAccentClass, cardIcon, habitatLabel, supportsEmojiNatively, twemojiUrl } from '../lib/cardVisuals';

// PRUEBA: si ESTE sistema ya tiene un glifo de verdad para el emoji (ver
// supportsEmojiNatively), se usa el carácter nativo tal cual — cada uno ve
// el emoji con la fuente/estilo de su propio sistema. Solo si no lo tiene
// (glifo "tofu"/vacío) se cae al SVG de Twemoji como respaldo consistente,
// y si ni eso llega a cargar (sin red...), al carácter de texto de todos
// modos (mejor un tofu que un hueco vacío).
function EmojiIcon({ emoji }: { emoji: string }) {
  const [failed, setFailed] = useState(false);
  if (failed || supportsEmojiNatively(emoji)) return <>{emoji}</>;
  return <img className="card__icon-img" src={twemojiUrl(emoji)} alt={emoji} draggable={false} onError={() => setFailed(true)} />;
}

interface CardViewProps {
  card: CardInstance;
  onClick?: () => void;
  disabled?: boolean;
  compact?: boolean;
  // Cuántas copias quedan en el montón (mazo compartido de esa especie, o
  // "∞" para las monedas comprables, de suministro ilimitado). Solo se
  // muestra en las cartas del mercado, no en la mano.
  remainingLabel?: string;
  // Delante de remainingLabel: "×" por defecto (mercado: "quedan ×N"), pero
  // el descarte de la mesa (ver GameBoard.tsx) lo quiere sin nada delante —
  // ahí el número es un recuento total, no un "quedan ×N".
  badgePrefix?: string;
  // Eliminada por el Cocodrilo al final de la partida (ver
  // player.destroyedCards): se marca con una X roja encima, para el resumen
  // final. Nunca es clicable (no tiene sentido interactuar con ella).
  destroyed?: boolean;
}

export function CardView({ card, onClick, disabled, compact, remainingLabel, badgePrefix = '×', destroyed }: CardViewProps) {
  const clickable = Boolean(onClick) && !disabled && !destroyed;
  const bits: string[] = [];
  if (card.type === 'animal') bits.push(habitatLabel(card));
  if (card.value) bits.push(`vale ${card.value}`);

  const classNames = ['card', cardAccentClass(card)];
  if (disabled) classNames.push('card--disabled');
  if (destroyed) classNames.push('card--destroyed');
  if (clickable) classNames.push('card--clickable');
  if (compact) classNames.push('card--compact');

  return (
    <div
      className={classNames.join(' ')}
      onClick={clickable ? onClick : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
    >
      <div className="card__top">
        {card.marketCost ? <span className="card__cost">{card.marketCost}</span> : <span />}
        {card.victoryPoints !== 0 && (
          <span className={['card__pv', card.victoryPoints < 0 && 'card__pv--negative'].filter(Boolean).join(' ')}>
            {card.victoryPoints}PV
          </span>
        )}
      </div>
      <div className="card__icon">
        <EmojiIcon emoji={cardIcon(card)} />
      </div>
      <div className="card__name">{card.name}</div>
      <div className="card__footer">{bits.join(' · ')}</div>
      {remainingLabel !== undefined && (
        <span className="card__badge">
          {badgePrefix}
          {remainingLabel}
        </span>
      )}
      {destroyed && (
        <span className="card__destroyed-mark" aria-label="Eliminada por el Cocodrilo">
          ✕
        </span>
      )}
      {card.text && (
        // Al pasar el ratio: qué hace la carta, más grande y claro que el
        // texto minúsculo de la propia carta (sustituye al `title` nativo,
        // que es pequeño, lento en aparecer y no se puede dar estilo).
        <div className="card__tooltip">
          <div className="card__tooltip-name">{card.name}</div>
          <div className="card__tooltip-text">{card.text}</div>
        </div>
      )}
    </div>
  );
}
