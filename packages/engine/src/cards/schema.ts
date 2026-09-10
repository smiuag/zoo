import { z } from 'zod';

// "onPlay" se resuelve al jugar la carta desde la mano (justo después de
// mandarla al descarte). "onScore" se resuelve solo al calcular la
// puntuación final, sobre TODA la colección del jugador (mazo + mano +
// descarte).
export const EffectSchema = z.object({
  trigger: z.enum(['onPlay', 'onScore']),
  type: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

export const CardSchema = z.object({
  id: z.string(),
  name: z.string(),
  // "animal": se compra del mercado compartido (animalTrack) pagando su
  // marketCost, sin ninguna condición especial; va al descarte. Jugar la
  // carta desde la mano resuelve su efecto onPlay y la manda al descarte
  // (sigue circulando por tu mazo el resto de la partida). "coin": nunca se
  // juega; se queda en la mano como dinero literal y se gasta sola al pagar
  // una compra.
  type: z.enum(['animal', 'coin']),
  // Solo "animal": identidad de la especie (p. ej. "lion"). Una única carta
  // por especie: no hay variantes de sexo.
  species: z.string().optional(),
  // Solo "animal": hábitat(s) de la especie. La mayoría tiene solo uno,
  // pero algunas pertenecen a varios a la vez: Hipopótamo, Cocodrilo,
  // Flamenco (2 hábitats), Foca (terrestre-acuática), y Pingüino/Pato
  // ("todoterreno": los 3 a la vez). Lo usan tanto la etiqueta visible de la
  // carta como los efectos "por cada animal de tipo X" (orca, oso polar,
  // albatros, cocodrilo, pez de colores, periquito, serpiente, loro):
  // cuentan si el hábitat buscado está en esta lista, no si es el único.
  habitats: z.array(z.enum(['land', 'bird', 'aquatic'])).default([]),
  // Solo "coin": valor en monedas (1, 2 o 3).
  value: z.number().optional(),
  // Coste en monedas para CONSEGUIR la carta del mercado compartido de
  // animales. 0 para las monedas (nunca se compran, solo empiezan en el
  // mazo inicial o las genera algún efecto).
  marketCost: z.number().default(0),
  victoryPoints: z.number().default(0),
  text: z.string().default(''),
  effects: z.array(EffectSchema).default([]),
});

export type Effect = z.infer<typeof EffectSchema>;
export type Card = z.infer<typeof CardSchema>;

// Normaliza params.habitat de un efecto (string, array de strings, o
// ausente) a una lista de hábitats: usado por freeCaptureUpToCost (Elefante:
// "land"; Araña: ["bird","aquatic"]) para exigir que el objetivo tenga AL
// MENOS UNO de los hábitats listados. Lista vacía = sin restricción.
export function matchHabitatList(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return [];
}
