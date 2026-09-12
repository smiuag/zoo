import type { BotAlgorithm } from './gameConfig';

// `label`: texto completo del desplegable de algoritmo (formulario y panel
// "Otros jugadores"). `shortLabel`: código de 2 letras usado en sitios donde
// no cabe el texto completo (el marcador de arriba en GameBoard.tsx
// sustituye el nombre corto del bot, B1/B2, por este código cuando se
// muestra ahí) — ES = genérico (sin restricción de hábitat), TT = solo
// terrestres, AI = solo voladores, FO = solo acuáticos; el resto son
// iniciales del propio nombre del algoritmo.
export const BOT_ALGORITHM_OPTIONS: { value: BotAlgorithm; label: string; shortLabel: string }[] = [
  { value: 'rl', label: "Preferencia general 'ES'", shortLabel: 'ES' },
  { value: 'rlLand', label: "Preferencia por terrestres 'TT'", shortLabel: 'TT' },
  { value: 'rlBird', label: "Preferencia por voladores 'AI'", shortLabel: 'AI' },
  { value: 'rlAquatic', label: "Preferencia por acuáticos 'FO'", shortLabel: 'FO' },
  { value: 'heuristic', label: 'Heurístico', shortLabel: 'HE' },
  { value: 'random', label: 'Aleatorio', shortLabel: 'AL' },
  { value: 'expensiveFirst', label: 'Compra lo más caro', shortLabel: 'CC' },
  { value: 'animalBuyer', label: 'Comprador de animales', shortLabel: 'CA' },
];
