import { describe, expect, it } from 'vitest';
import { buyAnimal, canAffordMarket, createGame, getLegalActions, playCard } from '../src/engine';
import { getCard } from '../src/cards/registry';
import { buildStarterDeck } from './helpers';

function freshInstance(cardId: string, suffix: string) {
  return { ...getCard(cardId), instanceId: `${cardId}#${suffix}` };
}

function setupClean() {
  const state = createGame([
    { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
    { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
  ]);
  for (const player of state.players) {
    player.deck = [];
    player.hand = [];
    player.discard = [];
  }
  return { state, player: state.players[0], opponent: state.players[1] };
}

describe('habilidades de animales al jugarlos (onPlay)', () => {
  it('águila: al jugarla, robas 1 carta', () => {
    const { state, player } = setupClean();
    const eagle = freshInstance('eagle', 'test');
    player.hand = [eagle];
    player.deck = [freshInstance('coin-1', 'draw1')];

    playCard(state, player.id, eagle.instanceId);

    expect(player.hand).toHaveLength(1);
    expect(player.hand[0].instanceId).toBe('coin-1#draw1');
  });

  it('mono: cada rival ELIGE qué descarta (no al azar); si solo tiene monedas, no le queda más remedio y robas 1 carta', () => {
    const { state, player, opponent } = setupClean();
    opponent.hand = [freshInstance('coin-1', 'o1'), freshInstance('coin-2', 'o2')]; // sin ningún animal que proteger sus monedas
    const monkey = freshInstance('monkey', 'test');
    player.hand = [monkey];
    player.deck = [freshInstance('coin-1', 'draw1')];

    playCard(state, player.id, monkey.instanceId);

    expect(opponent.hand).toHaveLength(1);
    expect(opponent.discard).toHaveLength(1);
    expect(opponent.discard[0].type).toBe('coin');
    expect(player.hand).toHaveLength(1); // robó 1 carta del mazo
  });

  it('mono: si el rival tiene un animal Y una moneda, protege la moneda descartando el animal (aunque valga más)', () => {
    const { state, player, opponent } = setupClean();
    const hippo = freshInstance('hippopotamus', 'o1'); // 4PV: vale más "en bruto" que la moneda
    const coin = freshInstance('coin-1', 'o2'); // vale 1: peor en valor bruto, pero es una moneda
    opponent.hand = [hippo, coin];
    const monkey = freshInstance('monkey', 'test');
    player.hand = [monkey];
    player.deck = [freshInstance('coin-1', 'draw1')];

    playCard(state, player.id, monkey.instanceId);

    // Protege la moneda (evita darte un robo) y sacrifica el animal, aunque valga más PV.
    expect(opponent.hand).toEqual([coin]);
    expect(opponent.discard).toEqual([hippo]);
    expect(player.hand).toHaveLength(0); // no le tocó soltar moneda: no robaste nada
  });

  it('mono: si al rival solo le queda un animal en mano, lo descarta y no robas nada', () => {
    const { state, player, opponent } = setupClean();
    opponent.hand = [freshInstance('lion', 'o1')];
    const monkey = freshInstance('monkey', 'test');
    player.hand = [monkey];
    player.deck = [freshInstance('coin-1', 'draw1')];

    playCard(state, player.id, monkey.instanceId);

    expect(opponent.discard).toHaveLength(1);
    expect(opponent.discard[0].type).toBe('animal');
    expect(player.hand).toHaveLength(0); // no robó nada
  });

  it('mono: con varios rivales, robas 1 carta por cada uno al que no le quedara más remedio que soltar una moneda', () => {
    const state = createGame([
      { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
      { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
      { id: 'p3', name: 'Carol', deck: buildStarterDeck() },
    ]);
    for (const p of state.players) {
      p.deck = [];
      p.hand = [];
      p.discard = [];
    }
    const [p1, p2, p3] = state.players;
    p2.hand = [freshInstance('coin-1', 'b1')]; // solo tiene moneda: sin remedio
    p3.hand = [freshInstance('lion', 'c1')]; // solo tiene animal
    const monkey = freshInstance('monkey', 'test');
    p1.hand = [monkey];
    p1.deck = [freshInstance('coin-1', 'draw1'), freshInstance('coin-1', 'draw2')];

    playCard(state, p1.id, monkey.instanceId);

    expect(p2.discard).toHaveLength(1);
    expect(p3.discard).toHaveLength(1);
    expect(p1.hand).toHaveLength(1); // solo 1 de los 2 rivales tuvo que soltar moneda
  });

  it('león: gana 4 de dinero extra para comprar este turno, fijo (no depende de la mano)', () => {
    const { state, player } = setupClean();
    const lion = freshInstance('lion', 'test');
    player.hand = [lion];

    playCard(state, player.id, lion.instanceId);

    expect(player.bonusPurchasingPowerThisTurn).toBe(4);
  });

  it('delfín: da 2 de valor de compra, pero restringido: solo cuenta comprando animales acuáticos', () => {
    const { state, player } = setupClean();
    const dolphin = freshInstance('dolphin', 'test');
    player.hand = [dolphin];

    playCard(state, player.id, dolphin.instanceId);

    expect(player.bonusPurchasingPowerThisTurn).toBe(0);
    expect(player.aquaticBonusPurchasingPowerThisTurn).toBe(2);
    // No es dinero real: no se añaden cartas de moneda a la mano.
    expect(player.hand.filter((c) => c.type === 'coin')).toHaveLength(0);
  });

  it('delfín: su valor de compra restringido SÍ paga un animal acuático sin monedas físicas', () => {
    const { state, player } = setupClean();
    const dolphin = freshInstance('dolphin', 'test');
    player.hand = [dolphin];
    playCard(state, player.id, dolphin.instanceId);

    const target = state.animalTrack.find((c) => (c.habitats as string[])?.includes('aquatic') && (c.marketCost ?? 0) <= 2)!;

    expect(canAffordMarket(player, target.marketCost ?? 0, true)).toBe(true);
    buyAnimal(state, player.id, target.instanceId);

    expect(player.discard.some((c) => c.instanceId === target.instanceId)).toBe(true);
    expect(player.aquaticBonusPurchasingPowerThisTurn).toBe(2 - (target.marketCost ?? 0));
  });

  it('delfín: su valor de compra restringido NO sirve para un animal terrestre/volador ni para una moneda', () => {
    const { state, player } = setupClean();
    const dolphin = freshInstance('dolphin', 'test');
    player.hand = [dolphin];
    playCard(state, player.id, dolphin.instanceId);

    const landOrBird = state.animalTrack.find(
      (c) => !(c.habitats as string[])?.includes('aquatic') && (c.marketCost ?? 0) <= 2
    )!;

    // Sin monedas físicas de por medio: si contara para esto, sería pagable.
    expect(canAffordMarket(player, landOrBird.marketCost ?? 0, false)).toBe(false);
    expect(() => buyAnimal(state, player.id, landOrBird.instanceId)).toThrow();
    expect(canAffordMarket(player, getCard('coin-2').marketCost ?? 0)).toBe(false);
  });

  it('tigre: roba 2 cartas y deja la elegida por el jugador encima del mazo', () => {
    const { state, player } = setupClean();
    const drawn1 = freshInstance('coin-1', 'd1');
    const drawn2 = freshInstance('coin-2', 'd2');
    player.deck = [drawn1, drawn2]; // drawCards hace pop(): se roban en orden inverso (d2, luego d1)
    const tiger = freshInstance('tiger', 'test');
    player.hand = [tiger];

    playCard(state, player.id, tiger.instanceId, drawn1.instanceId);

    // Robó las 2, dejó d1 encima del mazo -> se queda con d2 en mano.
    expect(player.hand).toHaveLength(1);
    expect(player.hand[0].instanceId).toBe(drawn2.instanceId);
    expect(player.deck).toHaveLength(1);
    expect(player.deck[0].instanceId).toBe(drawn1.instanceId);
  });

  it('tigre: sin elegir cuál dejar (llamada directa sin pasar por getLegalActions), roba igual pero no deja nada encima', () => {
    const { state, player } = setupClean();
    player.deck = [freshInstance('coin-1', 'd1'), freshInstance('coin-2', 'd2')];
    const tiger = freshInstance('tiger', 'test');
    player.hand = [tiger];

    playCard(state, player.id, tiger.instanceId);

    expect(player.hand).toHaveLength(2);
    expect(player.deck).toHaveLength(0);
  });

  it('tigre: getLegalActions ofrece elegir entre la mano ya existente y las cartas que todavía están por robar', () => {
    const { state, player } = setupClean();
    const existing = freshInstance('lion', 'existing'); // ya en mano antes de jugar el tigre
    const drawn1 = freshInstance('coin-1', 'd1');
    const drawn2 = freshInstance('coin-2', 'd2');
    player.deck = [drawn1, drawn2];
    const tiger = freshInstance('tiger', 'test');
    player.hand = [tiger, existing];

    const actions = getLegalActions(state, player.id);
    const targets = actions
      .filter((a): a is Extract<typeof a, { type: 'playCard' }> => a.type === 'playCard' && a.instanceId === tiger.instanceId)
      .map((a) => a.targetInstanceId)
      .sort();

    expect(targets).toEqual([existing.instanceId, drawn1.instanceId, drawn2.instanceId].sort());
  });

  it('foca: gana 1 moneda extra por cada animal acuático en su mano al jugarla (se cuenta a sí misma)', () => {
    const { state, player } = setupClean();
    const seal = freshInstance('seal', 'test'); // acuática: se cuenta a sí misma
    const dolphin = freshInstance('dolphin', 'd1'); // acuático
    const lion = freshInstance('lion', 'l1'); // terrestre, no cuenta
    player.hand = [seal, dolphin, lion];

    playCard(state, player.id, seal.instanceId);

    // Foca + Delfín (2 acuáticos), aunque la propia Foca ya esté en el descarte.
    expect(player.bonusPurchasingPowerThisTurn).toBe(2);
  });

  it('foca: el pez de colores en la mano cuenta como 2 animales acuáticos, no 1', () => {
    const { state, player } = setupClean();
    const seal = freshInstance('seal', 'test'); // acuática: 1
    const goldfish = freshInstance('goldfish', 'g1'); // acuático: cuenta como 2
    player.hand = [seal, goldfish];

    playCard(state, player.id, seal.instanceId);

    // Foca (1) + Pez de colores (2) = 3.
    expect(player.bonusPurchasingPowerThisTurn).toBe(3);
  });

  it('pez de colores: no hace nada al jugarlo (como el perezoso, pero sí se puede comprar)', () => {
    const { state, player } = setupClean();
    const goldfish = freshInstance('goldfish', 'test');
    player.hand = [goldfish];

    playCard(state, player.id, goldfish.instanceId);

    expect(player.bonusPurchasingPowerThisTurn).toBe(0);
    // Jugada, no descartada todavía: se queda "en el limbo" hasta que
    // termine el turno (ver playCard/endTurn en engine.ts).
    expect(player.playedThisTurn.some((c) => c.id === 'goldfish')).toBe(true);
    expect(player.discard.some((c) => c.id === 'goldfish')).toBe(false);
  });

  it('serpiente: gana 1 moneda extra por cada animal terrestre en su mano al jugarla (se cuenta a sí misma)', () => {
    const { state, player } = setupClean();
    const snake = freshInstance('snake', 'test'); // terrestre: se cuenta a sí misma
    const lion = freshInstance('lion', 'l1'); // terrestre
    const giraffe = freshInstance('giraffe', 'g1'); // terrestre
    player.hand = [snake, lion, giraffe];

    playCard(state, player.id, snake.instanceId);

    // Serpiente + León + Jirafa (3 terrestres), aunque la Serpiente ya esté en el descarte.
    expect(player.bonusPurchasingPowerThisTurn).toBe(3);
  });

  it('serpiente: los animales terrestres ya jugados antes este turno también cuentan', () => {
    const { state, player } = setupClean();
    const snake1 = freshInstance('snake', 's1');
    const snake2 = freshInstance('snake', 's2');
    const lion = freshInstance('lion', 'l1'); // terrestre

    player.hand = [snake1];
    playCard(state, player.id, snake1.instanceId);
    // Solo ella misma en mano (terrestre): +1.
    expect(player.bonusPurchasingPowerThisTurn).toBe(1);

    // Simula robar más cartas antes de seguir jugando este mismo turno.
    player.hand = [snake2, lion];
    playCard(state, player.id, snake2.instanceId);
    // Ahora: snake2 (a sí misma) + león (sigue en mano) + snake1 (ya jugada
    // este turno, sigue contando aunque esté en el descarte) = 3 más.
    expect(player.bonusPurchasingPowerThisTurn).toBe(1 + 3);
  });

  it('loro: gana 1 moneda extra por cada animal volador en su mano al jugarlo (se cuenta a sí mismo)', () => {
    const { state, player } = setupClean();
    const parrot = freshInstance('parrot', 'test'); // volador: se cuenta a sí mismo
    const vulture = freshInstance('vulture', 'v1'); // volador
    player.hand = [parrot, vulture];

    playCard(state, player.id, parrot.instanceId);

    // Loro + Buitre (2 voladores), aunque el propio Loro ya esté en el descarte.
    expect(player.bonusPurchasingPowerThisTurn).toBe(2);
  });

  it('loro: el periquito en la mano cuenta como 2 animales voladores, no 1', () => {
    const { state, player } = setupClean();
    const parrot = freshInstance('parrot', 'test'); // volador: 1
    const parakeet = freshInstance('parakeet', 'p1'); // volador: cuenta como 2
    player.hand = [parrot, parakeet];

    playCard(state, player.id, parrot.instanceId);

    // Loro (1) + Periquito (2) = 3.
    expect(player.bonusPurchasingPowerThisTurn).toBe(3);
  });

  it('ornitorrinco: gana 1 moneda extra por cada especie DISTINTA en su mano (no por copia)', () => {
    const { state, player } = setupClean();
    const platypus = freshInstance('platypus', 'test'); // se cuenta a sí mismo
    const lion1 = freshInstance('lion', 'l1');
    const lion2 = freshInstance('lion', 'l2'); // 2ª copia del león: no suma especie extra
    player.hand = [platypus, lion1, lion2];

    playCard(state, player.id, platypus.instanceId);

    // Ornitorrinco + León (2 especies distintas), aunque haya 2 leones.
    expect(player.bonusPurchasingPowerThisTurn).toBe(2);
  });

  it('elefante: captura gratis un animal TERRESTRE del mercado de coste 5 o menos', () => {
    const { state, player } = setupClean();
    const elephant = freshInstance('elephant', 'test');
    player.hand = [elephant];
    const target = state.animalTrack.find(
      (c) => c.habitats?.includes('land') && (c.marketCost ?? 0) <= 5,
    )!;
    const marketBefore = state.animalTrack.length;

    playCard(state, player.id, elephant.instanceId, target.instanceId);

    expect(state.animalTrack).toHaveLength(marketBefore);
    expect(state.animalTrack.some((c) => c.instanceId === target.instanceId)).toBe(false);
    expect(player.discard.some((c) => c.instanceId === target.instanceId)).toBe(true);
    expect(player.playedThisTurn.some((c) => c.id === 'elephant')).toBe(true);
  });

  it('elefante: no puede capturar un animal terrestre de coste mayor a 5', () => {
    const { state, player } = setupClean();
    const elephant = freshInstance('elephant', 'test');
    player.hand = [elephant];
    const tooExpensive = state.animalTrack.find(
      (c) => c.habitats?.includes('land') && (c.marketCost ?? 0) > 5,
    )!;
    const marketBefore = state.animalTrack.length;

    playCard(state, player.id, elephant.instanceId, tooExpensive.instanceId);

    // No es un candidato legal (supera el coste máximo): se ignora.
    expect(state.animalTrack).toHaveLength(marketBefore);
    expect(state.animalTrack.some((c) => c.instanceId === tooExpensive.instanceId)).toBe(true);
    expect(player.playedThisTurn.some((c) => c.id === 'elephant')).toBe(true);
  });

  it('elefante: no puede capturar un animal que no sea terrestre', () => {
    const { state, player } = setupClean();
    const elephant = freshInstance('elephant', 'test');
    player.hand = [elephant];
    const nonLandTarget = state.animalTrack.find((c) => !c.habitats?.includes('land'))!;
    const marketBefore = state.animalTrack.length;

    playCard(state, player.id, elephant.instanceId, nonLandTarget.instanceId);

    // targetInstanceId no es un candidato legal (no es terrestre): se ignora.
    expect(state.animalTrack).toHaveLength(marketBefore);
    expect(state.animalTrack.some((c) => c.instanceId === nonLandTarget.instanceId)).toBe(true);
    expect(player.playedThisTurn.some((c) => c.id === 'elephant')).toBe(true);
  });

  it('elefante: sin elegir objetivo, no captura nada (no hace nada por defecto)', () => {
    const { state, player } = setupClean();
    const elephant = freshInstance('elephant', 'test');
    player.hand = [elephant];
    const marketBefore = state.animalTrack.length;

    playCard(state, player.id, elephant.instanceId);

    expect(state.animalTrack).toHaveLength(marketBefore);
    expect(player.playedThisTurn.some((c) => c.id === 'elephant')).toBe(true);
  });

  it('conejo: mejora 1 moneda de la mano de 1 a 2', () => {
    const { state, player } = setupClean();
    const coin = freshInstance('coin-1', 'c1');
    const rabbitCard = freshInstance('rabbit', 'test');
    player.hand = [coin, rabbitCard];

    playCard(state, player.id, rabbitCard.instanceId);

    const coins = player.hand.filter((c) => c.type === 'coin');
    expect(coins).toHaveLength(1);
    expect(coins[0].value).toBe(2);
  });

  it('jirafa: recupera a tu mano el animal elegido de tu propio descarte', () => {
    const { state, player } = setupClean();
    const giraffe = freshInstance('giraffe', 'test');
    const snake = freshInstance('snake', 's1'); // descartada en un turno anterior
    player.hand = [giraffe];
    player.discard = [snake];

    playCard(state, player.id, giraffe.instanceId, snake.instanceId);

    expect(player.hand.some((c) => c.instanceId === snake.instanceId)).toBe(true);
    expect(player.discard.some((c) => c.instanceId === snake.instanceId)).toBe(false);
  });

  it('jirafa: sin elegir objetivo, no recupera nada', () => {
    const { state, player } = setupClean();
    const giraffe = freshInstance('giraffe', 'test');
    const snake = freshInstance('snake', 's1');
    player.hand = [giraffe];
    player.discard = [snake];

    playCard(state, player.id, giraffe.instanceId);

    expect(player.hand.some((c) => c.instanceId === snake.instanceId)).toBe(false);
    expect(player.discard.some((c) => c.instanceId === snake.instanceId)).toBe(true);
  });

  it('jirafa: si no hay ningún animal en el descarte, no pasa nada (no hay candidatos)', () => {
    const { state, player } = setupClean();
    const giraffe = freshInstance('giraffe', 'test');
    player.hand = [giraffe];
    player.discard = [];

    const actions = getLegalActions(state, player.id);
    const giraffeActions = actions.filter((a) => a.type === 'playCard' && a.instanceId === giraffe.instanceId);
    expect(giraffeActions).toEqual([{ type: 'playCard', instanceId: giraffe.instanceId }]);
  });

  it('jirafa: getLegalActions ofrece una variante por cada animal del descarte (las monedas no cuentan)', () => {
    const { state, player } = setupClean();
    const giraffe = freshInstance('giraffe', 'test');
    const snake = freshInstance('snake', 's1');
    const lion = freshInstance('lion', 'l1');
    const coin = freshInstance('coin-1', 'c1');
    player.hand = [giraffe];
    player.discard = [snake, lion, coin];

    const actions = getLegalActions(state, player.id);
    const targets = actions
      .filter((a): a is Extract<typeof a, { type: 'playCard' }> => a.type === 'playCard' && a.instanceId === giraffe.instanceId)
      .map((a) => a.targetInstanceId)
      .sort();

    expect(targets).toEqual([snake.instanceId, lion.instanceId].sort());
  });

  it('jirafa: NO puede recuperar un animal jugado este mismo turno (sigue "en el limbo", no en el descarte de verdad)', () => {
    const { state, player } = setupClean();
    const lion = freshInstance('lion', 'test');
    const giraffe = freshInstance('giraffe', 'g1');
    player.hand = [lion, giraffe];

    playCard(state, player.id, lion.instanceId);
    expect(player.discard.some((c) => c.instanceId === lion.instanceId)).toBe(false);
    expect(player.playedThisTurn.some((c) => c.instanceId === lion.instanceId)).toBe(true);

    const actions = getLegalActions(state, player.id);
    const giraffeActions = actions.filter((a) => a.type === 'playCard' && a.instanceId === giraffe.instanceId);
    // Sin ningún animal en el descarte de verdad, la Jirafa no ofrece
    // ninguna variante con target: el León recién jugado no cuenta.
    expect(giraffeActions).toEqual([{ type: 'playCard', instanceId: giraffe.instanceId }]);
  });

  it('pato: getLegalActions NO te ofrece elegirte a ti mismo como objetivo', () => {
    const { state, player } = setupClean();
    const duck = freshInstance('duck', 'test');
    player.hand = [duck];

    const actions = getLegalActions(state, player.id);
    const selfTargeted = actions.filter(
      (a) => a.type === 'playCard' && a.targetPlayerId === player.id
    );

    expect(selfTargeted).toHaveLength(0);
  });

  it('tortuga: si la carta de encima del mazo NO es un animal de coste superior a 3 (aquí, una moneda), la añade a la mano', () => {
    const { state, player } = setupClean();
    const turtle = freshInstance('turtle', 'test');
    const coin = freshInstance('coin-1', 'top');
    player.hand = [turtle];
    player.deck = [coin]; // encima del mazo (pop() roba del final)

    playCard(state, player.id, turtle.instanceId);

    expect(player.hand.some((c) => c.instanceId === 'coin-1#top')).toBe(true);
    expect(player.deck).toHaveLength(0);
  });

  it('tortuga: si es un animal de coste 3 o menos, también la añade a la mano', () => {
    const { state, player } = setupClean();
    const turtle = freshInstance('turtle', 'test');
    const dolphin = freshInstance('dolphin', 'top'); // coste 3, justo en el límite
    player.hand = [turtle];
    player.deck = [dolphin];

    playCard(state, player.id, turtle.instanceId);

    expect(player.hand.some((c) => c.instanceId === 'dolphin#top')).toBe(true);
    expect(player.deck).toHaveLength(0);
  });

  it('tortuga: si es un animal de coste SUPERIOR a 3, se queda encima del mazo (no se roba)', () => {
    const { state, player } = setupClean();
    const turtle = freshInstance('turtle', 'test');
    const lion = freshInstance('lion', 'top'); // coste 5
    player.hand = [turtle];
    player.deck = [lion];

    playCard(state, player.id, turtle.instanceId);

    expect(player.hand.some((c) => c.instanceId === 'lion#top')).toBe(false);
    expect(player.deck).toEqual([lion]);
  });

  it('tortuga: si el mazo está vacío, baraja el descarte primero (igual que un robo normal) antes de mirar', () => {
    const { state, player } = setupClean();
    const turtle = freshInstance('turtle', 'test');
    const coin1 = freshInstance('coin-1', 'discarded1');
    const coin2 = freshInstance('coin-1', 'discarded2');
    player.hand = [turtle];
    player.deck = [];
    player.discard = [coin1, coin2];

    playCard(state, player.id, turtle.instanceId);

    // La propia Tortuga NO cuenta para este barajeo: al jugarla se queda "en
    // el limbo" (playedThisTurn), no en el descarte de verdad todavía (ver
    // playCard en engine.ts). Se baraja [moneda1, moneda2], se roba 1 (no
    // animal caro), queda 1 en el mazo.
    expect(player.hand).toHaveLength(1);
    expect(player.discard).toHaveLength(0);
    expect(player.deck).toHaveLength(1);
  });


  it('araña: captura gratis un animal VOLADOR o ACUÁTICO del mercado de coste 3 o menos', () => {
    const { state, player } = setupClean();
    const spider = freshInstance('spider', 'test');
    player.hand = [spider];
    const target = state.animalTrack.find(
      (c) =>
        (c.habitats?.includes('bird') || c.habitats?.includes('aquatic')) && (c.marketCost ?? 0) <= 3,
    )!;
    const marketBefore = state.animalTrack.length;

    playCard(state, player.id, spider.instanceId, target.instanceId);

    expect(state.animalTrack).toHaveLength(marketBefore);
    expect(state.animalTrack.some((c) => c.instanceId === target.instanceId)).toBe(false);
    expect(player.discard.some((c) => c.instanceId === target.instanceId)).toBe(true);
    expect(player.playedThisTurn.some((c) => c.id === 'spider')).toBe(true);
  });

  it('araña: no puede capturar un animal que no sea volador ni acuático', () => {
    const { state, player } = setupClean();
    const spider = freshInstance('spider', 'test');
    player.hand = [spider];
    const landOnlyTarget = state.animalTrack.find(
      (c) => !c.habitats?.includes('bird') && !c.habitats?.includes('aquatic'),
    )!;
    const marketBefore = state.animalTrack.length;

    playCard(state, player.id, spider.instanceId, landOnlyTarget.instanceId);

    // targetInstanceId no es un candidato legal (ni volador ni acuático): se ignora.
    expect(state.animalTrack).toHaveLength(marketBefore);
    expect(state.animalTrack.some((c) => c.instanceId === landOnlyTarget.instanceId)).toBe(true);
    expect(player.playedThisTurn.some((c) => c.id === 'spider')).toBe(true);
  });

  it('araña: no puede capturar un animal volador/acuático de coste mayor a 3', () => {
    const { state, player } = setupClean();
    const spider = freshInstance('spider', 'test');
    player.hand = [spider];
    const tooExpensive = state.animalTrack.find(
      (c) =>
        (c.habitats?.includes('bird') || c.habitats?.includes('aquatic')) && (c.marketCost ?? 0) > 3,
    )!;
    const marketBefore = state.animalTrack.length;

    playCard(state, player.id, spider.instanceId, tooExpensive.instanceId);

    // targetInstanceId no es un candidato legal (supera el coste máximo): se ignora.
    expect(state.animalTrack).toHaveLength(marketBefore);
    expect(state.animalTrack.some((c) => c.instanceId === tooExpensive.instanceId)).toBe(true);
    expect(player.playedThisTurn.some((c) => c.id === 'spider')).toBe(true);
  });

  it('hiena: cada rival muestra su mano y descarta el animal de MAYOR coste', () => {
    const { state, player, opponent } = setupClean();
    const cheap = freshInstance('dolphin', 'cheap'); // coste 3
    const costly = freshInstance('hippopotamus', 'costly'); // coste 5
    opponent.hand = [cheap, costly];
    const hyena = freshInstance('hyena', 'test');
    player.hand = [hyena];

    playCard(state, player.id, hyena.instanceId);

    expect(opponent.hand.some((c) => c.instanceId === costly.instanceId)).toBe(false);
    expect(opponent.hand.some((c) => c.instanceId === cheap.instanceId)).toBe(true);
    expect(opponent.discard.some((c) => c.instanceId === costly.instanceId)).toBe(true);
  });

  it('hiena: si hay empate de coste, el rival "elige" y sacrifica el de menor PV', () => {
    const { state, player, opponent } = setupClean();
    const dolphin = freshInstance('dolphin', 'd1'); // coste 3, 2PV
    const flamingo = freshInstance('flamingo', 'f1'); // coste 3, 1PV
    opponent.hand = [dolphin, flamingo];
    const hyena = freshInstance('hyena', 'test');
    player.hand = [hyena];

    playCard(state, player.id, hyena.instanceId);

    expect(opponent.hand.some((c) => c.instanceId === flamingo.instanceId)).toBe(false);
    expect(opponent.hand.some((c) => c.instanceId === dolphin.instanceId)).toBe(true);
    expect(opponent.discard.some((c) => c.instanceId === flamingo.instanceId)).toBe(true);
  });

  it('hiena: si un rival no tiene ningún animal en mano, no pierde nada', () => {
    const { state, player, opponent } = setupClean();
    opponent.hand = [freshInstance('coin-1', 'o1')];
    const hyena = freshInstance('hyena', 'test');
    player.hand = [hyena];

    playCard(state, player.id, hyena.instanceId);

    expect(opponent.hand).toHaveLength(1);
    expect(opponent.discard).toHaveLength(0);
  });

  it('buitre: cada rival elige y descarta 2 cartas de su mano', () => {
    const { state, player, opponent } = setupClean();
    opponent.hand = [freshInstance('coin-1', 'o1'), freshInstance('coin-2', 'o2'), freshInstance('coin-3', 'o3')];
    const vulture = freshInstance('vulture', 'test');
    player.hand = [vulture];

    playCard(state, player.id, vulture.instanceId);

    expect(opponent.hand).toHaveLength(1);
    expect(opponent.discard).toHaveLength(2);
  });

  it('pato: el jugador que elijas te da 1 moneda cualquiera de su mano, y el resto no pierde nada', () => {
    const state = createGame([
      { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
      { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
      { id: 'p3', name: 'Carol', deck: buildStarterDeck() },
    ]);
    for (const p of state.players) {
      p.deck = [];
      p.hand = [];
      p.discard = [];
    }
    const [p1, p2, p3] = state.players;
    const otherCoin = freshInstance('coin-1', 'other'); // p2: no elegido, no debe perder nada
    p2.hand = [otherCoin];
    // Moneda de Oro (coin-3, no de Bronce/coin-1): comprueba que ya no está restringido a coin-1.
    const chosenCoin = freshInstance('coin-3', 'chosen'); // p3: elegido como objetivo
    p3.hand = [chosenCoin];
    const duck = freshInstance('duck', 'test');
    p1.hand = [duck];

    playCard(state, p1.id, duck.instanceId, undefined, undefined, p3.id);

    expect(p3.hand).toHaveLength(0);
    expect(p1.hand.some((c) => c.instanceId === chosenCoin.instanceId)).toBe(true);
    expect(p2.hand).toHaveLength(1);
  });

  it('pato: si el jugador elegido no tiene ninguna moneda, no pierde nada', () => {
    const { state, player, opponent } = setupClean();
    opponent.hand = [freshInstance('sloth', 'o1')]; // sin monedas en mano
    const duck = freshInstance('duck', 'test');
    player.hand = [duck];

    playCard(state, player.id, duck.instanceId, undefined, undefined, opponent.id);

    expect(opponent.hand).toHaveLength(1);
    expect(player.hand.filter((c) => c.type === 'coin')).toHaveLength(0);
  });

  it('pato: sin elegir jugador (sin rivales o sin objetivo), no pasa nada', () => {
    const { state, player, opponent } = setupClean();
    opponent.hand = [freshInstance('coin-1', 'o1')];
    const duck = freshInstance('duck', 'test');
    player.hand = [duck];

    playCard(state, player.id, duck.instanceId);

    expect(opponent.hand).toHaveLength(1);
    expect(player.hand.filter((c) => c.type === 'coin')).toHaveLength(0);
  });

  it('pato: con un único jugador no hace nada (no hay a quién elegir)', () => {
    const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }]);
    const [p1] = state.players;
    p1.deck = [];
    p1.discard = [];
    const duck = freshInstance('duck', 'test');
    p1.hand = [duck];

    expect(() => playCard(state, p1.id, duck.instanceId)).not.toThrow();
  });

  it('flamenco: devuelve un animal de tu mano al mazo compartido, resuelve su habilidad, y coge gratis del mercado el que el jugador elija (coste+1 como mucho)', () => {
    const { state, player } = setupClean();
    const flamingo = freshInstance('flamingo', 'test');
    const rabbitCard = freshInstance('rabbit', 'r1'); // coste 2, sube 1 moneda de 1 a 2
    const coin = freshInstance('coin-1', 'c1');
    player.hand = [flamingo, rabbitCard, coin];
    const marketBefore = state.animalTrack.length;

    const goldfishIdx = state.animalTrack.findIndex((c) => c.species === 'goldfish'); // coste 1
    const goldfish = state.animalTrack[goldfishIdx];

    playCard(state, player.id, flamingo.instanceId, rabbitCard.instanceId, goldfish.instanceId);

    // Se resuelve la habilidad del conejo devuelto: mejora la moneda de 1 a 2.
    const coins = player.hand.filter((c) => c.type === 'coin');
    expect(coins).toHaveLength(1);
    expect(coins[0].value).toBe(2);

    // El conejo vuelve al mercado, no al descarte, y queda comprable de
    // inmediato (ocupa ya el hueco de su especie en vez de esperar en el
    // mazo compartido).
    expect(player.discard.some((c) => c.id === 'rabbit')).toBe(false);
    expect(state.animalTrack.some((c) => c.instanceId === rabbitCard.instanceId)).toBe(true);

    // Coge gratis, sin resolver su habilidad, el pez dorado elegido.
    expect(player.discard.some((c) => c.instanceId === goldfish.instanceId)).toBe(true);
    expect(state.animalTrack).toHaveLength(marketBefore);
  });

  it('flamenco: puede devolverse a sí mismo (ya está en tu descarte cuando se resuelve su propio efecto)', () => {
    const { state, player } = setupClean();
    const flamingo = freshInstance('flamingo', 'test');
    player.hand = [flamingo];
    const marketBefore = state.animalTrack.length;
    const maxCost = (flamingo.marketCost ?? 0) + 2;
    const chosen = state.animalTrack.find((c) => (c.marketCost ?? 0) <= maxCost)!;

    playCard(state, player.id, flamingo.instanceId, flamingo.instanceId, chosen.instanceId);

    expect(player.discard.some((c) => c.instanceId === flamingo.instanceId)).toBe(false);
    // Queda comprable de inmediato, ocupando ya el hueco de su especie.
    expect(state.animalTrack.some((c) => c.instanceId === flamingo.instanceId)).toBe(true);
    expect(player.discard.some((c) => c.instanceId === chosen.instanceId)).toBe(true);
    expect(state.animalTrack).toHaveLength(marketBefore);
  });

  it('flamenco: si el hueco de mercado de la especie devuelta estaba vacío, se repone al momento con esa misma carta', () => {
    const { state, player } = setupClean();
    const flamingo = freshInstance('flamingo', 'test');
    const turtle = freshInstance('turtle', 't1');
    player.hand = [flamingo, turtle];

    // Vacía a la vez el mazo compartido y el hueco de mercado de la tortuga,
    // simulando que ya se habían agotado todas las copias salvo esta última
    // (la que el jugador tiene en la mano).
    state.sharedDecks.turtle = [];
    state.animalTrack = state.animalTrack.filter((c) => c.species !== 'turtle');

    const goldfish = state.animalTrack.find((c) => c.species === 'goldfish')!;

    playCard(state, player.id, flamingo.instanceId, turtle.instanceId, goldfish.instanceId);

    // La tortuga devuelta debe reponer YA el hueco vacío del mercado, no
    // quedarse esperando en el mazo compartido sin que nada la saque de ahí.
    const turtlesInMarket = state.animalTrack.filter((c) => c.species === 'turtle');
    expect(turtlesInMarket).toHaveLength(1);
    expect(turtlesInMarket[0].instanceId).toBe(turtle.instanceId);
    expect(state.sharedDecks.turtle).toHaveLength(0);
  });

  it('flamenco: "hasta 2 monedas más" no exige coste EXACTO: también puede elegir algo más barato', () => {
    const { state, player } = setupClean();
    const flamingo = freshInstance('flamingo', 'test');
    const duck = freshInstance('duck', 'd1'); // coste 2
    player.hand = [flamingo, duck];

    const goldfishIdx = state.animalTrack.findIndex((c) => c.species === 'goldfish'); // coste 1, dentro del máximo (duck+2 = 4)
    const goldfish = state.animalTrack[goldfishIdx];

    playCard(state, player.id, flamingo.instanceId, duck.instanceId, goldfish.instanceId);

    expect(player.discard.some((c) => c.instanceId === goldfish.instanceId)).toBe(true);
  });

  it('flamenco: no deja elegir un animal del mercado que cueste más de 2 monedas por encima del devuelto', () => {
    const { state, player } = setupClean();
    const flamingo = freshInstance('flamingo', 'test');
    const duck = freshInstance('duck', 'd1'); // coste 2, máximo permitido: 4
    player.hand = [flamingo, duck];

    const tooExpensive = state.animalTrack.find((c) => (c.marketCost ?? 0) > 4)!;
    const marketBefore = state.animalTrack.length;

    playCard(state, player.id, flamingo.instanceId, duck.instanceId, tooExpensive.instanceId);

    // El intento de coger algo demasiado caro se ignora: no se coge nada.
    expect(player.discard.some((c) => c.instanceId === tooExpensive.instanceId)).toBe(false);
    expect(state.animalTrack).toHaveLength(marketBefore);
  });

  it('flamenco: ofrece como objetivo a devolver los animales en mano y los ya jugados ESTE turno, pero no el mazo ni descartes de turnos anteriores', () => {
    const { state, player } = setupClean();
    const flamingo = freshInstance('flamingo', 'test');
    const playedThisTurn = freshInstance('snake', 's1'); // jugada antes en este mismo turno
    const oldDiscard = freshInstance('snake', 's2'); // descartada en un turno anterior
    const inDeck = freshInstance('snake', 's3'); // nunca robada, sigue en el mazo
    player.hand = [flamingo];
    player.discard.push(oldDiscard);
    player.playedThisTurn.push(playedThisTurn);
    player.deck.push(inDeck);

    const actions = getLegalActions(state, player.id);
    expect(actions.some((a) => a.type === 'playCard' && a.targetInstanceId === playedThisTurn.instanceId)).toBe(true);
    expect(actions.some((a) => a.type === 'playCard' && a.targetInstanceId === oldDiscard.instanceId)).toBe(false);
    expect(actions.some((a) => a.type === 'playCard' && a.targetInstanceId === inDeck.instanceId)).toBe(false);
    expect(actions.some((a) => a.type === 'playCard' && a.targetInstanceId === flamingo.instanceId)).toBe(true);
  });

  it('flamenco: SÍ ofrece un Perezoso de la mano como objetivo a devolver (coste 0: se puede cambiar por cualquier animal de hasta 2 de coste)', () => {
    const { state, player } = setupClean();
    const flamingo = freshInstance('flamingo', 'test');
    const sloth = freshInstance('sloth', 's1');
    player.hand = [flamingo, sloth];
    const goldfish = state.animalTrack.find((c) => c.species === 'goldfish')!; // coste 1, dentro del máximo (0+2=2)

    const actions = getLegalActions(state, player.id);
    expect(
      actions.some(
        (a) =>
          a.type === 'playCard' &&
          a.targetInstanceId === sloth.instanceId &&
          a.secondaryTargetInstanceId === goldfish.instanceId
      )
    ).toBe(true);
  });

  it('flamenco: devolver un Perezoso no lo cuela comprable en el mercado (no tiene hueco propio, va a su reserva compartida)', () => {
    const { state, player } = setupClean();
    const flamingo = freshInstance('flamingo', 'test');
    const sloth = freshInstance('sloth', 's1');
    player.hand = [flamingo, sloth];
    const goldfish = state.animalTrack.find((c) => c.species === 'goldfish')!;

    playCard(state, player.id, flamingo.instanceId, sloth.instanceId, goldfish.instanceId);

    expect(state.animalTrack.some((c) => c.species === 'sloth')).toBe(false);
    expect(player.discard.some((c) => c.instanceId === goldfish.instanceId)).toBe(true);
  });

  it('flamenco: puede devolver un animal ya jugado este turno para el intercambio, pero SIN volver a disparar su habilidad (ya se usó al jugarlo)', () => {
    const { state, player } = setupClean();
    const flamingo = freshInstance('flamingo', 'test');
    const rabbitCard = freshInstance('rabbit', 'r1'); // coste 2, su habilidad sube 1 moneda de 1 a 2
    const coin = freshInstance('coin-1', 'c1');
    player.hand = [flamingo, coin];
    // El Conejo ya se jugó antes este turno (por eso está en playedThisTurn,
    // "en el limbo", no en el descarte de verdad todavía): su habilidad ya
    // se resolvió entonces, en un playCard aparte que este test no simula.
    player.playedThisTurn.push(rabbitCard);

    const maxCost = (rabbitCard.marketCost ?? 0) + 2;
    const chosen = state.animalTrack.find((c) => (c.marketCost ?? 0) <= maxCost)!;

    playCard(state, player.id, flamingo.instanceId, rabbitCard.instanceId, chosen.instanceId);

    // La moneda sigue en 1: devolver el Conejo ya jugado NO vuelve a subirla.
    const coins = player.hand.filter((c) => c.type === 'coin');
    expect(coins).toHaveLength(1);
    expect(coins[0].value).toBe(1);
    // El intercambio en sí (devolverlo al mercado, comprable ya, coger el otro animal gratis) sigue funcionando.
    expect(state.animalTrack.some((c) => c.instanceId === rabbitCard.instanceId)).toBe(true);
    expect(player.discard.some((c) => c.instanceId === chosen.instanceId)).toBe(true);
  });

  it('flamenco: tras devolver un animal ya jugado este turno, un SEGUNDO Flamenco ya no lo ofrece como objetivo (ya no lo tienes)', () => {
    const { state, player } = setupClean();
    const flamingo1 = freshInstance('flamingo', 'f1');
    const flamingo2 = freshInstance('flamingo', 'f2');
    const turtle = freshInstance('turtle', 't1');
    player.hand = [flamingo1, flamingo2];
    // La Tortuga ya se jugó antes este turno: está en playedThisTurn ("en el
    // limbo"), igual que en el test anterior.
    player.playedThisTurn.push(turtle);

    const maxCost = (turtle.marketCost ?? 0) + 2;
    const chosen = state.animalTrack.find((c) => (c.marketCost ?? 0) <= maxCost)!;

    playCard(state, player.id, flamingo1.instanceId, turtle.instanceId, chosen.instanceId);

    // La Tortuga ya está en el mercado, no en la mano/descarte del jugador:
    // el segundo Flamenco no debe seguir ofreciéndola como objetivo.
    const actions = getLegalActions(state, player.id);
    expect(
      actions.some((a) => a.type === 'playCard' && a.instanceId === flamingo2.instanceId && a.targetInstanceId === turtle.instanceId)
    ).toBe(false);
  });

  it('flamenco: ofrece una variante por cada combinación de (animal a devolver) x (animal del mercado a coger)', () => {
    const { state, player } = setupClean();
    const flamingo = freshInstance('flamingo', 'test');
    const giraffe = freshInstance('giraffe', 'g1'); // coste 6
    player.hand = [flamingo, giraffe];

    const maxCost = (giraffe.marketCost ?? 0) + 2;
    const destinations = state.animalTrack.filter((c) => (c.marketCost ?? 0) <= maxCost);

    const actions = getLegalActions(state, player.id);
    for (const destination of destinations) {
      expect(actions).toContainEqual({
        type: 'playCard',
        instanceId: flamingo.instanceId,
        targetInstanceId: giraffe.instanceId,
        secondaryTargetInstanceId: destination.instanceId,
      });
    }
  });
});

describe('murciélago: cada rival elige y descarta 1 carta de su mano', () => {
  it('no ofrece ninguna variante con target: es una única acción automática', () => {
    const { state, player, opponent } = setupClean();
    const bat = freshInstance('bat', 'test');
    player.hand = [bat];
    opponent.hand = [freshInstance('coin-1', 'o1')];

    const actions = getLegalActions(state, player.id);
    const batActions = actions.filter((a) => a.type === 'playCard' && a.instanceId === bat.instanceId);
    expect(batActions).toEqual([{ type: 'playCard', instanceId: bat.instanceId }]);
  });

  it('cada rival descarta 1 carta de su mano, eligiendo él cuál (se queda con la peor)', () => {
    const { state, player, opponent } = setupClean();
    const bat = freshInstance('bat', 'test');
    const coin = freshInstance('coin-1', 'o1'); // vale poco: es la que se sacrifica
    const lion = freshInstance('lion', 'o2'); // vale mucho más
    player.hand = [bat];
    opponent.hand = [coin, lion];

    playCard(state, player.id, bat.instanceId);

    expect(opponent.hand).toEqual([lion]);
    expect(opponent.discard).toEqual([coin]);
  });

  it('si un rival no tiene ninguna carta en mano, no pierde nada', () => {
    const { state, player, opponent } = setupClean();
    const bat = freshInstance('bat', 'test');
    player.hand = [bat];
    opponent.hand = [];

    playCard(state, player.id, bat.instanceId);

    expect(opponent.hand).toHaveLength(0);
    expect(opponent.discard).toHaveLength(0);
  });
});
