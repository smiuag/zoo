import type { BotAlgorithm } from './gameConfig';

// Etiquetas en español para el desplegable de algoritmo por hueco de bot en
// el panel "Otros jugadores". Los 4 bots RL usan códigos cortos de 2 letras
// (en vez de "IA (RL) — solo terrestres" etc.) para que quepan junto al
// nombre del bot en el chip "· {label}" de GameBoard.tsx, igual que los
// nombres cortos de jugador/bot (B1/J1) — ver useGame.ts: ES = genérico (sin
// restricción de hábitat), TT = solo terrestres, AI = solo voladores, FO =
// solo acuáticos.
export const BOT_ALGORITHM_OPTIONS: { value: BotAlgorithm; label: string }[] = [
  { value: 'rl', label: 'ES' },
  { value: 'rlLand', label: 'TT' },
  { value: 'rlBird', label: 'AI' },
  { value: 'rlAquatic', label: 'FO' },
  { value: 'heuristic', label: 'Heurístico' },
  { value: 'random', label: 'Aleatorio' },
  { value: 'expensiveFirst', label: 'Compra lo más caro' },
  { value: 'animalBuyer', label: 'Comprador de animales' },
];
