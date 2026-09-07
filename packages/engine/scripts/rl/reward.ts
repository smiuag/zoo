import type { PlayerScore } from '../../src/scoring';

// Recompensa terminal usada solo para entrenar (nunca se expone desde
// src/index.ts): la puntuación final del jugador menos la media de sus
// rivales, escalada para que quede en un rango razonable para el
// gradiente (una ventaja de ±20 PV ya es una paliza clara).
export function computeReturn(scores: PlayerScore[], playerId: string): number {
  const own = scores.find((s) => s.playerId === playerId)?.score ?? 0;
  const others = scores.filter((s) => s.playerId !== playerId);
  if (others.length === 0) return 0;
  const meanOthers = others.reduce((sum, s) => sum + s.score, 0) / others.length;
  return (own - meanOthers) / 20;
}
