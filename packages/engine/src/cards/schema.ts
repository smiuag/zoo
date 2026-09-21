import { z } from 'zod';

// "onPlay" se resuelve al jugar la carta desde la mano (justo después de
// mandarla al descarte). "onScore" se resuelve solo al calcular la
// puntuación final, sobre TODA la colección del jugador (mazo + mano +
// descarte). "onTurnStart" se resuelve automáticamente al empezar CADA turno
// propio del jugador (ver beginPlayerTurn en engine.ts), sin que haga falta
// jugar ni tener la carta en la mano — solo que haya al menos una copia en
// el descarte (p. ej. la Ardilla).
export const EffectSchema = z.object({
  trigger: z.enum(['onPlay', 'onScore', 'onTurnStart']),
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
  // Flamenco, Pato (2 hábitats cada uno), y Pingüino/Foca (terrestre-
  // acuática). Lo usan tanto la etiqueta visible de la carta como los
  // efectos "por cada animal de tipo X" (orca, oso polar, albatros,
  // cocodrilo, pez de colores, periquito, serpiente, loro): cuentan si el
  // hábitat buscado está en esta lista, no si es el único.
  // 'pet' (mascota) y 'dinosaur' (dinosaurio) son tipos EXTRA (2026-09-20):
  // se llevan junto a los hábitats de siempre en esta misma lista (un Perro
  // es land + pet, el Cocodrilo land + aquatic + dinosaur) y cuentan igual
  // para cualquier efecto que mire la lista, pero NO deciden la plantilla de
  // la carta (eso lo siguen decidiendo solo land/bird/aquatic, ver
  // BASE_HABITATS más abajo y template_key_for_card en compose_all.py).
  habitats: z.array(z.enum(['land', 'bird', 'aquatic', 'pet', 'dinosaur'])).default([]),
  // Solo "coin": valor en monedas (1, 2 o 3).
  // Edición a la que pertenece la carta. 'classic' (por defecto): la baraja
  // oficial, con los 3 hábitats de siempre. 'full': solo existe en la edición
  // completa (mascotas y dinosaurios), que de momento es de pruebas — ver
  // GameEdition en model/state.ts.
  edition: z.enum(['classic', 'full']).default('classic'),
  value: z.number().optional(),
  // Coste en monedas para CONSEGUIR la carta del mercado compartido de
  // animales. 0 para las monedas (nunca se compran, solo empiezan en el
  // mazo inicial o las genera algún efecto).
  marketCost: z.number().default(0),
  // Solo dinosaurios "grandes" (2026-09-21): cuánto se descuenta del
  // marketCost, al COMPRARLO del mercado, por cada dinosaurio que el
  // comprador ya haya JUGADO (playCard, no comprado) en ESTE mismo turno —
  // Diplodocus/Plesiosaurio/Pteranodon y los 3 que eliminan animales
  // (Tiranosaurio/Terodáctilo/Mosasaurio). No es un "effect" (no se resuelve
  // con resolveEffect: no dispara al jugarlo, solo abarata comprarlo del
  // mercado compartido) — ver effectiveMarketCost en engine.ts. undefined/0
  // para el resto de cartas, que pagan siempre su marketCost fijo.
  costReductionPerDinosaurPlayedThisTurn: z.number().optional(),
  victoryPoints: z.number().default(0),
  text: z.string().default(''),
  // Solo cartas CLÁSICAS (impresas/oficiales) cuya habilidad se comporta
  // distinto en la edición completa (2026-09-21, Cocodrilo → puede evolucionar
  // a Mosasaurio, que no existe en la clásica): texto alternativo que se
  // muestra SOLO cuando la partida es 'full' (ver mintInstance en
  // model/state.ts) — la edición clásica/impresa sigue mostrando siempre
  // `text` tal cual, sin que el pipeline de impresión tenga que saber nada
  // de esto. undefined en el resto de cartas: `text` vale para las dos
  // ediciones por igual.
  fullEditionText: z.string().optional(),
  effects: z.array(EffectSchema).default([]),
});

// Hábitats "de verdad" (deciden plantilla/color de carta); el resto de
// valores de `habitats` son tipos extra (mascota, dinosaurio).
export const BASE_HABITATS = ['land', 'bird', 'aquatic'] as const;

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
