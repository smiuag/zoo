import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { getCard, type CardInstance } from '@zoo/engine';
import { CardView } from './CardView';

// Tutorial paso a paso (pedido explícito del usuario 2026-09-22): una
// partida de ejemplo en solitario, contada con textos, donde se ve cómo se
// roba, cómo se compra, cómo lo comprado va al DESCARTE (con la carta
// volando despacio del mercado al descarte), cómo se baraja el descarte
// cuando el mazo se acaba, cómo las habilidades suben el valor de compra y
// cómo se suman los PV al final. No usa el motor: cada paso es una foto
// fija de las zonas (mazo/mano/jugado/descarte/mercado/PV) escrita a mano
// siguiendo las reglas reales; la aritmética está comprobada contra los
// datos de carta (coste/PV/efectos) y el motor (el Mono se cuenta a sí
// mismo vía effectiveHand; el Oso polar se cuenta a sí mismo en
// scorePerHabitatCount; el Hipopótamo es terrestre Y acuático; la Plata
// vale 1 PV). Si cambian esos datos, hay que revisar los números de aquí.
//
// Un paso puede llevar una SECUENCIA de fotogramas (`frames`): cada uno es
// la foto siguiente más el vuelo de una carta que la explica (mano → mesa
// al jugar, montón → mano al ganar una Plata, mercado → descarte al
// comprar). El paso empieza en su foto base; tras `hold` ms sale el vuelo,
// y al aterrizar se pasa a la foto del fotograma. Así "juegas el Pingüino
// y te llega la Plata" o "juegas León y Mono y compras el Oso polar" son UN
// solo paso — pedido del usuario 2026-09-22.
//
// Cada paso dice qué zonas se enseñan (`show`): solo las que importan en
// ese momento, nunca todo a la vez. Los PV no aparecen hasta que se
// explican (anatomía de la carta) y, a partir de ahí, solo en las compras y
// en el recuento final, como píldora en la cabecera del descarte.
//
// Se abre desde la pantalla de inicio SOLO con la edición Aprendizaje
// seleccionada (botón "Ver tutorial"). Ojo: el guion usa Hipopótamo (5),
// León (5) y Oso polar (7), que por coste NO salen en el mercado de la
// edición Aprendizaje (máximo 4) — están a propósito, elegidas por el
// usuario para enseñar habilidades y el recuento final.
//
// En móvil el texto de cada paso va en un "bocadillo" fijo arriba y los
// botones en una barra fija abajo (ver .tutorial__step/.tutorial__controls
// en styles.css, @media max-width:860px): el tablero hace scroll por
// debajo y nunca se tapan el texto y los botones entre sí.

const B = 'coin-1';
const P = 'sloth';
const PL = 'coin-2';
const PG = 'penguin';
const MO = 'monkey';
const HI = 'hippopotamus';
const LE = 'lion';
const OS = 'polar-bear';

// Mercado del tutorial: unas cuantas especies de coste creciente (las 5
// que se compran en el guion más dos baratas de relleno), siempre las
// mismas; en la partida real cada hueco se repone con otra copia de la
// misma especie, así que aquí la carta comprada simplemente sigue ahí.
const MARKET = ['goldfish', 'rabbit', PG, MO, HI, LE, OS];

// Mazo inicial "desplegado" (primer paso): 7 Bronce en una fila y 3
// Perezosos en otra, siempre así sea cual sea el ancho (usuario 2026-09-22).
const STARTER_BRONZE = [B, B, B, B, B, B, B];
const STARTER_SLOTHS = [P, P, P];

// Reserva (lo que no es de nadie): las copias de los animales que faltan
// por salir al mercado y las monedas. De aquí llega la Plata que da el
// Pingüino — no del mazo del jugador, que era confuso (usuario 2026-09-22)
// — y de aquí sale también el Hipopótamo que se compra en esa misma viñeta.
const RESERVE = ['rabbit', HI, PL, 'coin-3', 'coin-5'];

type ZoneId = 'deckSpread' | 'market' | 'hand' | 'played' | 'piles' | 'bigcard' | 'final';
type Focus = 'cost' | 'pv' | 'types' | 'ability';
type FlightSource = 'hand' | 'reserve' | 'market';
type FlightTarget = 'played' | 'hand' | 'discard';

// Foto de las zonas en un momento dado.
interface Snapshot {
  deck: number;
  hand: string[];
  played: string[];
  // Orden de llegada: la última es la de arriba del montón.
  discard: string[];
  // Valor de compra actual; ausente = no se muestra (fuera de turno).
  money?: number;
  pv: number;
  // Cartas que acaban de LLEGAR: entran con animación y destello.
  glow?: { hand?: string[]; played?: string[]; discard?: string[] };
  // El mazo se está barajando (icono y sacudida).
  shuffling?: boolean;
}

interface Frame extends Snapshot {
  // Espera (ms) desde la foto anterior hasta que sale el vuelo (o hasta
  // que se pasa a esta foto, si no hay vuelo).
  hold: number;
  // Carta que vuela para llegar a esta foto; sin vuelo, la foto cambia sin
  // más (p. ej. barajar).
  flight?: { id: string; from: FlightSource; to: FlightTarget };
}

interface Step extends Snapshot {
  title: string;
  text: string;
  // Zonas visibles en este paso, en este orden.
  show: ZoneId[];
  // Fotogramas que siguen a la foto base (ver arriba).
  frames?: Frame[];
  // Carta del mercado que se señala en este paso.
  target?: string;
  // Enseñar la píldora de PV (solo desde que se explican, en compras y al
  // final).
  showPv?: boolean;
  // Enseñar la reserva junto a mazo y descarte (solo cuando importa).
  reserve?: boolean;
  // Anatomía de la carta: carta grande con foco en una de sus partes.
  focus?: Focus;
  // Último paso: desglose del recuento final.
  final?: boolean;
}

const D_T1 = [PG, B, B, B, P, P];
const D_T2 = [...D_T1, MO, B, B, B, B, P];
const D_T3 = [HI, PG, PL, B, B, B, P];
const D_T4 = [...D_T3, LE, MO, B, B, P, P];

// Compra sencilla: foto base sin la carta, un fotograma con el vuelo
// mercado → descarte y la carta ya en el descarte.
function buyFrame(id: string, base: Snapshot, after: Partial<Snapshot>): Frame {
  return {
    ...base,
    ...after,
    hold: 350,
    flight: { id, from: 'market', to: 'discard' },
    glow: { discard: [id] },
  };
}

const T1_BASE: Snapshot = { deck: 5, hand: [B, B, B, P, P], played: [], discard: [], money: 3, pv: 0 };
const T2_BASE: Snapshot = { deck: 0, hand: [B, B, B, B, P], played: [], discard: D_T1, money: 4, pv: 2 };
const T3_BASE: Snapshot = { deck: 7, hand: [B, B, B, P, PL], played: [PG], discard: [], money: 5, pv: 6 };
const T4_BASE: Snapshot = { deck: 2, hand: [B, B, P, P], played: [MO], discard: D_T3, money: 5, pv: 10 };
const T5_BASE: Snapshot = { deck: 10, hand: [B, B, LE, MO, PL], played: [], discard: [], money: 4, pv: 14 };

const STEPS: Step[] = [
  {
    title: 'Tu mazo inicial',
    text: 'Empiezas con 10 cartas: 7 Bronce (cada una vale 1 de valor de compra) y 3 Perezosos (no valen nada: son relleno). Se barajan y forman tu mazo. Cada turno robas 5 cartas de él.',
    show: ['deckSpread'],
    deck: 10, hand: [], played: [], discard: [], pv: 0,
  },
  {
    title: 'Turno 1 · robas 5',
    text: 'Robas 5 cartas del mazo. Las monedas de tu mano suman tu VALOR DE COMPRA: 3 Bronce = 3.',
    show: ['piles', 'hand'],
    ...T1_BASE,
  },
  {
    title: 'El mercado',
    text: 'Aquí se compran animales. Con 3 de valor de compra, los que cuestan más quedan apagados. El Pingüino cuesta 3: puedes pagarlo. Pero antes, veamos qué pone en una carta.',
    show: ['market', 'hand'],
    ...T1_BASE, target: PG,
  },
  {
    title: 'Anatomía de una carta: el coste',
    text: 'Arriba a la izquierda: lo que cuesta comprarla en el mercado. Necesitas al menos ese valor de compra en tu turno.',
    show: ['bigcard'], focus: 'cost',
    ...T1_BASE, target: PG,
  },
  {
    title: 'Anatomía de una carta: los puntos de victoria',
    text: 'Arriba a la derecha: los PV. Al final de la partida se suman los PV de todas tus cartas, estén en el mazo, en la mano o en el descarte. Quien más tenga, gana.',
    show: ['bigcard'], focus: 'pv',
    ...T1_BASE, target: PG,
  },
  {
    title: 'Anatomía de una carta: el tipo',
    text: 'Abajo: su hábitat. Terrestre, volador o acuático (algunos animales tienen dos). Muchas habilidades cuentan animales de un hábitat concreto, así que conviene fijarse.',
    show: ['bigcard'], focus: 'types',
    ...T1_BASE, target: PG,
  },
  {
    title: 'Anatomía de una carta: la habilidad',
    text: 'Lo que hace al JUGARLA desde tu mano. El Pingüino añade una moneda de Plata a tu mano. En la app, mantén pulsada una carta (o pasa el ratón) para leer su habilidad.',
    show: ['bigcard'], focus: 'ability',
    ...T1_BASE, target: PG,
  },
  {
    title: 'Compras el Pingüino',
    text: 'Pagas con las monedas de la mano y la carta nueva va DIRECTA a tu descarte, no a la mano. Sus 2 PV ya cuentan para ti.',
    show: ['market', 'piles'],
    ...T1_BASE, target: PG, showPv: true,
    frames: [buyFrame(PG, T1_BASE, { discard: [PG], money: 0, pv: 2 })],
  },
  {
    title: 'Fin del turno 1',
    text: 'Al terminar el turno, TODA tu mano (la hayas usado o no) va también al descarte. Ahí se acumula todo hasta que el mazo se agote.',
    show: ['hand', 'piles'],
    deck: 5, hand: [], played: [], discard: D_T1, pv: 2,
  },
  {
    title: 'Turno 2 · robas 5',
    text: 'Robas las 5 cartas que quedaban: 4 Bronce y 1 Perezoso. El mazo se queda vacío. Valor de compra: 4.',
    show: ['piles', 'hand'],
    ...T2_BASE,
  },
  {
    title: 'Compras el Mono',
    text: 'El Mono cuesta 4 y vale 3 PV. Va al descarte con el resto. Llevas 5 PV.',
    show: ['market', 'piles'],
    ...T2_BASE, target: MO, showPv: true,
    frames: [buyFrame(MO, T2_BASE, { discard: [...D_T1, MO], money: 0, pv: 5 })],
  },
  {
    title: 'Fin del turno 2',
    text: 'Tu mano va al descarte: ya tienes 12 cartas ahí y ninguna en el mazo.',
    show: ['hand', 'piles'],
    deck: 0, hand: [], played: [], discard: D_T2, pv: 5,
  },
  {
    title: 'Turno 3 · ¡a barajar!',
    text: 'Toca robar y el mazo está vacío: barajas TODO el descarte y pasa a ser tu nuevo mazo. Así es como los animales que compras acaban llegando a tu mano.',
    show: ['piles'],
    deck: 12, hand: [], played: [], discard: [], shuffling: true, pv: 5,
  },
  {
    title: 'Robas 5, juegas el Pingüino y compras el Hipopótamo',
    text: 'Esta vez te sale el Pingüino. Los animales de la mano se pueden JUGAR: el Pingüino pasa a "Jugado este turno" y su habilidad te trae una moneda de Plata (vale 2) de la reserva a tu mano. Valor de compra: 3 + 2 = 5, justo lo que cuesta el Hipopótamo (4 PV): lo compras y va DIRECTO a tu descarte. La Plata, además, vale 1 PV. Ya llevas 10.',
    show: ['piles', 'hand', 'played'],
    reserve: true, showPv: true,
    deck: 7, hand: [PG, B, B, B, P], played: [], discard: [], money: 3, pv: 5,
    frames: [
      {
        hold: 1100,
        flight: { id: PG, from: 'hand', to: 'played' },
        deck: 7, hand: [B, B, B, P], played: [PG], discard: [], money: 3, pv: 5,
        glow: { played: [PG] },
      },
      {
        hold: 700,
        flight: { id: PL, from: 'reserve', to: 'hand' },
        ...T3_BASE,
        glow: { hand: [PL] },
      },
      {
        hold: 900,
        flight: { id: HI, from: 'reserve', to: 'discard' },
        ...T3_BASE, discard: [HI], money: 0, pv: 10,
        glow: { discard: [HI] },
      },
    ],
  },
  {
    title: 'Fin del turno 3',
    text: 'La mano y las cartas jugadas van al descarte, incluida la Plata nueva: a partir de ahora forma parte de tu mazo.',
    show: ['hand', 'played', 'piles'],
    deck: 7, hand: [], played: [], discard: D_T3, pv: 10,
  },
  {
    title: 'Turno 4 · robas 5',
    text: 'Robas 5 de las 7 del mazo: te salen el Mono, 2 Bronce y 2 Perezosos. Solo 2 de valor de compra… de momento.',
    show: ['piles', 'hand'],
    deck: 2, hand: [MO, B, B, P, P], played: [], discard: D_T3, money: 2, pv: 10,
  },
  {
    title: 'Juegas el Mono y compras el León',
    text: 'El Mono da +1 de valor de compra por cada animal terrestre de tu mano, contándose a sí mismo: Mono + 2 Perezosos = +3. ¡Hasta el Perezoso sirve para algo! Valor de compra: 2 + 3 = 5, lo que cuesta el León (4 PV): lo compras y va al descarte. Llevas 14 PV.',
    show: ['market', 'piles', 'hand', 'played'],
    deck: 2, hand: [MO, B, B, P, P], played: [], discard: D_T3, money: 2, pv: 10, target: LE, showPv: true,
    frames: [
      { hold: 1100, flight: { id: MO, from: 'hand', to: 'played' }, ...T4_BASE, glow: { played: [MO] } },
      {
        hold: 900,
        flight: { id: LE, from: 'market', to: 'discard' },
        ...T4_BASE, discard: [...D_T3, LE], money: 0, pv: 14,
        glow: { discard: [LE] },
      },
    ],
  },
  {
    title: 'Fin del turno 4',
    text: 'Todo al descarte (13 cartas). En el mazo solo quedan 2.',
    show: ['hand', 'played', 'piles'],
    deck: 2, hand: [], played: [], discard: D_T4, pv: 14,
  },
  {
    title: 'Turno 5 · el mazo se acaba a mitad de robo',
    text: 'Robas 2 Bronce y el mazo se queda vacío antes de completar la mano de 5… así que barajas las 13 del descarte, que pasan a ser tu mazo, y de ahí robas las 3 que faltan.',
    show: ['piles', 'hand'],
    deck: 0, hand: [B, B], played: [], discard: D_T4, pv: 14,
    frames: [
      { hold: 1400, deck: 13, hand: [B, B], played: [], discard: [], shuffling: true, pv: 14 },
      { hold: 1600, ...T5_BASE, glow: { hand: [LE, MO, PL] } },
    ],
  },
  {
    title: 'Juegas León y Mono, y compras el Oso polar',
    text: 'Te salen el León, el Mono y la Plata: 1 + 1 + 2 = 4. Juegas el León (+3 fijos → 7) y el Mono (+2: él y el León → 9), y compras el Oso polar (7). Tiene 0 PV impresos, pero da +1 PV por cada terrestre de TODO tu mazo: 3 Perezosos, Mono, Hipopótamo, León y él mismo = +7. Te sobran 2: lo que no gastas se pierde al terminar el turno.',
    show: ['market', 'piles', 'hand', 'played'],
    ...T5_BASE, target: OS, showPv: true,
    frames: [
      {
        hold: 1300,
        flight: { id: LE, from: 'hand', to: 'played' },
        deck: 10, hand: [B, B, MO, PL], played: [LE], discard: [], money: 7, pv: 14,
        glow: { played: [LE] },
      },
      {
        hold: 900,
        flight: { id: MO, from: 'hand', to: 'played' },
        deck: 10, hand: [B, B, PL], played: [LE, MO], discard: [], money: 9, pv: 14,
        glow: { played: [MO] },
      },
      {
        hold: 900,
        flight: { id: OS, from: 'market', to: 'discard' },
        deck: 10, hand: [B, B, PL], played: [LE, MO], discard: [OS], money: 2, pv: 21,
        glow: { discard: [OS] },
      },
    ],
  },
  {
    title: 'Fin de la partida: recuento',
    text: 'Cuando termina la última ronda, cada jugador suma los PV de TODAS sus cartas, estén en el mazo, en la mano o en el descarte. Gana quien tenga más.',
    show: ['final'],
    deck: 10, hand: [B, B, PL], played: [LE, MO], discard: [OS], pv: 21, showPv: true, final: true,
  },
];

const FINAL_BREAKDOWN: { id: string; label: string; pv: number; note?: string }[] = [
  { id: PG, label: 'Pingüino', pv: 2 },
  { id: MO, label: 'Mono', pv: 3 },
  { id: HI, label: 'Hipopótamo', pv: 4 },
  { id: LE, label: 'León', pv: 4 },
  { id: PL, label: 'Plata', pv: 1 },
  { id: OS, label: 'Oso polar', pv: 7, note: '0 impresos + 7 terrestres en el mazo' },
  { id: B, label: 'Bronce ×7 y Perezoso ×3', pv: 0 },
];

const HABITAT_LABEL: Record<string, string> = { land: 'Terrestre', bird: 'Volador', aquatic: 'Acuático' };

const FOCUS_ROWS: { key: Focus; label: string; value: (c: CardInstance) => string }[] = [
  { key: 'cost', label: 'Coste', value: (c) => String(c.marketCost ?? 0) },
  { key: 'pv', label: 'Puntos de victoria', value: (c) => `${c.victoryPoints} PV` },
  { key: 'types', label: 'Tipo', value: (c) => c.habitats.map((h) => HABITAT_LABEL[h] ?? h).join(' · ') },
  { key: 'ability', label: 'Habilidad', value: (c) => c.text },
];

const AUTOPLAY_MS = 5500;
// Vuelo de una carta: despacio a propósito (pedido del usuario 2026-09-22),
// bastante más lento que el de la partida.
const FLIGHT_MS = 1600;
const FLIGHT_HOLD_MS = 450;
const FLIGHT_FADE_MS = 350;
const FLIGHT_START_MS = 60;

function stepDurationMs(step: Step): number {
  return (step.frames ?? []).reduce((sum, f) => sum + f.hold + (f.flight ? FLIGHT_START_MS + FLIGHT_MS + FLIGHT_HOLD_MS : 0), 0);
}

function inst(id: string, key: string): CardInstance {
  return { ...getCard(id), instanceId: `tutorial-${key}` };
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Flight {
  key: string;
  id: string;
  from: Rect;
  to: Rect;
  source: FlightSource;
}

function FlightGhost({ flight, onLand, onDone }: { flight: Flight; onLand: () => void; onDone: () => void }) {
  const [phase, setPhase] = useState<'start' | 'flying' | 'holding' | 'fading'>('start');
  const elRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Fuerza el cálculo de estilo/layout con la posición de salida ANTES de
    // cambiar a la de llegada: sin esto, si el navegador aún no había
    // pintado el fantasma, la transición no tiene "desde" y la carta salta
    // al destino en vez de volar.
    void elRef.current?.getBoundingClientRect();
    const t = window.setTimeout(() => setPhase('flying'), FLIGHT_START_MS);
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => {
    if (phase !== 'flying') return;
    const t = window.setTimeout(() => setPhase('holding'), FLIGHT_MS);
    return () => window.clearTimeout(t);
  }, [phase]);
  useEffect(() => {
    if (phase !== 'holding') return;
    const t = window.setTimeout(() => {
      onLand();
      setPhase('fading');
    }, FLIGHT_HOLD_MS);
    return () => window.clearTimeout(t);
  }, [phase]);
  useEffect(() => {
    if (phase !== 'fading') return;
    const t = window.setTimeout(onDone, FLIGHT_FADE_MS);
    return () => window.clearTimeout(t);
  }, [phase]);

  const at = phase === 'start' ? flight.from : flight.to;
  return (
    <div
      ref={elRef}
      className={`flying-card${phase === 'flying' || phase === 'holding' ? ' flying-card--glow' : ''}`}
      style={{
        left: at.x,
        top: at.y,
        width: at.w,
        height: at.h,
        opacity: phase === 'fading' ? 0 : 1,
        transition: `left ${FLIGHT_MS}ms ease-in-out, top ${FLIGHT_MS}ms ease-in-out, width ${FLIGHT_MS}ms ease-in-out, height ${FLIGHT_MS}ms ease-in-out, opacity ${FLIGHT_FADE_MS}ms ease, box-shadow 0.2s ease`,
      }}
    >
      <CardView card={inst(flight.id, 'flight')} compact hideType />
    </div>
  );
}

// Valor de compra: en su propia línea bajo el título de la zona.
function MoneyLine({ money }: { money: number }) {
  return (
    <div className="tutorial__money" key={money}>
      💰 Valor de compra: {money}
    </div>
  );
}

function toRect(r: DOMRect): Rect {
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

export function Tutorial({ onClose }: { onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  // Fotograma que se muestra (0 = foto base del paso) y vuelo en curso. El
  // fotograma va ATADO al índice del paso: si el paso cambia, en ese mismo
  // render ya cuenta como 0 — sin esto, el primer render del paso nuevo
  // usaba el fotograma del anterior y, en un paso sin fotogramas, no existía
  // (pantalla en blanco al pulsar "Siguiente" tras una secuencia terminada).
  const [frameState, setFrameState] = useState({ index: 0, shown: 0 });
  const [flight, setFlight] = useState<Flight | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const discardRef = useRef<HTMLDivElement>(null);
  const reserveRefs = useRef(new Map<string, HTMLDivElement>());
  const finalRef = useRef<HTMLDivElement>(null);
  const marketRefs = useRef(new Map<string, HTMLDivElement>());
  const zoneCardsRefs = useRef(new Map<string, HTMLDivElement>());
  const cardRefs = useRef(new Map<string, HTMLDivElement>());

  const step = STEPS[index];
  const isLast = index === STEPS.length - 1;
  const visible = (zone: ZoneId) => step.show.includes(zone);
  const frames = step.frames ?? [];
  const shownFrame = frameState.index === index ? Math.min(frameState.shown, frames.length) : 0;
  const shown: Snapshot = shownFrame === 0 ? step : frames[shownFrame - 1];
  const advanceFrame = () => setFrameState((s) => ({ index, shown: (s.index === index ? s.shown : 0) + 1 }));
  // Siguiente fotograma pendiente (el que traerá el vuelo en curso).
  const pendingFrame = shownFrame < frames.length ? frames[shownFrame] : null;

  // Secuenciador: al entrar en un paso, foto base; tras `hold` del
  // siguiente fotograma, se mide de dónde sale y a dónde va la carta y se
  // lanza el vuelo; al aterrizar (onLand) se pasa a esa foto y se encadena
  // el siguiente. Se reinicia entero al cambiar de paso.
  useLayoutEffect(() => {
    setFrameState({ index, shown: 0 });
    setFlight(null);
  }, [index]);

  useEffect(() => {
    if (!pendingFrame || flight) return;
    const t = window.setTimeout(() => {
      if (!pendingFrame.flight) {
        advanceFrame();
        return;
      }
      const { id, from, to } = pendingFrame.flight;
      const src =
        from === 'market'
          ? marketRefs.current.get(id)
          : from === 'reserve'
            ? reserveRefs.current.get(id)
            : cardRefs.current.get(`hand-${shown.hand.indexOf(id)}`);
      const srcRect = src?.getBoundingClientRect();
      if (!srcRect) {
        advanceFrame();
        return;
      }
      const size = { w: srcRect.width, h: srcRect.height };
      let dest: Rect | null = null;
      if (to === 'discard') {
        const d = discardRef.current?.getBoundingClientRect();
        const stack = Math.min(shown.discard.length, 2);
        if (d) dest = { x: d.left + stack * 12, y: d.top + stack * 5, ...size };
      } else {
        const zoneKey = to === 'played' ? 'played' : 'hand';
        const cards = zoneCardsRefs.current.get(zoneKey);
        const count = to === 'played' ? shown.played.length : shown.hand.length;
        const last = count > 0 ? cardRefs.current.get(`${zoneKey}-${count - 1}`)?.getBoundingClientRect() : null;
        const zr = cards?.getBoundingClientRect();
        if (last) dest = { x: last.right + 6, y: last.top, ...size };
        else if (zr) dest = { x: zr.left, y: zr.top, ...size };
      }
      if (!dest) {
        advanceFrame();
        return;
      }
      setFlight({ key: `${index}-${shownFrame}`, id, from: toRect(srcRect), to: dest, source: from });
    }, pendingFrame.hold);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, shownFrame, flight]);

  // Al cambiar de paso, arriba del todo; en el último paso, hasta la tabla
  // del recuento. Solo importa en móvil: en escritorio cabe todo sin scroll.
  useEffect(() => {
    const target = step.final ? finalRef.current : null;
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [index]);

  useEffect(() => {
    if (!playing) return;
    if (isLast) {
      setPlaying(false);
      return;
    }
    const wait = Math.max(AUTOPLAY_MS, stepDurationMs(step) + 2500);
    const t = window.setTimeout(() => setIndex((i) => Math.min(i + 1, STEPS.length - 1)), wait);
    return () => window.clearTimeout(t);
  }, [playing, index, isLast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, STEPS.length - 1));
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0));
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Móvil: el bocadillo del texto es fijo arriba (ver styles.css) y su
  // altura cambia con cada paso; se mide y se publica como --tut-bubble-h
  // para que el tablero empiece justo debajo y nunca quede tapado.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const bubble = bubbleRef.current;
    if (!root || !bubble) return;
    const apply = () => root.style.setProperty('--tut-bubble-h', `${bubble.offsetHeight}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(bubble);
    return () => observer.disconnect();
  }, []);

  const topDiscard = shown.discard.slice(-3);
  // Mientras una carta de la mano vuela a la mesa, su hueco se queda medio
  // transparente (igual que en el mercado al comprar).
  const leavingHandIndex = flight && flight.source === 'hand' ? shown.hand.indexOf(flight.id) : -1;
  // El valor de compra va en la cabecera del mercado si se ve; si no, en la
  // de la mano (pasos de jugar cartas).
  const moneyInMarket = shown.money !== undefined && visible('market');
  const moneyInHand = shown.money !== undefined && !visible('market') && visible('hand');
  const bigCard = step.focus ? inst(step.target ?? PG, 'big') : null;

  const setCardRef = (key: string) => (el: HTMLDivElement | null) => {
    if (el) cardRefs.current.set(key, el);
    else cardRefs.current.delete(key);
  };

  function renderCards(zone: 'hand' | 'played' | 'deck-bronze' | 'deck-sloths', cards: string[], empty: string, glow?: string[]) {
    return (
      <div
        className="tutorial__cards"
        ref={(el) => {
          if (el) zoneCardsRefs.current.set(zone, el);
          else zoneCardsRefs.current.delete(zone);
        }}
      >
        {cards.length === 0 && <span className="tutorial__empty">{empty}</span>}
        {cards.map((id, i) => (
          <div
            // Clave por identidad (n-ésima copia de esa carta), no por
            // posición: cuando una carta se va de la mano, las demás
            // conservan su clave y no "reaparecen" con animación.
            key={`${zone}-${id}-${cards.slice(0, i).filter((c) => c === id).length}`}
            ref={setCardRef(`${zone}-${i}`)}
            className={`tutorial__card${glow?.includes(id) ? ' tutorial__card--arrive' : ''}${
              zone === 'hand' && i === leavingHandIndex ? ' tutorial__card--leaving' : ''
            }`}
          >
            <CardView card={inst(id, `${zone}-${i}`)} compact hideType />
          </div>
        ))}
      </div>
    );
  }

  const zones: Record<ZoneId, () => ReactNode> = {
    deckSpread: () => (
      <section className="tutorial__zone tutorial__zone--deck-spread">
        <h4>Tu mazo · 10 cartas (antes de barajar)</h4>
        {renderCards('deck-bronze', STARTER_BRONZE, '')}
        {renderCards('deck-sloths', STARTER_SLOTHS, '')}
      </section>
    ),
    market: () => (
      <section className="tutorial__zone tutorial__zone--market">
        <h4>Mercado</h4>
        {moneyInMarket && <MoneyLine money={shown.money!} />}
        <div className="tutorial__cards">
          {MARKET.map((id) => {
            const cost = getCard(id).marketCost ?? 0;
            const tooExpensive = shown.money !== undefined && cost > shown.money && id !== step.target;
            const isTarget = id === step.target;
            const leaving = flight?.source === 'market' && flight.id === id;
            return (
              <div
                key={`market-${id}`}
                ref={(el) => {
                  if (el) marketRefs.current.set(id, el);
                  else marketRefs.current.delete(id);
                }}
                className={`tutorial__card${isTarget ? ' tutorial__card--highlight' : ''}${leaving ? ' tutorial__card--leaving' : ''}`}
              >
                <CardView card={inst(id, `market-${id}`)} compact disabled={tooExpensive} />
              </div>
            );
          })}
        </div>
      </section>
    ),
    hand: () => (
      <section className="tutorial__zone tutorial__zone--hand">
        <h4>Tu mano</h4>
        {moneyInHand && <MoneyLine money={shown.money!} />}
        {renderCards('hand', shown.hand, 'vacía', shown.glow?.hand)}
      </section>
    ),
    played: () => (
      <section className="tutorial__zone tutorial__zone--played">
        <h4>Jugado este turno</h4>
        {renderCards('played', shown.played, 'nada todavía', shown.glow?.played)}
      </section>
    ),
    piles: () => (
      <div className="tutorial__piles">
        <div className="tutorial__pile">
          <h4>Mazo</h4>
          <div className={`card card--compact card--facedown${shown.shuffling ? ' tutorial__deck--shuffling' : ''}`}>
            <span className="card__icon">{shown.shuffling ? '🔀' : '🂠'}</span>
            <span className="card__badge">{shown.deck}</span>
          </div>
          {shown.shuffling && <span className="tutorial__shuffle-label">barajando el descarte…</span>}
          {step.showPv && (
            <div className="tutorial__pv" key={shown.pv}>
              ⭐ {shown.pv} <small>PV</small>
            </div>
          )}
        </div>

        <div className="tutorial__pile tutorial__pile--discard">
          <h4>Descarte · {shown.discard.length}</h4>
          <div className="tutorial__discard" ref={discardRef}>
            {topDiscard.length === 0 && <div className="card card--compact card--empty" />}
            {topDiscard.map((id, i) => {
              const isNew = i === topDiscard.length - 1 && shown.glow?.discard?.includes(id);
              return (
                <div
                  key={`discard-${shown.discard.length - topDiscard.length + i}-${id}`}
                  className={`tutorial__card tutorial__discard-card${isNew ? ' tutorial__card--highlight' : ''}`}
                  style={{ '--stack-i': i } as CSSProperties}
                >
                  <CardView card={inst(id, `discard-${i}`)} compact hideType />
                </div>
              );
            })}
          </div>
        </div>

        {step.reserve && (
          <div className="tutorial__pile tutorial__pile--reserve">
            <h4>Reserva</h4>
            <div className="tutorial__cards">
              {RESERVE.map((id) => {
                const leaving = flight?.source === 'reserve' && flight.id === id;
                return (
                  <div
                    key={`reserve-${id}`}
                    ref={(el) => {
                      if (el) reserveRefs.current.set(id, el);
                      else reserveRefs.current.delete(id);
                    }}
                    className={`tutorial__card${leaving ? ' tutorial__card--leaving' : ''}`}
                  >
                    <CardView card={inst(id, `reserve-${id}`)} compact hideType remainingLabel="∞" />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    ),
    bigcard: () =>
      bigCard && (
        <section className={`tutorial__zone tutorial__bigcard tutorial__bigcard--focus-${step.focus}`}>
          <div className="tutorial__bigcard-card">
            <CardView card={bigCard} />
          </div>
          <dl className="tutorial__legend">
            {FOCUS_ROWS.map((row) => (
              <div key={row.key} className={`tutorial__legend-row${row.key === step.focus ? ' tutorial__legend-row--active' : ''}`}>
                <dt>{row.label}</dt>
                <dd>{row.value(bigCard)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ),
    final: () => (
      <div className="tutorial__final" ref={finalRef}>
        <table className="summary-table">
          <thead>
            <tr>
              <th>Carta</th>
              <th>PV</th>
            </tr>
          </thead>
          <tbody>
            {FINAL_BREAKDOWN.map((row) => (
              <tr key={row.id}>
                <td>
                  {row.label}
                  {row.note && <small className="tutorial__note"> · {row.note}</small>}
                </td>
                <td>{row.pv}</td>
              </tr>
            ))}
            <tr className="tutorial__total">
              <td>Total</td>
              <td>
                <span className="tutorial__pv">
                  ⭐ {step.pv} <small>PV</small>
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    ),
  };

  return (
    <div className="app app--setup">
      <div className="panel setup-panel setup-panel--wide tutorial" ref={rootRef}>
        <div className="panel__header">
          <h2>🎓 Tutorial</h2>
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            ✕ Cerrar
          </button>
        </div>

        <div className="tutorial__step" ref={bubbleRef}>
          <div className="tutorial__step-inner" key={index}>
            <div className="tutorial__progress">
              Paso {index + 1} de {STEPS.length}
              <span className="tutorial__progress-bar">
                <span style={{ width: `${((index + 1) / STEPS.length) * 100}%` }} />
              </span>
            </div>
            <h3>{step.title}</h3>
            <p>{step.text}</p>
          </div>
        </div>

        <div className="tutorial__board">
          {step.show.map((zone) => (
            <div key={zone} className={`tutorial__slot tutorial__slot--${zone}`}>
              {zones[zone]()}
            </div>
          ))}
        </div>

        <div className="tutorial__controls">
          <button className="btn btn--ghost" type="button" disabled={index === 0} onClick={() => setIndex(index - 1)}>
            ← Anterior
          </button>
          <button
            className="btn btn--ghost"
            type="button"
            onClick={() => {
              if (isLast) {
                setIndex(0);
                setPlaying(true);
              } else {
                setPlaying((p) => !p);
              }
            }}
          >
            {isLast ? '↺ Volver a empezar' : playing ? '⏸ Pausa' : '▶ Reproducir'}
          </button>
          {isLast ? (
            <button className="btn btn--primary" type="button" onClick={onClose}>
              ✓ Entendido
            </button>
          ) : (
            <button className="btn btn--primary" type="button" onClick={() => setIndex(index + 1)}>
              Siguiente →
            </button>
          )}
        </div>

        {/* Dentro de .tutorial a propósito: así hereda el tamaño de carta
            compacta del tutorial (más pequeña en teléfonos) y el fantasma
            mide exactamente lo mismo que la carta de la que sale.
            position:fixed sigue siendo respecto a la ventana. */}
        {flight && (
          <FlightGhost
            key={flight.key}
            flight={flight}
            onLand={advanceFrame}
            onDone={() => setFlight(null)}
          />
        )}
      </div>
    </div>
  );
}
