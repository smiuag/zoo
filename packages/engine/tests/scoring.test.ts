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

  it('un animal en la mano suma sus PV (león: 5PV)', () => {
    const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }]);
    const player = getActivePlayer(state);
    const before = scorePlayer(state, player);

    const lion = { ...getCard('lion'), instanceId: 'lion#test' };
    player.hand.push(lion);

    expect(scorePlayer(state, player)).toBe(before + 5);
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
    // orca(2PV) + delfín×2(2+2PV) + león(5PV) + bonus orca: 3 acuáticos en TODA la colección × 1 = 3.
    expect(score).toBe(2 + 2 + 2 + 5 + 3);
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

  it('águila da +1PV por cada animal de coste 5 o más que tenga en TODA su colección (se cuenta a sí misma, esté donde esté)', () => {
    const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }]);
    const player = getActivePlayer(state);

    const eagle = { ...getCard('eagle'), instanceId: 'eagle#test' }; // 0PV base, coste 5
    const lion = { ...getCard('lion'), instanceId: 'lion#test' }; // 5PV, coste 6: cuenta
    const turtle = { ...getCard('turtle'), instanceId: 'turtle#test' }; // 1PV, coste 2: no cuenta
    player.hand.push(eagle, lion, turtle);
    // Este león está en el mazo, no en la mano: también cuenta para el bonus del águila.
    player.deck.push({ ...getCard('lion'), instanceId: 'lion#outside' });

    const score = scorePlayer(state, player);
    // águila(0PV) + león×2(5+5PV) + tortuga(1PV) + bonus águila: 3 animales de
    // coste≥5 en TODA la colección (águila + 2 leones) × 1 = 3.
    expect(score).toBe(0 + 5 + 5 + 1 + 3);
  });

  it('el Cocodrilo elimina, antes de puntuar, el animal NO VOLADOR de menor valor real de TODA su colección (mazo, mano o descarte), ignorando solo lo volador', () => {
    const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }]);
    const player = getActivePlayer(state);
    // La destrucción del Cocodrilo solo se aplica con la partida terminada
    // (ver scoring.ts): en mitad de la partida solo puntúa, sin destruir.
    state.gameOver = true;
    player.deck = []; // mazo inicial fuera, para un escenario determinista
    player.hand = []; // la mano inicial (repartida por createGame) también, o sus Perezosos/monedas seguirían siendo candidatos

    const crocodile = { ...getCard('crocodile'), instanceId: 'croc#test' };
    const owl = { ...getCard('owl'), instanceId: 'owl#bird' }; // volador, 3PV: se salva SIEMPRE por ser volador, esté donde esté
    const turtle = { ...getCard('turtle'), instanceId: 'turtle#weak' }; // terrestre-acuático, 1PV: la más débil elegible, debe destruirse aunque esté en la MANO
    const hippo = { ...getCard('hippopotamus'), instanceId: 'hippo#strong' }; // terrestre-acuático, 4PV: sobrevive por ser más fuerte
    // El Cocodrilo y la Tortuga (la más débil) van a la MANO a propósito:
    // antes el Cocodrilo solo miraba el mazo de robo, así que esto habría
    // salvado a la Tortuga por no estar ahí. Ahora mira toda la colección.
    player.hand.push(crocodile, turtle);
    player.deck.push(owl, hippo);

    const score = scorePlayer(state, player);

    expect(player.hand.some((c) => c.instanceId === 'turtle#weak')).toBe(false);
    expect(player.deck.some((c) => c.instanceId === 'owl#bird')).toBe(true);
    expect(player.deck.some((c) => c.instanceId === 'hippo#strong')).toBe(true);
    expect(player.hand.some((c) => c.instanceId === 'croc#test')).toBe(true);
    // La tortuga (1PV, la más débil elegible) fue destruida antes de puntuar.
    // Quedan cocodrilo(7PV) + búho(3PV) + hipopótamo(4PV).
    expect(score).toBe(7 + 3 + 4);
    // Se guarda aparte, solo para el resumen final (no cuenta para el score).
    expect(player.destroyedCards.map((c) => c.instanceId)).toEqual(['turtle#weak']);
  });

  it('el Cocodrilo compara el VALOR REAL (PV + bonus onScore propio), no solo el PV impreso: no sacrifica un Oso polar con bonus alto solo por tener 0PV base', () => {
    const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }]);
    const player = getActivePlayer(state);
    state.gameOver = true;
    player.deck = [];
    player.hand = []; // la mano inicial repartida por createGame también, o sus Perezosos/monedas seguirían siendo candidatos

    const crocodile = { ...getCard('crocodile'), instanceId: 'croc#test' }; // 7PV, terrestre-acuático
    // Oso polar: 0PV impreso (el más bajo posible), pero +1PV por cada
    // animal TERRESTRE de toda la colección — con crocodile+polarBear+
    // turtle+lion (los 4 son terrestres) su valor real es 4, muy por
    // encima de lo que sugiere su PV base.
    const polarBear = { ...getCard('polar-bear'), instanceId: 'polarbear#test' };
    const turtle = { ...getCard('turtle'), instanceId: 'turtle#weak' }; // 1PV, sin bonus: el que de verdad vale menos
    const lion = { ...getCard('lion'), instanceId: 'lion#strong' }; // 5PV, sin bonus
    player.deck.push(crocodile, polarBear, turtle, lion);

    scorePlayer(state, player);

    // Comparando solo PV impreso, el Oso polar (0PV) parecería el más débil
    // y sería el sacrificado; comparando el valor real, la Tortuga (1PV,
    // sin bonus) vale menos que el Oso polar (valor real 4) y es la que debe
    // destruirse.
    expect(player.deck.some((c) => c.instanceId === 'turtle#weak')).toBe(false);
    expect(player.deck.some((c) => c.instanceId === 'polarbear#test')).toBe(true);
    expect(player.deck.some((c) => c.instanceId === 'lion#strong')).toBe(true);
    expect(player.destroyedCards.map((c) => c.instanceId)).toEqual(['turtle#weak']);
  });

  it('el Cocodrilo se destruye a sí mismo si es la única carta no voladora de su mazo', () => {
    const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }]);
    const player = getActivePlayer(state);
    state.gameOver = true;
    // Se limpian mazo Y mano: un Perezoso o moneda del reparto inicial (0PV,
    // terrestre) sería un candidato más débil que el propio Cocodrilo,
    // arruinando el escenario "es la única carta elegible" que este test
    // quiere probar.
    player.deck = [];
    player.hand = [];

    const crocodile = { ...getCard('crocodile'), instanceId: 'croc#solo' };
    player.deck.push(crocodile);

    // Sin ninguna otra carta no voladora en el mazo a la que sacrificar, se
    // destruye a sí mismo: no llega a puntuar sus 7PV. El resto de la
    // colección son monedas y Perezosos (0PV cada uno), así que el total
    // esperado es 0.
    const score = scorePlayer(state, player);

    expect(player.deck.some((c) => c.instanceId === 'croc#solo')).toBe(false);
    expect(score).toBe(0);
    expect(player.destroyedCards.map((c) => c.instanceId)).toEqual(['croc#solo']);
  });

  it('con 2 cocodrilos en el mazo, cada uno prefiere destruir al otro antes que a sí mismo', () => {
    const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }]);
    const player = getActivePlayer(state);
    state.gameOver = true;
    player.deck = [];
    player.hand = []; // sin esto, un Perezoso/moneda de la mano inicial (0PV) competiría con los cocodrilos

    player.deck.push(
      { ...getCard('crocodile'), instanceId: 'croc#a' },
      { ...getCard('crocodile'), instanceId: 'croc#b' }
    );

    scorePlayer(state, player);

    // El primer cocodrilo en resolverse destruye al otro (mismo PV: gana el
    // primero por orden de aparición); solo queda 1 en el mazo.
    expect(player.deck).toHaveLength(1);
  });

  it('el Cocodrilo solo destruye UNA VEZ en total, aunque scoreGame() se llame muchas veces tras terminar la partida (marcador en vivo de la web)', () => {
    const state = createGame([
      { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
      { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
    ]);
    const player = getActivePlayer(state);
    state.gameOver = true;
    player.deck = [];
    player.hand = []; // sin esto, un Perezoso/moneda de la mano inicial (0PV) sería el objetivo en vez del pez de colores

    const crocodile = { ...getCard('crocodile'), instanceId: 'croc#test' };
    const hippo1 = { ...getCard('hippopotamus'), instanceId: 'hippo#1' };
    const hippo2 = { ...getCard('hippopotamus'), instanceId: 'hippo#2' };
    const goldfish = { ...getCard('goldfish'), instanceId: 'goldfish#1pv' };
    player.deck.push(crocodile, hippo1, hippo2, goldfish);

    // La web llama a scoreGame() en cada render, incluso después de que la
    // partida haya terminado (marcador en vivo + popup de colección): el
    // Cocodrilo debe sacrificar UN animal la primera vez y ninguno más,
    // nunca seguir comiéndose la colección turno a turno.
    scoreGame(state);
    scoreGame(state);
    scoreGame(state);

    expect(player.deck.some((c) => c.instanceId === 'goldfish#1pv')).toBe(false);
    expect(player.deck.some((c) => c.instanceId === 'hippo#1')).toBe(true);
    expect(player.deck.some((c) => c.instanceId === 'hippo#2')).toBe(true);
    expect(player.deck.some((c) => c.instanceId === 'croc#test')).toBe(true);
    // Tampoco se acumula en destroyedCards en cada llamada: solo 1 entrada.
    expect(player.destroyedCards).toHaveLength(1);
  });

  it('repro: con Orcas (bonus alto) y un Perezoso en la mano, destruye el Perezoso y no la Tortuga del mazo', () => {
    const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }]);
    const player = getActivePlayer(state);
    state.gameOver = true;
    player.deck = [];
    player.hand = [];

    const crocodile = { ...getCard('crocodile'), instanceId: 'croc#test' };
    // 3 Orcas: 2PV base + 1PV por cada acuático de la colección. Con
    // crocodile/turtle/sloth también acuáticos o terrestres variados, su
    // valor real queda muy por encima de 0-1PV: nunca deben ser el objetivo.
    const orca1 = { ...getCard('orca'), instanceId: 'orca#1' };
    const orca2 = { ...getCard('orca'), instanceId: 'orca#2' };
    const orca3 = { ...getCard('orca'), instanceId: 'orca#3' };
    const turtle = { ...getCard('turtle'), instanceId: 'turtle#deck' }; // 1PV, sin bonus, en el MAZO
    const sloth = { ...getCard('sloth'), instanceId: 'sloth#hand' }; // 0PV, sin bonus, en la MANO: el objetivo correcto
    player.hand.push(crocodile, sloth);
    player.deck.push(orca1, orca2, orca3, turtle);

    scorePlayer(state, player);

    expect(player.hand.some((c) => c.instanceId === 'sloth#hand')).toBe(false);
    expect(player.deck.some((c) => c.instanceId === 'turtle#deck')).toBe(true);
    expect(player.deck.some((c) => c.instanceId === 'orca#1')).toBe(true);
    expect(player.deck.some((c) => c.instanceId === 'orca#2')).toBe(true);
    expect(player.deck.some((c) => c.instanceId === 'orca#3')).toBe(true);
    expect(player.destroyedCards.map((c) => c.instanceId)).toEqual(['sloth#hand']);
  });

  it('repro: 3 Cocodrilos con el mazo de robo vacío (todo en mano/descarte, lo normal al final de la partida) siguen destruyendo algo cada uno', () => {
    const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }]);
    const player = getActivePlayer(state);
    state.gameOver = true;
    // El mazo de robo se queda VACÍO a propósito: es la situación típica al
    // terminar la partida (endTurn roba una mano nueva justo antes de
    // comprobar el fin de partida, ver engine.ts), y antes de este fix el
    // Cocodrilo solo miraba el mazo de robo, así que con esto vacío ninguno
    // de los 3 destruía nada.
    player.deck = [];
    player.hand = [];
    player.discard = [];

    const crocodiles = [
      { ...getCard('crocodile'), instanceId: 'croc#a' },
      { ...getCard('crocodile'), instanceId: 'croc#b' },
      { ...getCard('crocodile'), instanceId: 'croc#c' },
    ];
    const hippos = [
      { ...getCard('hippopotamus'), instanceId: 'hippo#1' },
      { ...getCard('hippopotamus'), instanceId: 'hippo#2' },
      { ...getCard('hippopotamus'), instanceId: 'hippo#3' },
    ];
    // Repartidos entre mano y descarte, ninguno en el mazo de robo.
    player.hand.push(...crocodiles);
    player.discard.push(...hippos);

    scorePlayer(state, player);

    expect(player.destroyedCards).toHaveLength(3);
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
    // pingüino(2PV) + león×2(5+5PV) + delfín(2PV) + bonus pingüino: 4
    // especies distintas (pingüino, león, delfín Y el Perezoso del mazo
    // inicial, que sigue contando como especie aunque dé 0PV) × 1PV = 4.
    expect(score).toBe(2 + 5 + 5 + 2 + 4);
  });

  it('para el bonus del albatros, el periquito cuenta como 2 voladores, no 1', () => {
    const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }]);
    const player = getActivePlayer(state);

    const albatross = { ...getCard('albatross'), instanceId: 'albatross#test' }; // 2PV base
    const parakeet = { ...getCard('parakeet'), instanceId: 'parakeet#test' }; // 1PV base, cuenta como 2 voladores
    player.hand.push(albatross, parakeet);

    const score = scorePlayer(state, player);
    // albatros(2PV) + periquito(1PV) + bonus albatros: periquito cuenta 2 + el propio albatros 1 = 3 × 1 = 3.
    expect(score).toBe(2 + 1 + 3);
  });
});
