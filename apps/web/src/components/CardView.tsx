import { useRef, useState } from 'react';
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
  // Puntos que esta carta da AHORA MISMO en la colección de su dueño (ver
  // scoreCardContributions en scoring.ts): para la mayoría de cartas
  // coincide con card.victoryPoints (su PV impreso, fijo), pero en las de
  // PV variable (Águila/Orca/Oso polar: +1 por hábitat en todo el mazo;
  // Albatros: +1 por especie distinta; Tucán: +1 por animal caro) puede
  // valer más. Solo tiene sentido pasarlo para cartas que el jugador YA
  // POSEE (mano, jugado este turno, mazo/descarte) — las del mercado
  // todavía no puntúan nada, así que se omite ahí. Cuando difiere del PV
  // impreso, se muestra en paréntesis junto a él, SOLO al pasar el ratón
  // (igual que el tooltip de texto) para no abarrotar la carta el resto
  // del tiempo.
  livePoints?: number;
}

// El tooltip nace centrado bajo la carta (ver .card__tooltip en
// styles.css); eso lo saca de la pantalla en cartas pegadas al borde
// izquierdo/derecho, o en la última fila del mercado (no hay hueco
// debajo). Al entrar el ratón se mide su posición REAL ya calculada por
// el navegador (getBoundingClientRect, con la carta todavía sin hover:
// visibility:hidden reserva su hueco en el layout igual que si se viera)
// y se corrige con un desplazamiento horizontal (--tooltip-shift-x, una
// custom property que la hoja de estilos ya incorpora a su transform, en
// vez de pisar el transform desde aquí y romper la transición de
// aparición) y, si no cabe debajo, se pasa a mostrar por ARRIBA
// (card__tooltip--above).
const TOOLTIP_VIEWPORT_MARGIN = 8;

function clampTooltipPosition(card: HTMLElement, tooltip: HTMLElement) {
  tooltip.style.setProperty('--tooltip-shift-x', '0px');
  tooltip.classList.remove('card__tooltip--above');

  const cardRect = card.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();

  let shiftX = 0;
  if (tooltipRect.left < TOOLTIP_VIEWPORT_MARGIN) {
    shiftX = TOOLTIP_VIEWPORT_MARGIN - tooltipRect.left;
  } else if (tooltipRect.right > window.innerWidth - TOOLTIP_VIEWPORT_MARGIN) {
    shiftX = window.innerWidth - TOOLTIP_VIEWPORT_MARGIN - tooltipRect.right;
  }
  tooltip.style.setProperty('--tooltip-shift-x', `${shiftX}px`);

  const spaceBelow = window.innerHeight - cardRect.bottom;
  const spaceAbove = cardRect.top;
  if (spaceBelow < tooltipRect.height + TOOLTIP_VIEWPORT_MARGIN && spaceAbove > spaceBelow) {
    tooltip.classList.add('card__tooltip--above');
  }
}

export function CardView({
  card,
  onClick,
  disabled,
  compact,
  remainingLabel,
  badgePrefix = '×',
  destroyed,
  livePoints,
}: CardViewProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const clickable = Boolean(onClick) && !disabled && !destroyed;
  const bits: string[] = [];
  if (card.type === 'animal') bits.push(habitatLabel(card));
  if (card.value) bits.push(`vale ${card.value}`);

  const classNames = ['card', cardAccentClass(card)];
  if (disabled) classNames.push('card--disabled');
  if (destroyed) classNames.push('card--destroyed');
  if (clickable) classNames.push('card--clickable');
  if (compact) classNames.push('card--compact');

  // Cartas de PV variable (Águila, Orca, Oso polar: PV impreso 0 o 2 — Ostentan
  // el resto en el paréntesis; Albatros, Tucán: PV impreso 0): mientras no se
  // pasa el ratón solo se ve el PV impreso, tal cual la carta física — el
  // valor real de ahora mismo (que puede ser 0 al principio de la partida)
  // se revela entre paréntesis solo al pasar el ratón, igual que el tooltip
  // de texto, para no abarrotar la carta el resto del tiempo.
  const showLiveBonus = isHovered && livePoints !== undefined && livePoints !== card.victoryPoints;
  const showPvBadge = card.victoryPoints !== 0 || showLiveBonus;
  const pvLabel = `${card.victoryPoints !== 0 ? card.victoryPoints : ''}${showLiveBonus ? ` (${livePoints})` : ''}`.trim();

  return (
    <div
      ref={cardRef}
      className={classNames.join(' ')}
      onClick={clickable ? onClick : undefined}
      onMouseEnter={() => {
        setIsHovered(true);
        if (card.text && cardRef.current && tooltipRef.current) clampTooltipPosition(cardRef.current, tooltipRef.current);
      }}
      onMouseLeave={() => setIsHovered(false)}
      role={onClick ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
    >
      <div className="card__top">
        {card.marketCost ? <span className="card__cost">{card.marketCost}</span> : <span />}
        {showPvBadge && (
          <span className={['card__pv', card.victoryPoints < 0 && 'card__pv--negative'].filter(Boolean).join(' ')}>
            {pvLabel}PV
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
        <div ref={tooltipRef} className="card__tooltip">
          <div className="card__tooltip-name">{card.name}</div>
          <div className="card__tooltip-text">{card.text}</div>
        </div>
      )}
    </div>
  );
}
