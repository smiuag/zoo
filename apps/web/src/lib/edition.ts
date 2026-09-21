import type { GameEdition } from '@zoo/engine';

// Las 3 ediciones seleccionables desde la UI están disponibles en cualquier
// sitio, incluida la web publicada: 'classic' (la oficial impresa),
// 'learning' (mismo mazo clásico con el mercado recortado a coste 4 o menos
// — ver LEARNING_EDITION_MAX_COST/marketSpeciesFor en el motor) y 'custom'
// (2026-09-21, sustituye al antiguo botón "Completa": el jugador elige las
// especies y los deltas de copias desde el panel de configuración, ver
// GameSetup.tsx/GameSettingsModal.tsx). 'full' sigue existiendo a nivel de
// motor (tests, entrenamiento RL) pero ya no tiene botón propio en la web —
// un valor 'full' guardado de antes de este cambio cae a 'classic' por
// defecto, igual que cualquier valor desconocido, en vez de quedar en un
// estado sin ningún botón de edición resaltado.
const STORAGE_KEY = 'zoo.edition';

export function loadSavedEdition(): GameEdition {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === 'custom') return 'custom';
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
  if (requested === 'custom') return 'custom';
  if (requested === 'learning') return 'learning';
  return 'classic';
}
