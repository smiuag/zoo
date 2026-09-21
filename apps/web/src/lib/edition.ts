import type { GameEdition } from '@zoo/engine';

// La edición COMPLETA (mascotas y dinosaurios) es de pruebas: solo se puede
// elegir con la app abierta en local. En cualquier otro host (la web
// publicada) no aparece el selector y cualquier partida se crea siempre con
// la edición clásica, la oficial — aunque alguien tenga 'full' guardado en su
// localStorage o llegue una config con edition 'full'. 'learning' (2026-09-21,
// pedido explícito del usuario) es distinta: mismo mazo clásico de siempre,
// solo con el mercado recortado a coste 4 o menos (ver LEARNING_EDITION_MAX_
// COST/marketSpeciesFor en el motor) — SÍ disponible en la web publicada,
// nunca gated por isFullEditionAvailable.
const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1', '::1', '[::1]'];

export const isFullEditionAvailable =
  typeof window !== 'undefined' && LOCAL_HOSTNAMES.includes(window.location.hostname);

const STORAGE_KEY = 'zoo.edition';

export function loadSavedEdition(): GameEdition {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === 'full') return isFullEditionAvailable ? 'full' : 'classic';
    if (raw === 'learning') return 'learning';
    return 'classic';
  } catch {
    return 'classic';
  }
}

export function saveEdition(edition: GameEdition): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, edition);
  } catch {
    // sin almacenamiento local: simplemente no se recuerda
  }
}

// Lo que de verdad se le pasa al motor: 'full' solo si se pidió Y estamos en
// local; 'learning' siempre que se pida (disponible en cualquier sitio).
export function effectiveEdition(requested: GameEdition | undefined): GameEdition {
  if (requested === 'full' && isFullEditionAvailable) return 'full';
  if (requested === 'learning') return 'learning';
  return 'classic';
}
