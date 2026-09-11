import type { CardInstance, GameState } from '@zoo/engine';

// Carta "de mentira" que solo sirve para ocupar un hueco en un array
// redactado: nunca se renderiza como tal (ver canViewPlayer en App.tsx: las
// zonas redactadas de otro humano solo se consultan por su `.length`, jamás
// se listan una a una mientras la partida sigue en curso), pero debe tener
// una forma válida de CardInstance para que el resto del código TypeScript
// que recorre `GameState` siga compilando sin casos especiales.
function hiddenCard(index: number): CardInstance {
  return {
    id: 'hidden',
    instanceId: `hidden-${index}`,
    name: '',
    type: 'animal',
    habitats: [],
    marketCost: 0,
    victoryPoints: 0,
    text: '',
    effects: [],
  };
}

function redactZone(cards: CardInstance[]): CardInstance[] {
  return cards.map((_, i) => hiddenCard(i));
}

// Devuelve una copia de `state` donde la mano/mazo de cualquier asiento
// HUMANO que no sea `viewerSeatId` se sustituye por placeholders (mismo
// recuento, sin identidad de carta real). El descarte y lo jugado este
// turno, en cambio, solo se redactan si ese jugador NO tiene el turno
// activo ahora mismo: mientras juega, su "tablero" (ver
// ActivePlayerBoard.tsx) se hace público en vivo a propósito — es la misma
// revelación que ya ocurre en pase-y-juega local, donde cualquiera sentado
// a la mesa ve lo que juega y compra quien tiene el turno. Los bots nunca
// se redactan (sus mazos ya son públicos hoy), ni tampoco nada una vez
// `state.gameOver`: el resumen final siempre ha sido público a propósito
// (ver canViewPlayer en GameBoard.tsx), así que a partir de ahí se reenvía
// el estado real tal cual.
export function redactStateForSeat(state: GameState, viewerSeatId: string, humanIds: string[]): GameState {
  if (state.gameOver) return state;
  const activePlayerId = state.players[state.activePlayerIndex]?.id;
  return {
    ...state,
    players: state.players.map((player) => {
      if (player.id === viewerSeatId || !humanIds.includes(player.id)) return player;
      const isActive = player.id === activePlayerId;
      return {
        ...player,
        hand: redactZone(player.hand),
        deck: redactZone(player.deck),
        discard: isActive ? player.discard : redactZone(player.discard),
        playedThisTurn: isActive ? player.playedThisTurn : redactZone(player.playedThisTurn),
      };
    }),
  };
}
