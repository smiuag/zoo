import type { CardInstance } from '@zoo/engine';
import { cardAccentClass, cardIcon, habitatLabel } from '../lib/cardVisuals';

interface CardViewProps {
  card: CardInstance;
  onClick?: () => void;
  disabled?: boolean;
  compact?: boolean;
  selected?: boolean;
  // Cuántas copias quedan en el montón (mazo compartido de esa especie, o
  // "∞" para las monedas comprables, de suministro ilimitado). Solo se
  // muestra en las cartas del mercado, no en la mano.
  remainingLabel?: string;
}

export function CardView({ card, onClick, disabled, compact, selected, remainingLabel }: CardViewProps) {
  const clickable = Boolean(onClick) && !disabled;
  const bits: string[] = [];
  if (card.type === 'animal') bits.push(habitatLabel(card));
  if (card.marketCost) bits.push(`coste ${card.marketCost}`);
  if (card.value) bits.push(`vale ${card.value}`);
  const title = card.text ? `${card.name} — ${card.text}` : card.name;

  const classNames = ['card', cardAccentClass(card)];
  if (disabled) classNames.push('card--disabled');
  if (clickable) classNames.push('card--clickable');
  if (compact) classNames.push('card--compact');
  if (selected) classNames.push('card--selected');

  return (
    <div
      className={classNames.join(' ')}
      onClick={clickable ? onClick : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      title={title}
    >
      <div className="card__top">
        {card.marketCost ? <span className="card__cost">{card.marketCost}</span> : <span />}
        {card.victoryPoints !== 0 && <span className="card__pv">{card.victoryPoints}PV</span>}
      </div>
      <div className="card__icon">{cardIcon(card)}</div>
      <div className="card__name">{card.name}</div>
      <div className="card__footer">{bits.join(' · ')}</div>
      {remainingLabel !== undefined && <span className="card__badge">×{remainingLabel}</span>}
    </div>
  );
}
