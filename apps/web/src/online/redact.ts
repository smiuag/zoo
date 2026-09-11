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

// Devuelve una copia de `state` donde la mano/mazo/descarte/jugado-este-turno
// de cualquier asiento HUMANO que no sea `viewerSeatId` se sustituye por
// placeholders (mismo recuento, sin identidad de carta real). Los bots nunca
// se redactan (sus mazos ya son públicos hoy en el pase-y-juega local), ni
// tampoco nada una vez `state.gameOver`: el resumen final siempre ha sido
// público a propósito (ver canViewPlayer en App.tsx), así que a partir de
// ahí se reenvía el estado real tal cual.
export function redactStateForSeat(state: GameState, viewerSeatId: string, humanIds: string[]): GameState {
  if (state.gameOver) return state;
  return {
    ...state,
    players: state.players.map((player) => {
      if (player.id === viewerSeatId || !humanIds.includes(player.id)) return player;
      return {
        ...player,
        hand: redactZone(player.hand),
        deck: redactZone(player.deck),
        discard: redactZone(player.discard),
        playedThisTurn: redactZone(player.playedThisTurn),
      };
    }),
  };
}
