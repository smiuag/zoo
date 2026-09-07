import { describe, expect, it } from 'vitest';
import { createGame, endTurn, getActivePlayer, playCard } from '../src/engine';
import { getCard } from '../src/cards/registry';
import { drawCards } from '../src/model/state';
import { buildStarterDeck } from './helpers';

describe('endTurn', () => {
  it('descarta la mano no jugada y roba YA tu mano siguiente; resetea el bonus en el turno nuevo', () => {
    const state = createGame([
      { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
      { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
    ]);

    const p1 = getActivePlayer(state);
    // Fuerza una mano determinista: 1 Foca (que se juega, da bonus por el
    // Delfín acuático que se queda en mano) + 3 monedas sin jugar.
    const allCards = [...p1.deck, ...p1.hand];
    const seal = { ...getCard('seal'), instanceId: 'forced-seal' };
    const dolphin = { ...getCard('dolphin'), instanceId: 'forced-dolphin' };
    const coins = allCards.filter((c) => c.type === 'coin').slice(0, 3);
    p1.hand = [seal, dolphin, ...coins];
    const totalP1Cards = p1.deck.length + p1.hand.length + p1.discard.length;

    playCard(state, p1.id, seal.instanceId);
    expect(p1.hand).toHaveLength(4);
    // La foca se cuenta a sí misma (sigue "en mano" vía playedThisTurn) +
    // el delfín: 2 acuáticos, no 1.
    expect(p1.bonusPurchasingPowerThisTurn).toBe(2);

    endTurn(state, p1.id);

    // Al terminar tu propio turno robas ya tu mano siguiente (como el
    // "clean-up" de Dominion): la llevas contigo durante el turno de Bob,
    // en vez de quedarte con la mano vacía hasta que vuelva a tocarte.
    expect(p1.hand).toHaveLength(5);
    expect(p1.deck.length + p1.hand.length + p1.discard.length).toBe(totalP1Cards);

    const p2 = getActivePlayer(state);
    expect(p2.id).toBe('p2');
    expect(p2.hand).toHaveLength(5);
    expect(p2.bonusPurchasingPowerThisTurn).toBe(0);
  });

  it('la mano de un rival no está vacía durante tu turno (Mono/Buitre/Hiena/Pato pueden mirarla)', () => {
    const state = createGame([
      { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
      { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
    ]);

    const p1 = getActivePlayer(state);
    const p2 = state.players.find((p) => p.id !== p1.id)!;

    // Ya en la primera ronda, antes de que a Bob le haya tocado jugar nunca.
    expect(p2.hand).toHaveLength(5);

    endTurn(state, p1.id);
    // Y tras el turno de Alice, ella también sigue con mano (para lo que
    // Bob quiera jugarle en SU turno).
    expect(p1.hand).toHaveLength(5);
  });

  it('baraja el descarte como mazo nuevo cuando el mazo se vacía a mitad de robo', () => {
    const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }]);
    const player = getActivePlayer(state);

    // Fuerza el mazo casi vacío y algo en el descarte para comprobar el reshuffle.
    player.deck = player.deck.slice(0, 1);
    player.discard = player.hand.splice(0);

    drawCards(player, 5);

    expect(player.hand).toHaveLength(5);
    expect(player.discard).toHaveLength(0);
    expect(player.deck).toHaveLength(1);
  });
});
