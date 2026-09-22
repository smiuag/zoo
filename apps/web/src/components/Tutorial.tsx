import { useEffect, useState } from 'react';
import { getCard, type CardInstance } from '@zoo/engine';
import { CardView } from './CardView';

// Tutorial paso a paso (pedido explícito del usuario 2026-09-22): una
// partida de ejemplo en solitario, contada con textos, donde se ve cómo se
// roba, cómo se compra, cómo lo comprado va al DESCARTE, cómo se baraja el
// descarte cuando el mazo se acaba, cómo las habilidades suben el valor de
// compra y cómo se suman los PV al final. No usa el motor: cada paso es una
// foto fija de las zonas (mazo/mano/jugado/descarte/mercado/PV) escrita a
// mano siguiendo las reglas reales; la aritmética está comprobada contra
// los datos de carta (coste/PV/efectos) y el motor (el Mono se cuenta a sí
// mismo vía effectiveHand; el Oso polar se cuenta a sí mismo en
// scorePerHabitatCount; el Hipopótamo es terrestre Y acuático; la Plata
// vale 1 PV). Si cambian esos datos, hay que revisar los números de aquí.
//
// Se abre desde la pantalla de inicio SOLO con la edición Aprendizaje
// seleccionada (botón "Ver tutorial"). Ojo: el guion usa Hipopótamo (5),
// León (5) y Oso polar (7), que por coste NO salen en el mercado de la
// edición Aprendizaje (máximo 4) — están a propósito, elegidas por el
// usuario para enseñar habilidades y el recuento final.

const B = 'coin-1';
const P = 'sloth';
const PL = 'coin-2';
const PG = 'penguin';
const MO = 'monkey';
const HI = 'hippopotamus';
const LE = 'lion';
const OS = 'polar-bear';

interface Step {
  title: string;
  text: string;
  deck: number;
  hand: string[];
  played: string[];
  // Orden de llegada: la última es la de arriba del montón.
  discard: string[];
  // Carta del mercado que se enseña en este paso (si procede).
  market?: string;
  // Valor de compra actual; ausente = no se muestra (fuera de turno).
  money?: number;
  pv: number;
  shuffling?: boolean;
  // Última carta comprada (se resalta en el descarte).
  bought?: string;
  // Último paso: desglose del recuento final.
  final?: boolean;
}

const D_T1 = [PG, B, B, B, P, P];
const D_T2 = [...D_T1, MO, B, B, B, B, P];
const D_T3 = [HI, PG, PL, B, B, B, P];
const D_T4 = [...D_T3, LE, MO, B, B, P, P];

const STEPS: Step[] = [
  {
    title: 'Tu mazo inicial',
    text: 'Empiezas con 10 cartas: 7 Bronce (cada una vale 1 de valor de compra) y 3 Perezosos (no valen nada: son relleno). Cada turno robas 5 cartas del mazo.',
    deck: 10, hand: [], played: [], discard: [], pv: 0,
  },
  {
    title: 'Turno 1 · robas 5',
    text: 'Robas 5 cartas. Las monedas de tu mano suman tu VALOR DE COMPRA: 3 Bronce = 3.',
    deck: 5, hand: [B, B, B, P, P], played: [], discard: [], money: 3, pv: 0,
  },
  {
    title: 'El mercado',
    text: 'Cada animal del mercado tiene un coste (arriba a la izquierda) y unos puntos de victoria, PV (arriba a la derecha). El Pingüino cuesta 3: puedes pagarlo.',
    deck: 5, hand: [B, B, B, P, P], played: [], discard: [], market: PG, money: 3, pv: 0,
  },
  {
    title: 'Compras el Pingüino',
    text: 'Pagas con las monedas de la mano y la carta nueva va DIRECTA a tu descarte, no a la mano. Sus 2 PV ya cuentan para ti.',
    deck: 5, hand: [B, B, B, P, P], played: [], discard: [PG], market: PG, bought: PG, money: 0, pv: 2,
  },
  {
    title: 'Fin del turno 1',
    text: 'Al terminar el turno, TODA tu mano (la hayas usado o no) va también al descarte. Ahí se acumula todo hasta que el mazo se agote.',
    deck: 5, hand: [], played: [], discard: D_T1, pv: 2,
  },
  {
    title: 'Turno 2 · robas 5',
    text: 'Robas las 5 cartas que quedaban: 4 Bronce y 1 Perezoso. El mazo se queda vacío. Valor de compra: 4.',
    deck: 0, hand: [B, B, B, B, P], played: [], discard: D_T1, money: 4, pv: 2,
  },
  {
    title: 'Compras el Mono',
    text: 'El Mono cuesta 4 y vale 3 PV. Va al descarte con el resto. Llevas 5 PV.',
    deck: 0, hand: [B, B, B, B, P], played: [], discard: [...D_T1, MO], market: MO, bought: MO, money: 0, pv: 5,
  },
  {
    title: 'Fin del turno 2',
    text: 'Tu mano va al descarte: ya tienes 12 cartas ahí y ninguna en el mazo.',
    deck: 0, hand: [], played: [], discard: D_T2, pv: 5,
  },
  {
    title: 'Turno 3 · ¡a barajar!',
    text: 'Toca robar y el mazo está vacío: barajas TODO el descarte y pasa a ser tu nuevo mazo. Así es como los animales que compras acaban llegando a tu mano.',
    deck: 12, hand: [], played: [], discard: [], shuffling: true, pv: 5,
  },
  {
    title: 'Robas 5',
    text: 'Esta vez te sale el Pingüino. Los animales de la mano se pueden JUGAR para activar su habilidad.',
    deck: 7, hand: [PG, B, B, B, P], played: [], discard: [], money: 3, pv: 5,
  },
  {
    title: 'Juegas el Pingüino',
    text: 'Al jugarlo pasa a "Jugado este turno" y su habilidad añade una moneda de Plata (vale 2) a tu mano. Valor de compra: 3 + 2 = 5. La Plata, además, vale 1 PV.',
    deck: 7, hand: [B, B, B, P, PL], played: [PG], discard: [], money: 5, pv: 6,
  },
  {
    title: 'Compras el Hipopótamo',
    text: 'El Hipopótamo cuesta 5 y vale 4 PV. Ya llevas 10 PV.',
    deck: 7, hand: [B, B, B, P, PL], played: [PG], discard: [HI], market: HI, bought: HI, money: 0, pv: 10,
  },
  {
    title: 'Fin del turno 3',
    text: 'La mano y las cartas jugadas van al descarte, incluida la Plata nueva: a partir de ahora forma parte de tu mazo.',
    deck: 7, hand: [], played: [], discard: D_T3, pv: 10,
  },
  {
    title: 'Turno 4 · robas 5',
    text: 'Robas 5 de las 7 del mazo: te salen el Mono, 2 Bronce y 2 Perezosos. Solo 2 de valor de compra… de momento.',
    deck: 2, hand: [MO, B, B, P, P], played: [], discard: D_T3, money: 2, pv: 10,
  },
  {
    title: 'Juegas el Mono',
    text: 'El Mono da +1 de valor de compra por cada animal terrestre de tu mano, contándose a sí mismo: Mono + 2 Perezosos = +3. ¡Hasta el Perezoso sirve para algo! Valor de compra: 2 + 3 = 5.',
    deck: 2, hand: [B, B, P, P], played: [MO], discard: D_T3, money: 5, pv: 10,
  },
  {
    title: 'Compras el León',
    text: 'El León cuesta 5 y vale 4 PV. Llevas 14 PV.',
    deck: 2, hand: [B, B, P, P], played: [MO], discard: [...D_T3, LE], market: LE, bought: LE, money: 0, pv: 14,
  },
  {
    title: 'Fin del turno 4',
    text: 'Todo al descarte (13 cartas). En el mazo solo quedan 2.',
    deck: 2, hand: [], played: [], discard: D_T4, pv: 14,
  },
  {
    title: 'Turno 5 · el mazo se acaba a mitad de robo',
    text: 'Robas 2 Bronce y el mazo se queda vacío antes de completar la mano de 5…',
    deck: 0, hand: [B, B], played: [], discard: D_T4, pv: 14,
  },
  {
    title: '…así que barajas y sigues robando',
    text: 'Barajas las 13 del descarte, que pasan a ser tu mazo, y de ahí robas las 3 que faltan.',
    deck: 13, hand: [B, B], played: [], discard: [], shuffling: true, pv: 14,
  },
  {
    title: 'Mano completa',
    text: 'Te salen el León, el Mono y la Plata. Valor de compra de las monedas: 1 + 1 + 2 = 4.',
    deck: 10, hand: [B, B, LE, MO, PL], played: [], discard: [], money: 4, pv: 14,
  },
  {
    title: 'Juegas el León',
    text: 'El León añade 3 fijos al valor de compra: 4 + 3 = 7.',
    deck: 10, hand: [B, B, MO, PL], played: [LE], discard: [], money: 7, pv: 14,
  },
  {
    title: 'Juegas el Mono',
    text: 'Terrestres en juego: el propio Mono y el León = +2. Valor de compra: 9. Puedes jugar varios animales en el mismo turno, en el orden que quieras.',
    deck: 10, hand: [B, B, PL], played: [LE, MO], discard: [], money: 9, pv: 14,
  },
  {
    title: 'Compras el Oso polar',
    text: 'El Oso polar cuesta 7 y tiene 0 PV impresos, pero da +1 PV por cada animal terrestre de TODO tu mazo: 3 Perezosos, Mono, Hipopótamo, León y él mismo = +7. Te sobran 2 de valor de compra: lo que no gastas se pierde al terminar el turno.',
    deck: 10, hand: [B, B, PL], played: [LE, MO], discard: [OS], market: OS, bought: OS, money: 2, pv: 21,
  },
  {
    title: 'Fin de la partida: recuento',
    text: 'Cuando termina la última ronda, cada jugador suma los PV de TODAS sus cartas, estén en el mazo, en la mano o en el descarte. Gana quien tenga más.',
    deck: 10, hand: [B, B, PL], played: [LE, MO], discard: [OS], pv: 21, final: true,
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

const AUTOPLAY_MS = 4500;

function inst(id: string, key: string): CardInstance {
  return { ...getCard(id), instanceId: `tutorial-${key}` };
}

function Zone({
  title,
  zone,
  cards,
  empty,
  highlight,
}: {
  title: string;
  zone: string;
  cards: string[];
  empty: string;
  highlight?: string;
}) {
  return (
    <section className={`tutorial__zone tutorial__zone--${zone}`}>
      <h4>{title}</h4>
      <div className="tutorial__cards">
        {cards.length === 0 && <span className="tutorial__empty">{empty}</span>}
        {cards.map((id, i) => (
          <div
            key={`${zone}-${i}-${id}`}
            className={`tutorial__card${highlight === id ? ' tutorial__card--highlight' : ''}`}
          >
            <CardView card={inst(id, `${zone}-${i}`)} compact hideType />
          </div>
        ))}
      </div>
    </section>
  );
}

export function Tutorial({ onClose }: { onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const step = STEPS[index];
  const isLast = index === STEPS.length - 1;

  useEffect(() => {
    if (!playing) return;
    if (isLast) {
      setPlaying(false);
      return;
    }
    const t = window.setTimeout(() => setIndex((i) => Math.min(i + 1, STEPS.length - 1)), AUTOPLAY_MS);
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

  const topDiscard = step.discard.slice(-3);

  return (
    <div className="app app--setup">
      <div className="panel setup-panel setup-panel--wide tutorial">
        <div className="panel__header">
          <h2>🎓 Tutorial</h2>
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            ✕ Cerrar
          </button>
        </div>

        <div className="tutorial__step" key={index}>
          <div className="tutorial__progress">
            Paso {index + 1} de {STEPS.length}
            <span className="tutorial__progress-bar">
              <span style={{ width: `${((index + 1) / STEPS.length) * 100}%` }} />
            </span>
          </div>
          <h3>{step.title}</h3>
          <p>{step.text}</p>
        </div>

        <div className="tutorial__board">
          <section className="tutorial__zone tutorial__zone--market">
            <h4>
              Mercado
              {step.money !== undefined && (
                <span className="tutorial__money" key={step.money}>
                  💰 Valor de compra: {step.money}
                </span>
              )}
            </h4>
            <div className="tutorial__cards">
              {step.market ? (
                <div
                  key={`market-${step.market}-${step.bought ?? ''}`}
                  className={`tutorial__card${step.bought ? ' tutorial__card--bought' : ''}`}
                >
                  <CardView card={inst(step.market, 'market')} compact />
                </div>
              ) : (
                <span className="tutorial__empty">(el resto del mercado no importa ahora)</span>
              )}
            </div>
          </section>

          <Zone title="Tu mano" zone="hand" cards={step.hand} empty="vacía" />
          <Zone title="Jugado este turno" zone="played" cards={step.played} empty="nada todavía" />

          <div className="tutorial__piles">
            <div className="tutorial__pile">
              <h4>Mazo</h4>
              <div className={`card card--compact card--facedown${step.shuffling ? ' tutorial__deck--shuffling' : ''}`}>
                <span className="card__icon">{step.shuffling ? '🔀' : '🂠'}</span>
                <span className="card__badge">{step.deck}</span>
              </div>
              {step.shuffling && <span className="tutorial__shuffle-label">barajando el descarte…</span>}
            </div>

            <div className="tutorial__pile">
              <h4>Descarte · {step.discard.length}</h4>
              <div className="tutorial__discard">
                {topDiscard.length === 0 && <div className="card card--compact card--empty" />}
                {topDiscard.map((id, i) => (
                  <div
                    key={`discard-${step.discard.length - topDiscard.length + i}-${id}`}
                    className={`tutorial__card tutorial__discard-card${step.bought === id && i === topDiscard.length - 1 ? ' tutorial__card--highlight' : ''}`}
                    style={{ '--stack-i': i } as React.CSSProperties}
                  >
                    <CardView card={inst(id, `discard-${i}`)} compact hideType />
                  </div>
                ))}
              </div>
            </div>

            <div className="tutorial__pile tutorial__pile--pv">
              <h4>Tus puntos</h4>
              <div className="tutorial__pv" key={step.pv}>
                {step.pv}
                <small>PV</small>
              </div>
            </div>
          </div>
        </div>

        {step.final && (
          <div className="tutorial__final">
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
                  <td>{step.pv}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

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
      </div>
    </div>
  );
}
