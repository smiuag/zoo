import type { GameState, Player } from '@zoo/engine';

// Busca una carta por instanceId en cualquier zona relevante para elegir
// un objetivo: mano, descarte (propio) o mercado.
export function findAnywhere(state: GameState, player: Player, instanceId: string) {
  return (
    player.hand.find((c) => c.instanceId === instanceId) ??
    player.discard.find((c) => c.instanceId === instanceId) ??
    state.animalTrack.find((c) => c.instanceId === instanceId)
  );
}
