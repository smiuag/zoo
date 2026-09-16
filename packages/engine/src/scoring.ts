import { DESTRUCTIVE_SCORE_EFFECT_TYPES, resolveScoreEffect } from './effects/registry';
import type { CardInstance, GameState, Player } from './model/state';

// Incluye playedThisTurn (el "limbo" de lo ya jugado este turno pero
// todavía sin descartar de verdad, ver playCard/endTurn en engine.ts): esas
// cartas siguen siendo del jugador y deben puntuar igual, tanto si esto se
// llama al terminar la partida como si es el marcador en vivo de la web a
// mitad del turno de alguien.
function collectAllCards(player: Player): CardInstance[] {
  return [...player.deck, ...player.hand, ...player.discard, ...player.playedThisTurn];
}

function isStillInCollection(player: Player, instanceId: string): boolean {
  return [player.deck, player.hand, player.discard, player.playedThisTurn].some((zone) =>
    zone.some((c) => c.instanceId === instanceId)
  );
}

export function scorePlayer(state: GameState, player: Player): number {
  // Fase 1: los efectos onScore que ELIMINAN cartas (el Cocodrilo) se
  // resuelven primero, en el orden en que aparecen en la colección, para
  // que lo que destruyan no llegue a puntuar ni a contar para otros
  // efectos (p. ej. el conteo de acuáticos de la orca). Se recorre una
  // instantánea tomada al principio, así que si una carta de esa lista ya
  // fue destruida por un efecto anterior (p. ej. un Cocodrilo destruyendo a
  // otro), se salta: una carta destruida no puede disparar su propio
  // efecto.
  //
  // SOLO se ejecuta con la partida ya terminada (state.gameOver) Y todavía
  // no finalizada (!state.scoringFinalized): esta fase MUTA la colección de
  // verdad (destruye cartas). state.gameOver por sí solo no basta como
  // cerrojo porque se queda en true para siempre una vez termina la
  // partida, y scoreGame() se llama en cada render de la web para el
  // marcador en vivo — sin scoringFinalized, cada render POSTERIOR al fin
  // de la partida (con el mismo Cocodrilo "todavía en la colección", ya que
  // prefiere sacrificar otra carta antes que a sí mismo) repetiría el
  // sacrificio una vez más, devorando toda la colección acuática en vez de
  // un único animal una única vez. scoreGame() marca scoringFinalized=true
  // tras la primera pasada; llamadas posteriores solo repiten la fase 2
  // (pura, sin mutar) sobre la colección ya depurada.
  if (state.gameOver && !state.scoringFinalized) {
    for (const card of collectAllCards(player)) {
      if (!isStillInCollection(player, card.instanceId)) continue;
      for (const effect of card.effects.filter(
        (e) => e.trigger === 'onScore' && DESTRUCTIVE_SCORE_EFFECT_TYPES.has(e.type)
      )) {
        resolveScoreEffect(player, effect, [], card);
      }
    }
  }

  // Fase 2: con la colección ya depurada, se suman los PV base y el resto
  // de efectos onScore. Todos los animales puntúan estén donde estén
  // (mazo, mano o descarte) — igual que monedas y empleados.
  return scoreCollection(player, collectAllCards(player));
}

// Fase 2 de scorePlayer sobre una lista de cartas dada: PV base + efectos
// onScore NO destructivos. Pura: no toca ninguna zona del jugador (solo lee
// player para los efectos que miran algo suyo, p. ej. destroyedCards). Se
// exporta para poder puntuar colecciones HIPOTÉTICAS (ver previewScoreDelta)
// sin pasar por la fase destructiva.
export function scoreCollection(player: Player, allCards: CardInstance[]): number {
  let total = allCards.reduce((sum, card) => sum + card.victoryPoints, 0);
  for (const card of allCards) {
    for (const effect of card.effects.filter(
      (e) => e.trigger === 'onScore' && !DESTRUCTIVE_SCORE_EFFECT_TYPES.has(e.type)
    )) {
      total += resolveScoreEffect(player, effect, allCards, card);
    }
  }
  return total;
}

// Cuántos PV sumaría AHORA MISMO añadir `card` a la colección del jugador,
// contando todos los efectos onScore de la colección entera: no solo lo que
// aporta la propia carta (PV impreso + su efecto acumulativo, p. ej. Tucán =
// 1 por cada animal de coste 5+ ya tenido), sino también lo que hace crecer
// a otras cartas que ya se tienen (comprar cualquier coste 5+ suma +1 por
// cada Tucán en la colección; un terrestre, +1 por cada Oso polar...). Pura,
// nunca resuelve el Cocodrilo. La usa el rlBot como feature (ver
// features.ts): en el último turno es el valor exacto de la compra; antes,
// un suelo (la colección solo crece). `baseScore` permite pasar
// scoreCollection(player, current) ya calculado cuando se evalúan muchas
// cartas candidatas sobre la misma colección.
export function previewScoreDelta(player: Player, card: CardInstance, baseScore?: number): number {
  const current = collectAllCards(player);
  const base = baseScore ?? scoreCollection(player, current);
  return scoreCollection(player, [...current, card]) - base;
}

export interface PlayerScore {
  playerId: string;
  score: number;
}

// Puntos que APORTA cada carta de la colección, uno por instancia: sus PV
// base más lo que sume cualquier efecto onScore que lleve encima (p. ej.
// cada Orca añade el bonus de scorePerHabitatCount calculado sobre TODA la
// colección, no solo sobre sí misma — si hay 3 Orcas, las 3 lo suman por
// igual). Nunca resuelve los efectos DESTRUCTIVOS (el Cocodrilo): se asume
// que scorePlayer/scoreGame ya los resolvió antes si la partida ha
// terminado, y llamar a esto no debe mutar la colección por su cuenta. Solo
// pensado para mostrar un desglose en la UI, no para el cálculo real del
// marcador (ese sigue siendo scorePlayer).
export function scoreCardContributions(player: Player): Map<string, number> {
  const allCards = collectAllCards(player);
  const contributions = new Map<string, number>();
  for (const card of allCards) {
    let points = card.victoryPoints;
    for (const effect of card.effects.filter(
      (e) => e.trigger === 'onScore' && !DESTRUCTIVE_SCORE_EFFECT_TYPES.has(e.type)
    )) {
      points += resolveScoreEffect(player, effect, allCards, card);
    }
    contributions.set(card.instanceId, points);
  }
  return contributions;
}

export function scoreGame(state: GameState): PlayerScore[] {
  // Todos los jugadores se puntúan con scoringFinalized aún en false (así
  // que la fase destructiva de cada uno se resuelve, si procede), y solo AL
  // FINAL de esta pasada se cierra el cerrojo para siempre.
  const scores = state.players.map((player) => ({ playerId: player.id, score: scorePlayer(state, player) }));
  if (state.gameOver) state.scoringFinalized = true;
  return scores;
}
