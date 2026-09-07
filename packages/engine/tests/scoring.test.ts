import { describe, expect, it } from 'vitest';
import { createGame, getActivePlayer } from '../src/engine';
import { getCard } from '../src/cards/registry';
import { scoreGame, scorePlayer } from '../src/scoring';
import { buildStarterDeck } from './helpers';

describe('scorePlayer', () => {
  it('el mazo inicial (solo monedas de 1, 0PV) puntúa 0', () => {
    const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }]);
    const player = getActivePlayer(state);

    expect(scorePlayer(state, player)).toBe(0);
  });

  it('un animal en la mano suma sus PV (león: 3PV)', () => {
    const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }]);
    const player = getActivePlayer(state);
    const before = scorePlayer(state, player);

    const lion = { ...getCard('lion'), instanceId: 'lion#test' };
    player.hand.push(lion);

    expect(scorePlayer(state, player)).toBe(before + 3);
  });

  it('un animal que sigue en el mazo (nunca se jugó) TAMBIÉN suma sus PV: cuentan estén donde estén', () => {
    const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }]);
    const player = getActivePlayer(state);
    const before = scorePlayer(state, player);

    const tiger = { ...getCard('tiger'), instanceId: 'tiger#test' };
    player.deck.push(tiger);

    expect(scorePlayer(state, player)).toBe(before + 3);
  });

  it('un animal en el descarte también suma sus PV', () => {
    const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }]);
    const player = getActivePlayer(state);
    const before = scorePlayer(state, player);

    const goldfish = { ...getCard('goldfish'), instanceId: 'goldfish#test' };
    player.discard.push(goldfish);

    expect(scorePlayer(state, player)).toBe(before + 1);
  });

  it('las monedas de plata y oro también puntúan (1PV y 2PV)', () => {
    const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }]);
    const player = getActivePlayer(state);
    const before = scorePlayer(state, player);

    const coin2 = { ...getCard('coin-2'), instanceId: 'coin2#test' };
    const coin3 = { ...getCard('coin-3'), instanceId: 'coin3#test' };
    player.discard.push(coin2, coin3);

    expect(scorePlayer(state, player)).toBe(before + 1 + 2);
  });

  it('orca da +1PV por cada acuático que tenga en TODA su colección (se cuenta a sí misma, esté donde esté)', () => {
    const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }]);
    const player = getActivePlayer(state);

    const orca = { ...getCard('orca'), instanceId: 'orca#test' }; // 2PV base
    const dolphin = { ...getCard('dolphin'), instanceId: 'dolphin#test' }; // 2PV base
    const lion = { ...getCard('lion'), instanceId: 'lion#test' }; // terrestre, no cuenta
    player.hand.push(orca, dolphin, lion);
    // Este delfín está en el mazo, no en la mano: también cuenta para el bonus de la orca.
    player.deck.push({ ...getCard('dolphin'), instanceId: 'dolphin#outside' });

    const score = scorePlayer(state, player);
    // orca(2PV) + delfín×2(2+2PV) + león(3PV) + bonus orca: 3 acuáticos en TODA la colección × 1 = 3.
    expect(score).toBe(2 + 2 + 2 + 3 + 3);
  });

  it('para el bonus de la orca, el pez de colores cuenta como 2 acuáticos, no 1', () => {
    const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }]);
    const player = getActivePlayer(state);

    const orca = { ...getCard('orca'), instanceId: 'orca#test' }; // 2PV base
    const goldfish = { ...getCard('goldfish'), instanceId: 'goldfish#test' }; // 1PV base, cuenta como 2 acuáticos
    player.hand.push(orca, goldfish);

    const score = scorePlayer(state, player);
    // orca(2PV) + pez de colores(1PV) + bonus orca: pez de colores cuenta 2 + la propia orca 1 = 3 × 1 = 3.
    expect(score).toBe(2 + 1 + 3);
  });

  it('el Cocodrilo destruye, antes de puntuar, el OTRO acuático de menor PV de su mazo si tiene alguno', () => {
    const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }]);
    const player = getActivePlayer(state);
    // La destrucción del Cocodrilo solo se aplica con la partida terminada
    // (ver scoring.ts): en mitad de la partida solo puntúa, sin destruir.
    state.gameOver = true;

    const crocodile = { ...getCard('crocodile'), instanceId: 'croc#test' };
    // Hipopótamo (terrestre-acuático, 4PV, sin efecto onScore propio): el
    // más fuerte, debe sobrevivir.
    const hippo = { ...getCard('hippopotamus'), instanceId: 'hippo#4pv' };
    const goldfish = { ...getCard('goldfish'), instanceId: 'goldfish#1pv' }; // 1PV: el más débil, debe destruirse
    player.hand.push(crocodile);
    player.deck.push(hippo);
    player.hand.push(goldfish);

    const score = scorePlayer(state, player);

    expect(player.hand.some((c) => c.instanceId === 'goldfish#1pv')).toBe(false);
    expect(player.deck.some((c) => c.instanceId === 'hippo#4pv')).toBe(true);
    expect(player.hand.some((c) => c.instanceId === 'croc#test')).toBe(true);
    // El pez de colores (1PV, el más débil) fue destruido antes de puntuar.
    // Solo quedan cocodrilo(7PV) + hipopótamo(4PV).
    expect(score).toBe(7 + 4);
  });

  it('el Cocodrilo se destruye a sí mismo si es el ÚNICO animal acuático de su mazo', () => {
    const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }]);
    const player = getActivePlayer(state);
    state.gameOver = true;

    const crocodile = { ...getCard('crocodile'), instanceId: 'croc#solo' };
    player.discard.push(crocodile);

    // Sin ningún otro acuático al que sacrificar, se destruye a sí mismo:
    // no llega a puntuar sus 6PV. El resto de la colección son monedas y
    // Perezosos (0PV cada uno), así que el total esperado es 0.
    const score = scorePlayer(state, player);

    expect(player.discard.some((c) => c.instanceId === 'croc#solo')).toBe(false);
    expect(score).toBe(0);
  });

  it('con 2 cocodrilos, cada uno prefiere destruir al otro antes que a sí mismo', () => {
    const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }]);
    const player = getActivePlayer(state);
    state.gameOver = true;

    player.discard.push(
      { ...getCard('crocodile'), instanceId: 'croc#a' },
      { ...getCard('crocodile'), instanceId: 'croc#b' }
    );

    scorePlayer(state, player);

    // El primer cocodrilo en resolverse destruye al otro (mismo PV: gana el
    // primero por orden de aparición); solo queda 1 en el descarte.
    expect(player.discard).toHaveLength(1);
  });

  it('el Cocodrilo solo destruye UNA VEZ en total, aunque scoreGame() se llame muchas veces tras terminar la partida (marcador en vivo de la web)', () => {
    const state = createGame([
      { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
      { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
    ]);
    const player = getActivePlayer(state);
    state.gameOver = true;

    const crocodile = { ...getCard('crocodile'), instanceId: 'croc#test' };
    const hippo1 = { ...getCard('hippopotamus'), instanceId: 'hippo#1' };
    const hippo2 = { ...getCard('hippopotamus'), instanceId: 'hippo#2' };
    const goldfish = { ...getCard('goldfish'), instanceId: 'goldfish#1pv' };
    player.hand.push(crocodile, hippo1, hippo2, goldfish);

    // La web llama a scoreGame() en cada render, incluso después de que la
    // partida haya terminado (marcador en vivo + popup de colección): el
    // Cocodrilo debe sacrificar UN animal la primera vez y ninguno más,
    // nunca seguir comiéndose la colección turno a turno.
    scoreGame(state);
    scoreGame(state);
    scoreGame(state);

    expect(player.hand.some((c) => c.instanceId === 'goldfish#1pv')).toBe(false);
    expect(player.hand.some((c) => c.instanceId === 'hippo#1')).toBe(true);
    expect(player.hand.some((c) => c.instanceId === 'hippo#2')).toBe(true);
    expect(player.hand.some((c) => c.instanceId === 'croc#test')).toBe(true);
  });

  it('pingüino da +1PV por cada especie DISTINTA en su mazo, no por copia', () => {
    const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }]);
    const player = getActivePlayer(state);

    const penguin = { ...getCard('penguin'), instanceId: 'penguin#test' };
    const lion1 = { ...getCard('lion'), instanceId: 'lion#1' };
    const lion2 = { ...getCard('lion'), instanceId: 'lion#2' }; // 2ª copia del león: no suma especie extra
    const dolphin = { ...getCard('dolphin'), instanceId: 'dolphin#1' }; // 2PV base
    player.hand.push(penguin, lion1, lion2, dolphin);

    const score = scorePlayer(state, player);
    // pingüino(2PV) + león×2(3+3PV) + delfín(2PV) + bonus pingüino: 4
    // especies distintas (pingüino, león, delfín Y el Perezoso del mazo
    // inicial, que sigue contando como especie aunque dé 0PV) × 1PV = 4.
    expect(score).toBe(2 + 3 + 3 + 2 + 4);
  });

  it('periquito: con menos de 4 copias en la colección, no da ningún bono', () => {
    const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }]);
    const player = getActivePlayer(state);
    const before = scorePlayer(state, player);

    player.hand.push(
      { ...getCard('parakeet'), instanceId: 'parakeet#1' },
      { ...getCard('parakeet'), instanceId: 'parakeet#2' },
      { ...getCard('parakeet'), instanceId: 'parakeet#3' }
    );

    // 3 periquitos × 0PV base, sin bono (hace falta 4 o más).
    expect(scorePlayer(state, player)).toBe(before);
  });

  it('periquito: con 4 o más copias en la colección (estén donde estén), da +10PV UNA sola vez', () => {
    const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }]);
    const player = getActivePlayer(state);
    const before = scorePlayer(state, player);

    player.hand.push({ ...getCard('parakeet'), instanceId: 'parakeet#1' }, { ...getCard('parakeet'), instanceId: 'parakeet#2' });
    player.deck.push({ ...getCard('parakeet'), instanceId: 'parakeet#3' });
    player.discard.push({ ...getCard('parakeet'), instanceId: 'parakeet#4' }, { ...getCard('parakeet'), instanceId: 'parakeet#5' });

    // 5 periquitos × 0PV base + un único bono de +10 (no 5×10): alcanzar el
    // umbral de 4 no debe sumar el bono por cada copia adicional.
    expect(scorePlayer(state, player)).toBe(before + 10);
  });
});
