import { describe, expect, it } from 'vitest';
import { buyAnimal, createGame, endTurn, getActivePlayer, getLegalActions, playCard, type CreateGameOptions } from '../src/engine';
import { getCard } from '../src/cards/registry';
import { buildStarterDeck } from './helpers';

function setup(numPlayers: number, options?: CreateGameOptions) {
  const players = Array.from({ length: numPlayers }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Jugador ${i + 1}`,
    deck: buildStarterDeck(),
  }));
  return createGame(players, options);
}

describe('fin de partida (5 mazos compartidos agotados)', () => {
  it('dispara la última ronda en cuanto 5 mazos compartidos se vacían, y termina tras dar la vuelta completa', () => {
    const state = setup(3);
    expect(state.finalRoundTriggerPlayerIndex).toBeNull();
    expect(state.gameOver).toBe(false);

    const p1 = getActivePlayer(state); // índice 0

    // El trigger real se comprueba al capturar/comprar; lo forzamos
    // directamente para simular que ya se agotaron 5 mazos durante el
    // turno de p1.
    state.finalRoundTriggerPlayerIndex = 0;

    endTurn(state, p1.id); // p1 -> p2, ronda final en marcha
    expect(state.gameOver).toBe(false);
    expect(getActivePlayer(state).id).toBe('p2');

    endTurn(state, 'p2'); // p2 -> p3
    expect(state.gameOver).toBe(false);
    expect(getActivePlayer(state).id).toBe('p3');

    endTurn(state, 'p3'); // p3 -> volvería a p1 (el que disparó): fin de partida
    expect(state.gameOver).toBe(true);
  });

  it('no se puede actuar después de que la partida ha terminado', () => {
    const state = setup(2);
    state.finalRoundTriggerPlayerIndex = 0;

    const p1 = getActivePlayer(state);
    endTurn(state, p1.id); // p1 -> p2, ronda final
    endTurn(state, 'p2'); // p2 -> volvería a p1: fin de partida

    expect(state.gameOver).toBe(true);
    expect(getLegalActions(state, 'p1')).toEqual([]);
    expect(getLegalActions(state, 'p2')).toEqual([]);
    expect(() => endTurn(state, 'p1')).toThrow();
    const anyCard = state.players[0].hand[0] ?? state.players[0].deck[0];
    if (anyCard) {
      expect(() => playCard(state, 'p1', anyCard.instanceId)).toThrow();
    }
  });

  it('con 1 jugador, la partida termina justo tras el turno en que se agota el último mazo requerido', () => {
    const state = setup(1);
    state.finalRoundTriggerPlayerIndex = 0;

    endTurn(state, state.players[0].id);

    expect(state.gameOver).toBe(true);
  });

  it('el trigger real se dispara al capturar un animal que agota el 5º mazo, no antes con solo 4', () => {
    const state = setup(2);
    // Todas las especies cuentan ahora para este criterio.
    const speciesIds = Object.keys(state.sharedDecks).filter((id) =>
      state.animalTrack.some((c) => c.species === id)
    );

    // Vacía 4 mazos de especie (ninguno es el que vamos a capturar): con
    // solo 4 agotados, el trigger todavía no debe dispararse.
    const [captureSpecies, ...emptyFirst] = speciesIds;
    for (const id of emptyFirst.slice(0, 4)) {
      state.sharedDecks[id] = [];
    }
    expect(state.finalRoundTriggerPlayerIndex).toBeNull();

    // Vacía también el mazo de la especie que vamos a capturar (para que,
    // al reponerse el mercado tras la captura, ese mazo ya esté a 0 y se
    // llegue a 5 mazos vacíos a la vez).
    state.sharedDecks[captureSpecies] = [];
    const player = getActivePlayer(state);
    player.hand.push(
      { ...getCard('coin-3'), instanceId: 'forced-coin-a' },
      { ...getCard('coin-3'), instanceId: 'forced-coin-b' }
    );
    const trackCard = state.animalTrack.find((c) => c.species === captureSpecies)!;

    buyAnimal(state, player.id, trackCard.instanceId);

    expect(state.finalRoundTriggerPlayerIndex).toBe(state.activePlayerIndex);
  });
});

describe('fin de partida (duración elegida en rondas)', () => {
  it('sin maxRounds, el comportamiento es el de siempre: sin límite, y la ronda sube igualmente', () => {
    const state = setup(3);
    expect(state.maxRounds).toBeNull();
    expect(state.round).toBe(1);

    endTurn(state, 'p1'); // p1 -> p2, sigue en la ronda 1
    expect(state.round).toBe(1);
    endTurn(state, 'p2'); // p2 -> p3, sigue en la ronda 1
    expect(state.round).toBe(1);
    endTurn(state, 'p3'); // p3 -> p1: empieza la ronda 2
    expect(state.round).toBe(2);
    expect(state.gameOver).toBe(false);
  });

  it('con maxRounds fijado, la partida termina justo al completar esa ronda, dando a todos el mismo número de turnos', () => {
    const state = setup(3, { maxRounds: 2 });

    endTurn(state, 'p1'); // ronda 1: p1 -> p2
    endTurn(state, 'p2'); // ronda 1: p2 -> p3
    endTurn(state, 'p3'); // p3 -> p1: empieza la ronda 2
    expect(state.round).toBe(2);
    expect(state.gameOver).toBe(false);

    endTurn(state, 'p1'); // ronda 2: p1 -> p2
    endTurn(state, 'p2'); // ronda 2: p2 -> p3
    expect(state.gameOver).toBe(false);
    endTurn(state, 'p3'); // p3 -> volvería a p1 para la ronda 3: fin de partida
    expect(state.gameOver).toBe(true);
    expect(getActivePlayer(state).id).toBe('p1');
  });

  it('si los mazos se agotan antes de llegar a maxRounds, la partida termina igualmente (lo que ocurra antes)', () => {
    const state = setup(2, { maxRounds: 50 });
    state.finalRoundTriggerPlayerIndex = 0;

    endTurn(state, 'p1'); // p1 -> p2, ronda final por mazos agotados
    expect(state.gameOver).toBe(false);
    endTurn(state, 'p2'); // p2 -> volvería a p1 (quien lo disparó): fin de partida
    expect(state.gameOver).toBe(true);
    expect(state.round).toBeLessThan(50);
  });
});
