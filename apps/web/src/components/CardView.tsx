import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties } from 'react';
import type { CardInstance } from '@zoo/engine';
import { useArtStyle } from '../lib/artStyle';
import { BELLOTA_TEXT } from '../lib/bellotaText';
import {
  cardAccentClass,
  cardIcon,
  cardIconScale,
  cardImageUrl,
  habitatLabelParts,
  supportsEmojiNatively,
  twemojiUrl,
} from '../lib/cardVisuals';

// Parte `parts` (las palabras sueltas del tipo: "Volador", "Dinosaurio"...)
// en líneas de como mucho `size` cada una, ya unidas con " - ". Con 3-4
// tipos a la vez (Gallina, Tortuga...) una sola línea no cabía en el pie de
// la carta y se recortaba con "…" — pedido explícito del usuario
// (2026-09-21): 2 tipos por línea.
function chunkPairs(parts: string[], size = 2): string[] {
  const lines: string[] = [];
  for (let i = 0; i < parts.length; i += size) lines.push(parts.slice(i, i + size).join(' - '));
  return lines;
}

// PRUEBA: si ESTE sistema ya tiene un glifo de verdad para el emoji (ver
// supportsEmojiNatively), se usa el carácter nativo tal cual — cada uno ve
// el emoji con la fuente/estilo de su propio sistema. Solo si no lo tiene
// (glifo "tofu"/vacío) se cae al SVG de Twemoji como respaldo consistente,
// y si ni eso llega a cargar (sin red...), al carácter de texto de todos
// modos (mejor un tofu que un hueco vacío).
function EmojiIcon({ emoji }: { emoji: string }) {
  const [failed, setFailed] = useState(false);
  if (failed || supportsEmojiNatively(emoji)) return <>{emoji}</>;
  return <img className="card__emoji-img" src={twemojiUrl(emoji)} alt={emoji} draggable={false} onError={() => setFailed(true)} />;
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
  // Eliminada de la partida para siempre (ver player.destroyedCards: por el
  // Cocodrilo al final de la partida, o capturada en vida por Tiburón/
  // Halcón/León): se marca con una X roja encima, para el resumen final.
  // Nunca es clicable (no tiene sentido interactuar con ella).
  destroyed?: boolean;
  // Oculta el tipo (hábitats + mascota/dinosaurio) del pie de la carta: solo
  // lo usa el descarte (ver PlayerPiles.tsx) — ahí solo se ve la última
  // carta cada vez, sin comparar unas con otras, así que el tipo no aporta
  // y sobraba visualmente (pedido explícito del usuario, 2026-09-21).
  hideType?: boolean;
  // Cuánto valdría YA MISMO comprar esta carta del mercado (simulación:
  // se añade a una copia de tu colección actual, ver
  // marketCardPreviewPoints en GameBoard.tsx) — SOLO tiene sentido para
  // cartas del mercado, nunca para las que ya posees (mano/mesa: esas se
  // ven "como la carta estándar", sin nada añadido, así que ese sitio no
  // pasa este prop). Para la mayoría de especies coincide con
  // card.victoryPoints (su PV impreso, fijo); en las 5 de PV variable
  // (Águila/Orca/Oso polar: +1 por hábitat en todo el mazo; Albatros: +1
  // por especie distinta; Tucán: +1 por animal caro) puede valer más.
  // Cuando difiere del PV impreso se muestra SIEMPRE (no hace falta pasar
  // el ratón), como "N*PV" en vez de solo "NPV" — el asterisco marca que
  // es un valor calculado ahora mismo, no el PV fijo de la carta.
  livePoints?: number;
  // Mismo criterio que livePoints, pero para el coste (card__cost): cuánto
  // costaría comprarla YA MISMO, tras el descuento de
  // costReductionPerDinosaurPlayedThisTurn (Diplodocus/Plesiosaurio/
  // Pteranodon/Tiranosaurio/Pterodáctilo/Mosasaurio, ver effectiveMarketCost
  // en el motor) — pedido explícito del usuario 2026-09-21: "que salgan
  // como los PV, ya calculados y con el *". Solo tiene sentido en el
  // mercado (igual que livePoints), nunca en mano/mesa.
  liveCost?: number;
  // Modo selección múltiple (picker de cartas de la edición Personalizado,
  // ver GameSettingsModal.tsx): true añade una marca ✓ (.card__check, ya
  // existía en la hoja de estilos sin usar); false atenúa la carta (sigue
  // siendo clicable, para poder volver a marcarla). undefined (el resto de
  // sitios, mano/mercado/mesa/colección) no toca nada de esto — pedido
  // explícito del usuario 2026-09-21: "las cartas que salgan con su imagen
  // ... como el mercado pero con el check".
  selected?: boolean;
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
// aparición). Y, si no cabe debajo, se pasa a mostrar por ARRIBA
// (card__tooltip--above). Esto es solo para RATÓN: en táctil el tooltip es
// otro elemento, centrado en la pantalla y abierto mientras dura la
// pulsación (ver pressOpen más abajo y .card-press-tooltip en styles.css).
const TOOLTIP_VIEWPORT_MARGIN = 8;
// Cuánto hay que mantener el dedo sobre la carta para que cuente como "leer" y no como toque.
const LONG_PRESS_MS = 220;

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
  liveCost,
  hideType,
  selected,
}: CardViewProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  // Pantalla táctil: el tooltip NO depende de :hover (que en móvil se queda
  // "pegado" tras tocar la carta hasta que tocas otra cosa, y estorba —
  // pedido explícito del usuario 2026-09-21: "en móvil que salga solo
  // mientras pulsas"). Se abre manteniendo el dedo sobre la carta y se
  // cierra al soltar, al arrastrar (el navegador manda pointercancel cuando
  // empieza el scroll) o al salir de la carta. Un toque corto sigue siendo
  // la acción de siempre (jugar/comprar); una pulsación larga que llegó a
  // abrir el tooltip NO dispara esa acción al soltar — si no, leer una carta
  // que puedes pagar la compraría.
  const [pressOpen, setPressOpen] = useState(false);
  const pressTimerRef = useRef<number | null>(null);
  const swallowNextClickRef = useRef(false);
  const clearPressTimer = () => {
    if (pressTimerRef.current !== null) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  };
  const endPress = () => {
    clearPressTimer();
    setPressOpen(false);
  };
  useEffect(() => clearPressTimer, []);
  const [artStyle] = useArtStyle();
  const clickable = Boolean(onClick) && !disabled && !destroyed;
  const isEmoji = artStyle === 'emoji';
  // Tipo (hábitats + mascota/dinosaurio) partido en líneas de 2 en 2 (ver
  // chunkPairs arriba): con 3-4 tipos a la vez una sola línea no cabía y se
  // recortaba con "…" (ver .card__footer en styles.css).
  const footerLines = card.type === 'animal' && !hideType ? chunkPairs(habitatLabelParts(card)) : [];
  const bits: string[] = [];
  // El "+N" dorado (ver .card__coin-value) es una ayuda pensada para las
  // ilustraciones nuevas, que ya no llevan el número grabado encima; en
  // emoji, el 🪙 de siempre nunca lo necesitó — se vuelve al texto "vale N"
  // de toda la vida, igual que en el resto del pie.
  if (isEmoji && card.value) bits.push(`vale ${card.value}`);

  const classNames = ['card', cardAccentClass(card)];
  if (disabled) classNames.push('card--disabled');
  if (destroyed) classNames.push('card--destroyed');
  if (clickable) classNames.push('card--clickable');
  if (compact) classNames.push('card--compact');
  if (selected === false) classNames.push('card--unselected');

  // "N*PV" siempre visible (nunca hace falta pasar el ratón) para las
  // cartas de PV variable (cualquiera con un efecto onScore: Águila, Orca,
  // Oso polar, Albatros, Tucán, y ahora León/Tiburón/Halcón vía
  // scorePerDestroyedCard) SOLO en el mercado (ver livePoints arriba); en
  // mano/mesa nadie pasa livePoints, así que ahí siempre se ve el PV
  // impreso normal, sin nada añadido. Se muestra el asterisco aunque el
  // valor en vivo COINCIDA por ahora con el impreso (p. ej. León con la
  // pila de eliminados todavía vacía: da 5, igual que el PV impreso) — lo
  // que importa es avisar de que ese número puede cambiar, no solo cuando
  // ya ha cambiado.
  const hasVariableScoring = card.effects?.some((e) => e.trigger === 'onScore') ?? false;
  const showLiveBonus = livePoints !== undefined && (hasVariableScoring || livePoints !== card.victoryPoints);
  const showPvBadge = card.victoryPoints !== 0 || showLiveBonus;
  const pvLabel = showLiveBonus ? `${livePoints}*` : card.victoryPoints !== 0 ? `${card.victoryPoints}` : '';

  // Mismo criterio que el PV en vivo, para el coste (ver liveCost arriba):
  // asterisco siempre que la carta lleve el descuento por dinosaurio (haya
  // cambiado o no TODAVÍA el coste real), nunca solo cuando ya ha cambiado.
  const hasDinosaurCostReduction = Boolean(card.costReductionPerDinosaurPlayedThisTurn);
  const showLiveCost = liveCost !== undefined && (hasDinosaurCostReduction || liveCost !== card.marketCost);
  const costLabel = showLiveCost ? `${liveCost}*` : card.marketCost ? `${card.marketCost}` : '';

  return (
    <div
      ref={cardRef}
      className={classNames.join(' ')}
      onClick={clickable ? onClick : undefined}
      onClickCapture={(e) => {
        if (!swallowNextClickRef.current) return;
        swallowNextClickRef.current = false;
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerDown={(e) => {
        swallowNextClickRef.current = false;
        if (e.pointerType === 'mouse' || !card.text) return;
        clearPressTimer();
        pressTimerRef.current = window.setTimeout(() => {
          pressTimerRef.current = null;
          swallowNextClickRef.current = true;
          setPressOpen(true);
        }, LONG_PRESS_MS);
      }}
      // Solo el dedo que abrió el tooltip puede cerrarlo: en un equipo con
      // pantalla táctil Y ratón, el puntero del ratón entrando/saliendo de la
      // carta no debe cerrar una pulsación táctil en curso.
      onPointerUp={(e) => e.pointerType !== 'mouse' && endPress()}
      onPointerCancel={(e) => e.pointerType !== 'mouse' && endPress()}
      onPointerLeave={(e) => e.pointerType !== 'mouse' && endPress()}
      onContextMenu={(e) => {
        // El menú contextual de "mantener pulsado" del móvil (guardar imagen...) taparía el tooltip.
        if (pressOpen || pressTimerRef.current !== null) e.preventDefault();
      }}
      onMouseEnter={() => {
        if (card.text && cardRef.current && tooltipRef.current) clampTooltipPosition(cardRef.current, tooltipRef.current);
      }}
      role={onClick ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
    >
      <div className="card__top">
        {card.marketCost ? <span className="card__cost">{costLabel}</span> : <span />}
        {showPvBadge && (
          <span className={['card__pv', card.victoryPoints < 0 && 'card__pv--negative'].filter(Boolean).join(' ')}>
            {pvLabel}PV
          </span>
        )}
      </div>
      <div className={`card__icon${isEmoji ? ' card__icon--emoji' : ''}`}>
        {isEmoji ? (
          <EmojiIcon emoji={cardIcon(card)} />
        ) : (
          <img
            className="card__icon-img"
            src={cardImageUrl(card)}
            alt={card.name}
            draggable={false}
            style={{ '--icon-scale': cardIconScale(card) } as CSSProperties}
          />
        )}
      </div>
      {/* El nombre solo se repite aparte en emoji (tal y como estaba antes
          de las ilustraciones): un emoji por sí solo no siempre basta para
          identificar la especie (p. ej. vulture/toucan usan una
          aproximación temática, ver SPECIES_ICONS). Con la imagen real ya
          no hace falta, así que ese sitio se queda para el hábitat. */}
      {isEmoji && <div className="card__name">{card.name}</div>}
      {/* El número grabado en la ilustración de la bellota (ver img/web) es
          demasiado pequeño/decorativo para distinguirse de un vistazo, así
          que en modo imagen el valor real de captura se repite aquí,
          grande y en el color de acento dorado (ver .card__coin-value); en
          emoji ya va como texto "vale N" dentro de bits (ver arriba). */}
      <div className={`card__footer${isEmoji ? '' : ' card__footer--muted-dark'}${footerLines.length > 0 ? ' card__footer--wrap' : ''}`}>
        {!isEmoji && card.type === 'coin' && card.value ? (
          <span className="card__coin-value">+{card.value}</span>
        ) : footerLines.length > 0 ? (
          footerLines.map((line, i) => <div key={i}>{line}</div>)
        ) : (
          bits.join(' · ')
        )}
      </div>
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
      {selected === true && (
        <span className="card__check" aria-label="Incluida">
          ✓
        </span>
      )}
      {card.text && (
        // Al pasar el ratio: qué hace la carta, más grande y claro que el
        // texto minúsculo de la propia carta (sustituye al `title` nativo,
        // que es pequeño, lento en aparecer y no se puede dar estilo). En
        // modo imagen se habla de "bellota" en vez de "moneda" (ver
        // bellotaText.ts, mismo tema que las ilustraciones reales y el
        // mazo impreso); en emoji se queda el texto de siempre.
        <div ref={tooltipRef} className="card__tooltip">
          <div className="card__tooltip-name">{card.name}</div>
          <div className="card__tooltip-text">{isEmoji ? card.text : (BELLOTA_TEXT[card.id] ?? card.text)}</div>
        </div>
      )}
      {/* Versión táctil: centrada en la PANTALLA y fuera del árbol de la carta
          (portal a <body>). Dentro de la carta, position:fixed no sirve: las
          cartas deshabilitadas llevan `filter: grayscale(...)`, y un filtro
          convierte al elemento en el bloque contenedor de sus hijos fixed —
          el tooltip salía pegado a la carta, cortado por el borde y además
          agrisado/translúcido como ella. */}
      {pressOpen &&
        card.text &&
        createPortal(
          <div className="card-press-tooltip" role="tooltip">
            <div className="card__tooltip-name">{card.name}</div>
            <div className="card__tooltip-text">{isEmoji ? card.text : (BELLOTA_TEXT[card.id] ?? card.text)}</div>
          </div>,
          document.body
        )}
    </div>
  );
}
