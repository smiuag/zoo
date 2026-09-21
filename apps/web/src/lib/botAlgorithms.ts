import {
  aquaticRlBot,
  birdRlBot,
  fullAquaticRlBot,
  fullBirdRlBot,
  fullLandRlBot,
  landRlBot,
  rlBot,
  rlBotFull,
  type Bot,
  type GameEdition,
  type Player,
} from '@zoo/engine';
import type { BotAlgorithm } from './gameConfig';

// `label`: texto completo del desplegable de algoritmo (formulario y panel
// "Otros jugadores"). `shortLabel`: código de 2 letras usado en sitios donde
// no cabe el texto completo (el marcador de arriba en GameBoard.tsx
// sustituye el nombre corto del bot, B1/B2, por este código cuando se
// muestra ahí).
export const BOT_ALGORITHM_OPTIONS: { value: BotAlgorithm; label: string; shortLabel: string }[] = [
  { value: 'general', label: 'Genérico', shortLabel: 'GE' },
  { value: 'land', label: 'Terrestre', shortLabel: 'TT' },
  { value: 'bird', label: 'Volador', shortLabel: 'AI' },
  { value: 'aquatic', label: 'Acuático', shortLabel: 'FO' },
];

// Qué Bot de verdad usa cada algoritmo, según la edición de la partida —
// pedido explícito del usuario 2026-09-21: el MISMO valor guardado (p. ej.
// 'land') debe resolverse a un bot distinto según la edición, sin que el
// jugador tenga que volver a elegir nada al cambiar de edición. 'learning'
// usa siempre los bots clásicos (no hay entrenamiento propio para ella, ni
// se va a entrenar uno — mismo mazo, solo el mercado recortado por coste).
// 'full' Y 'custom' (2026-09-21: "Personalizado" sustituye al botón
// "Completa" en la web, pero a nivel de motor sigue siendo edition==='custom',
// distinto de 'full') usan los mismos bots de la completa: son los únicos
// entrenados con el codificador FEATURE_DIM_FULL, el único que no es ciego a
// ninguna especie/hábitat/efecto que una partida personalizada pueda incluir
// (clásicas + extra de la completa, cualquier subconjunto). Si el
// especialista de ese hábitat todavía no está entrenado
// (fullLandRlBot/fullBirdRlBot/fullAquaticRlBot/rlBotFull ya caen solos en
// heuristicBot cuando su weights*.json no es válido, ver rlBotFull.ts),
// esto simplemente devuelve ese mismo heurístico — nunca unos pesos sin
// entrenar jugando al azar.
export function resolveBot(algorithm: BotAlgorithm, edition: GameEdition | undefined): Bot {
  if (edition === 'full' || edition === 'custom') {
    switch (algorithm) {
      case 'land':
        return fullLandRlBot;
      case 'bird':
        return fullBirdRlBot;
      case 'aquatic':
        return fullAquaticRlBot;
      case 'general':
      default:
        return rlBotFull;
    }
  }
  switch (algorithm) {
    case 'land':
      return landRlBot;
    case 'bird':
      return birdRlBot;
    case 'aquatic':
      return aquaticRlBot;
    case 'general':
    default:
      return rlBot;
  }
}

// Nombre a mostrar para un jugador: el suyo propio si es humano, o el
// código corto de su algoritmo si es un bot (ver shortLabel arriba) —
// mismo criterio en todos los sitios que muestran el nombre del jugador
// activo (el marcador de GameBoard.tsx y el título "Mesa de X" de
// ActivePlayerBoard.tsx), para no volver a mostrar "B1"/"B2" en un sitio
// y el código corto en otro.
export function displayName(
  player: Player,
  humanIds: string[],
  botAlgorithms: Record<string, BotAlgorithm>
): string {
  if (humanIds.includes(player.id)) return player.name;
  const algorithm = botAlgorithms[player.id];
  return BOT_ALGORITHM_OPTIONS.find((o) => o.value === algorithm)?.shortLabel ?? player.name;
}
