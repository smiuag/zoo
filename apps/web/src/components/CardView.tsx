import type { CardInstance } from '@zoo/engine';
import { cardAccentClass, cardIcon, habitatLabel } from '../lib/cardVisuals';

interface CardViewProps {
  card: CardInstance;
  onClick?: () => void;
  disabled?: boolean;
  compact?: boolean;
  // Plata/Oro apiladas en el mercado (ver .coin-stack / .card--coin-half en
  // styles.css): mismo ancho que una carta normal, la mitad de su alto. Es
  // una clase propia y no una variante de `compact` porque .card--compact
  // REDEFINE las variables --card-w/--card-h a un tamaño más pequeño
  // (72×100): cualquier cálculo que las reutilizara (p. ej. "la mitad de
  // una carta normal") acababa partiendo de esas 72×100, no de las 128×184
  // reales, y salía más chica de lo que parecía en el CSS.
  half?: boolean;
  // Cuántas copias quedan en el montón (mazo compartido de esa especie, o
  // "∞" para las monedas comprables, de suministro ilimitado). Solo se
  // muestra en las cartas del mercado, no en la mano.
  remainingLabel?: string;
}

export function CardView({ card, onClick, disabled, compact, half, remainingLabel }: CardViewProps) {
  const clickable = Boolean(onClick) && !disabled;
  const bits: string[] = [];
  if (card.type === 'animal') bits.push(habitatLabel(card));
  if (card.value) bits.push(`vale ${card.value}`);

  const classNames = ['card', cardAccentClass(card)];
  if (disabled) classNames.push('card--disabled');
  if (clickable) classNames.push('card--clickable');
  if (compact) classNames.push('card--compact');
  if (half) classNames.push('card--coin-half');

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
      <div className="card__icon">{cardIcon(card)}</div>
      <div className="card__name">{card.name}</div>
      <div className="card__footer">{bits.join(' · ')}</div>
      {remainingLabel !== undefined && <span className="card__badge">×{remainingLabel}</span>}
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
