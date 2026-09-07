import type { BotAlgorithm } from '../state/useGame';

// Etiquetas en español para el desplegable de algoritmo por hueco de bot en
// el panel "Otros jugadores".
export const BOT_ALGORITHM_OPTIONS: { value: BotAlgorithm; label: string }[] = [
  { value: 'rl', label: 'IA (RL)' },
  { value: 'rlLand', label: 'IA (RL) — solo terrestres' },
  { value: 'rlBird', label: 'IA (RL) — solo voladores' },
  { value: 'rlAquatic', label: 'IA (RL) — solo acuáticos' },
  { value: 'heuristic', label: 'Heurístico' },
  { value: 'random', label: 'Aleatorio' },
  { value: 'expensiveFirst', label: 'Compra lo más caro' },
  { value: 'animalBuyer', label: 'Comprador de animales' },
];
