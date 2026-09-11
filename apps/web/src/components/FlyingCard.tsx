import { useEffect, useState } from 'react';
import type { CardInstance } from '@zoo/engine';
import { CardView } from './CardView';

// Tamaño fijo de carta compacta (ver .card--compact en styles.css): el
// "fantasma" siempre vuela a este tamaño, centrado sobre el punto de
// partida/llegada reales — más simple y robusto que animar también el
// ancho/alto exactos de la carta de origen (mayor, no compacta).
const GHOST_W = 72;
const GHOST_H = 100;

// Ritmo de la animación: vuela (posición), se queda quieta iluminada un
// momento en el descarte (para poder ver bien qué se compró) y solo
// entonces se desvanece.
const FLIGHT_MS = 800;
const HOLD_MS = 450;
const FADE_MS = 350;
const TRANSITION = `left ${FLIGHT_MS}ms ease, top ${FLIGHT_MS}ms ease, opacity ${FADE_MS}ms ease, box-shadow 0.2s ease`;

// Cuánto dura la animación de principio a fin: la usa useGame.ts para saber
// cuánto esperar antes de terminar el turno de un bot justo después de
// comprar un animal, de forma que la animación siempre se vea completa
// antes de pasar al siguiente jugador.
export const FLIGHT_TOTAL_MS = FLIGHT_MS + HOLD_MS + FADE_MS;

export interface FlightSpec {
  key: string;
  card: CardInstance;
  fromCenter: { x: number; y: number };
  toCenter: { x: number; y: number };
}

interface FlyingCardProps {
  flight: FlightSpec;
  onDone: () => void;
}

type Phase = 'start' | 'flying' | 'holding' | 'fading';

// Animación de "vuelo" de una carta comprada del mercado hasta el descarte
// (técnica FLIP sin librería: se anima un elemento fijo entre dos puntos ya
// conocidos con un cambio de posición tras el primer pintado). La carta de
// verdad ya ha desaparecido del mercado en el mismo render en que aparece
// este fantasma (el estado ya se aplicó), así que esto es puramente
// decorativo — no bloquea ni retrasa nada del juego. Tres fases: vuela,
// se queda quieta e iluminada un momento en el destino, y se desvanece.
export function FlyingCard({ flight, onDone }: FlyingCardProps) {
  const [phase, setPhase] = useState<Phase>('start');

  useEffect(() => {
    const raf = requestAnimationFrame(() => setPhase('flying'));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (phase !== 'flying') return;
    const t = setTimeout(() => setPhase('holding'), FLIGHT_MS);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'holding') return;
    const t = setTimeout(() => setPhase('fading'), HOLD_MS);
    return () => clearTimeout(t);
  }, [phase]);

  const atDestination = phase !== 'start';
  const center = atDestination ? flight.toCenter : flight.fromCenter;
  const glowing = phase === 'flying' || phase === 'holding';

  return (
    <div
      className={['flying-card', glowing && 'flying-card--glow'].filter(Boolean).join(' ')}
      style={{
        left: center.x - GHOST_W / 2,
        top: center.y - GHOST_H / 2,
        width: GHOST_W,
        height: GHOST_H,
        opacity: phase === 'fading' ? 0 : 1,
        transition: TRANSITION,
      }}
      onTransitionEnd={(e) => {
        if (e.propertyName === 'opacity' && phase === 'fading') onDone();
      }}
    >
      <CardView card={flight.card} compact />
    </div>
  );
}
