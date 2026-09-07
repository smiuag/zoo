import { DESTRUCTIVE_SCORE_EFFECT_TYPES, resolveScoreEffect } from './effects/registry';
import type { CardInstance, GameState, Player } from './model/state';

function collectAllCards(player: Player): CardInstance[] {
  return [...player.deck, ...player.hand, ...player.discard];
}

function isStillInCollection(player: Player, instanceId: string): boolean {
  return [player.deck, player.hand, player.discard].some((zone) => zone.some((c) => c.instanceId === instanceId));
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
  const allCards = collectAllCards(player);
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

export interface PlayerScore {
  playerId: string;
  score: number;
}

export function scoreGame(state: GameState): PlayerScore[] {
  // Todos los jugadores se puntúan con scoringFinalized aún en false (así
  // que la fase destructiva de cada uno se resuelve, si procede), y solo AL
  // FINAL de esta pasada se cierra el cerrojo para siempre.
  const scores = state.players.map((player) => ({ playerId: player.id, score: scorePlayer(state, player) }));
  if (state.gameOver) state.scoringFinalized = true;
  return scores;
}
