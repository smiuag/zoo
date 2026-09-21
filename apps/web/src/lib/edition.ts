import type { GameEdition } from '@zoo/engine';

// Las 3 ediciones están disponibles en cualquier sitio, incluida la web
// publicada: 'classic' (la oficial impresa), 'learning' (mismo mazo clásico
// con el mercado recortado a coste 4 o menos — ver LEARNING_EDITION_MAX_COST/
// marketSpeciesFor en el motor) y 'full' (mascotas y dinosaurios, desde
// 2026-09-21 también publicada).
const STORAGE_KEY = 'zoo.edition';

export function loadSavedEdition(): GameEdition {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === 'full') return 'full';
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

export function effectiveEdition(requested: GameEdition | undefined): GameEdition {
  if (requested === 'full') return 'full';
  if (requested === 'learning') return 'learning';
  return 'classic';
}
