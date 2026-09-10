import type { GameState, Player } from '@zoo/engine';

// Busca una carta por instanceId en cualquier zona relevante para elegir
// un objetivo: mano, lo ya jugado este turno (playedThisTurn: el Flamenco
// puede ofrecer devolver algo jugado antes este mismo turno, que ya no está
// en la mano ni en el descarte de verdad todavía, ver returnAnimalForUpgrade
// en el motor), mazo propio (el Tigre ofrece elegir entre cartas que
// todavía están ahí, a punto de robarse, ver drawThenTopdeckActions en el
// motor), descarte (propio, p. ej. lo que ofrece recuperar la Jirafa) o
// mercado.
export function findAnywhere(state: GameState, player: Player, instanceId: string) {
  return (
    player.hand.find((c) => c.instanceId === instanceId) ??
    player.playedThisTurn.find((c) => c.instanceId === instanceId) ??
    player.deck.find((c) => c.instanceId === instanceId) ??
    player.discard.find((c) => c.instanceId === instanceId) ??
    state.animalTrack.find((c) => c.instanceId === instanceId)
  );
}
