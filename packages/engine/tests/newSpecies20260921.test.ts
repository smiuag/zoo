import { describe, expect, it } from 'vitest';
import { buyAnimal, canAffordMarket, createGame, effectiveMarketCost, playCard } from '../src/engine';
import { getCard } from '../src/cards/registry';
import { drawCards, type CardInstance } from '../src/model/state';
import { scorePlayer } from '../src/scoring';
import { buildStarterDeck } from './helpers';

function freshInstance(cardId: string, suffix: string): CardInstance {
  return { ...getCard(cardId), instanceId: `${cardId}#${suffix}` };
}

function setupClean() {
  const state = createGame(
    [
      { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
      { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
    ],
    { edition: 'full' }
  );
  for (const player of state.players) {
    player.deck = [];
    player.hand = [];
    player.discard = [];
  }
  return { state, player: state.players[0], opponent: state.players[1] };
}

describe('coste dinámico por dinosaurios jugados este turno', () => {
  it('el Diplodocus cuesta 1 menos por cada dinosaurio ya jugado este turno, sin bajar de 0', () => {
    const { state, player } = setupClean();
    const diplodocus = state.animalTrack.find((c) => c.species === 'diplodocus')!;
    expect(effectiveMarketCost(player, diplodocus)).toBe(12);

    player.playedThisTurn.push(freshInstance('iguana', 'd1')); // dinosaurio (land/aquatic/pet/dinosaur)
    expect(effectiveMarketCost(player, diplodocus)).toBe(11);

    for (let i = 0; i < 20; i++) player.playedThisTurn.push(freshInstance('iguana', `bulk${i}`));
    expect(effectiveMarketCost(player, diplodocus)).toBe(0);
  });

  it('un dinosaurio mantenido en la mesa de turnos anteriores también cuenta para el descuento', () => {
    const { state, player } = setupClean();
    const diplodocus = state.animalTrack.find((c) => c.species === 'diplodocus')!;
    // Colibrí en player.table (mayStayOnTable, jugado un turno anterior, ya
    // no está en playedThisTurn): sigue siendo dinosaurio y debe contar.
    player.table.push(freshInstance('hummingbird', 'kept'));
    expect(effectiveMarketCost(player, diplodocus)).toBe(11); // 12 - 1

    player.playedThisTurn.push(freshInstance('iguana', 'd1'));
    expect(effectiveMarketCost(player, diplodocus)).toBe(10); // 12 - 1(mesa) - 1(jugado este turno)
  });

  it('comprarlo de verdad paga el coste reducido, no el de catálogo', () => {
    const { state, player } = setupClean();
    for (let i = 0; i < 2; i++) player.playedThisTurn.push(freshInstance('turtle', `t${i}`)); // turtle también es dinosaurio
    player.hand.push(freshInstance('coin-5', 'pay1'), freshInstance('coin-5', 'pay2'));
    const diplodocus = state.animalTrack.find((c) => c.species === 'diplodocus')!;
    buyAnimal(state, player.id, diplodocus.instanceId);
    // 12 - 2*1 = 10, pagado con 2 Platino (10): no debería sobrar cambio.
    expect(player.bonusPurchasingPowerThisTurn).toBe(0);
    expect(player.discard.some((c) => c.species === 'diplodocus')).toBe(true);
  });
});

describe('Oca: +1 bellota al jugarla, +1PV por especie doméstica distinta al final', () => {
  it('al jugarla da +1 de valor de compra genérico', () => {
    const { state, player } = setupClean();
    const goose = freshInstance('goose', 'x');
    player.hand = [goose];
    playCard(state, player.id, goose.instanceId);
    expect(player.bonusPurchasingPowerThisTurn).toBe(1);
  });

  it('puntúa 1PV por cada ESPECIE doméstica distinta, no por copia', () => {
    const { state, player } = setupClean();
    player.deck = [
      freshInstance('goose', 'g'), // 0PV base, pero doméstica cuenta a su propio favor
      freshInstance('dog', 'd1'), // 2PV
      freshInstance('dog', 'd2'), // 2ª copia del Perro: PV base cuenta igual, pero no suma otra especie
      freshInstance('cat', 'c'), // 2PV
      freshInstance('lion', 'l'), // 4PV, no doméstico: no cuenta para la Oca
    ];
    // PV base: 0(oca) + 2+2(perro x2) + 2(gato) + 4(león) = 10.
    // Bonus Oca: especies domésticas distintas = Oca, Perro, Gato = 3.
    expect(scorePlayer(state, player)).toBe(10 + 3);
  });
});

describe('Diplodocus: +5 de valor de compra solo para dinosaurios', () => {
  it('al jugarlo, da +5 restringido a dinosaurios (no al genérico)', () => {
    const { state, player } = setupClean();
    const diplodocus = freshInstance('diplodocus', 'x');
    player.hand = [diplodocus];
    playCard(state, player.id, diplodocus.instanceId);
    expect(player.dinosaurBonusPurchasingPowerThisTurn).toBe(5);
    expect(player.bonusPurchasingPowerThisTurn).toBe(0);
  });

  it('paga un dinosaurio sin monedas físicas, pero no sirve para un animal no-dinosaurio ni una moneda', () => {
    const { state, player } = setupClean();
    const diplodocus = freshInstance('diplodocus', 'x');
    player.hand = [diplodocus];
    playCard(state, player.id, diplodocus.instanceId);

    const dinoTarget = state.animalTrack.find((c) => c.habitats.includes('dinosaur') && (c.marketCost ?? 0) <= 5)!;
    expect(canAffordMarket(player, dinoTarget.marketCost ?? 0, dinoTarget.habitats as string[])).toBe(true);
    buyAnimal(state, player.id, dinoTarget.instanceId);
    expect(player.discard.some((c) => c.instanceId === dinoTarget.instanceId)).toBe(true);
    expect(player.dinosaurBonusPurchasingPowerThisTurn).toBe(5 - (dinoTarget.marketCost ?? 0));

    const nonDino = state.animalTrack.find((c) => !c.habitats.includes('dinosaur') && (c.marketCost ?? 0) <= 3)!;
    expect(canAffordMarket(player, nonDino.marketCost ?? 0, nonDino.habitats as string[])).toBe(false);
    expect(canAffordMarket(player, getCard('coin-2').marketCost ?? 0)).toBe(false);
  });
});

describe('Perro/Gallina: se quedan en la mesa hasta que barajes', () => {
  it('vuelve a circular (al descarte) en cuanto el mazo del jugador se repone barajando', () => {
    const { state, player } = setupClean();
    const dog = freshInstance('dog', 'x');
    player.hand = [dog];
    playCard(state, player.id, dog.instanceId, undefined, undefined, undefined, true);
    // Simula fin de turno manual (sin pasar por endTurn, para no robar mano nueva todavía).
    player.table = [...player.playedThisTurn.filter((c) => (player.stayingOnTableIds ?? []).includes(c.instanceId))];
    player.discard = [];
    player.deck = [freshInstance('coin-1', 'z')];
    player.playedThisTurn = [];
    player.stayingOnTableIds = [];

    expect(player.table.map((c) => c.instanceId)).toEqual([dog.instanceId]);

    // Vacía el mazo real y fuerza un reshuffle robando de más.
    player.hand = [];
    player.deck = [];
    player.discard = [freshInstance('coin-1', 'onlyDiscard')];
    // drawCards reshufflea discard(+table) -> deck en cuanto el deck se queda vacío.
    drawCards(player, 1);
    expect(player.table).toHaveLength(0);
    expect([...player.hand, ...player.deck].some((c) => c.instanceId === dog.instanceId)).toBe(true);
  });
});

describe('Hámster: devuelve todas las copias de su descarte a la vez', () => {
  it('recupera de golpe varios hámsteres del descarte, no solo uno', () => {
    const { state, player } = setupClean();
    player.discard = [freshInstance('hamster', 'a'), freshInstance('hamster', 'b'), freshInstance('lion', 'c')];
    const playedHamster = freshInstance('hamster', 'played');
    player.hand = [playedHamster];
    playCard(state, player.id, playedHamster.instanceId);
    expect(player.hand.map((c) => c.instanceId).sort()).toEqual(['hamster#a', 'hamster#b'].sort());
    expect(player.discard.map((c) => c.id)).toEqual(['lion']);
    expect(player.bonusPurchasingPowerThisTurn).toBe(1);
  });
});

describe('Cerdo: descarta una moneda de valor 2+ para robar una carta', () => {
  it('sin ninguna moneda que llegue a 2, no hace nada', () => {
    const { state, player } = setupClean();
    const pig = freshInstance('pig', 'x');
    player.hand = [pig, freshInstance('coin-1', 'small')];
    player.deck = [freshInstance('coin-1', 'top')];
    playCard(state, player.id, pig.instanceId);
    expect(player.hand.map((c) => c.instanceId)).toEqual(['coin-1#small']);
    expect(player.deck).toHaveLength(1);
  });

  it('con una moneda de valor 2+, la descarta y roba', () => {
    const { state, player } = setupClean();
    const pig = freshInstance('pig', 'x');
    const silver = freshInstance('coin-2', 'silver');
    player.hand = [pig, silver];
    player.deck = [freshInstance('coin-1', 'top')];
    playCard(state, player.id, pig.instanceId, silver.instanceId);
    expect(player.hand.map((c) => c.id)).toEqual(['coin-1']);
    expect(player.discard.some((c) => c.instanceId === silver.instanceId)).toBe(true);
  });
});

describe('Nutria: descarta moneda 2+ para mirar 3 y quedarte 1', () => {
  it('descarta la moneda, roba 3 y descarta las 2 que no elige', () => {
    const { state, player } = setupClean();
    const otter = freshInstance('otter', 'x');
    const silver = freshInstance('coin-2', 'silver');
    player.hand = [otter, silver];
    const top3 = [freshInstance('lion', 'a'), freshInstance('tiger', 'b'), freshInstance('monkey', 'c')];
    player.deck = [...top3]; // el final del array es la cima
    playCard(state, player.id, otter.instanceId, silver.instanceId, 'tiger#b');
    expect(player.hand.map((c) => c.instanceId)).toEqual(['tiger#b']);
    expect(player.discard.map((c) => c.instanceId).sort()).toEqual(['coin-2#silver', 'lion#a', 'monkey#c'].sort());
    expect(player.deck).toHaveLength(0);
  });
});

describe('Gallina: descarta una moneda para capturar gratis de la reserva', () => {
  it('descarta la moneda y captura el animal barato elegido', () => {
    const { state, player } = setupClean();
    const chicken = freshInstance('chicken', 'x');
    const coin = freshInstance('coin-1', 'pay');
    player.hand = [chicken, coin];
    const cheapLand = state.animalTrack.find((c) => (c.marketCost ?? 0) <= 2 && c.habitats.includes('land'))!;
    playCard(state, player.id, chicken.instanceId, coin.instanceId, cheapLand.instanceId);
    expect(player.discard.some((c) => c.instanceId === coin.instanceId)).toBe(true);
    expect(player.discard.some((c) => c.instanceId === cheapLand.instanceId)).toBe(true);
    expect(state.animalTrack.some((c) => c.instanceId === cheapLand.instanceId)).toBe(false);
  });
});

describe('Pez Dorado: cambia una moneda por una bellota dorada (Oro)', () => {
  it('descarta la moneda entregada y añade un coin-3 a la mano', () => {
    const { state, player } = setupClean();
    const goldenFish = freshInstance('golden-fish', 'x');
    const bronze = freshInstance('coin-1', 'bronze');
    player.hand = [goldenFish, bronze];
    playCard(state, player.id, goldenFish.instanceId, bronze.instanceId);
    expect(player.hand.some((c) => c.instanceId === bronze.instanceId)).toBe(false);
    expect(player.hand.some((c) => c.id === 'coin-3')).toBe(true);
  });
});

describe('Pterodáctilo: captura un dinosaurio de coste inferior a 8 al jugarlo', () => {
  it('elige un dinosaurio válido del mercado', () => {
    const { state, player } = setupClean();
    const ptero = freshInstance('pterodactyl', 'x');
    player.hand = [ptero];
    const target = state.animalTrack.find((c) => c.habitats.includes('dinosaur') && (c.marketCost ?? 0) <= 7)!;
    playCard(state, player.id, ptero.instanceId, target.instanceId);
    expect(player.discard.some((c) => c.instanceId === target.instanceId)).toBe(true);
  });
});

describe('Avestruz: elige robar o evolucionar a Tiranosaurio/Pterodáctilo', () => {
  it('sin elegir objetivo, simplemente roba', () => {
    const { state, player } = setupClean();
    const ostrich = freshInstance('ostrich', 'x');
    player.hand = [ostrich];
    player.deck = [freshInstance('coin-1', 'top')];
    playCard(state, player.id, ostrich.instanceId);
    expect(player.hand.map((c) => c.id)).toEqual(['coin-1']);
    // La Avestruz jugada sin evolucionar sigue circulando con normalidad
    // (todavía en el "limbo" de playedThisTurn hasta que acabe el turno).
    expect(player.playedThisTurn.some((c) => c.id === 'ostrich')).toBe(true);
  });

  it('eligiendo evolucionar, descarta el Oro, se devuelve a sí misma y captura el dinosaurio elegido', () => {
    const { state, player } = setupClean();
    const ostrich = freshInstance('ostrich', 'x');
    const gold = freshInstance('coin-3', 'gold');
    player.hand = [ostrich, gold];
    const rex = state.animalTrack.find((c) => c.species === 'tyrannosaurus')!;
    playCard(state, player.id, ostrich.instanceId, rex.instanceId, gold.instanceId);
    expect(player.discard.some((c) => c.instanceId === rex.instanceId)).toBe(true);
    expect(player.discard.some((c) => c.instanceId === gold.instanceId)).toBe(true);
    expect(player.hand.some((c) => c.instanceId === gold.instanceId)).toBe(false);
    // La Avestruz NO queda en el descarte del jugador: volvió a su mazo
    // compartido (comprable de inmediato para cualquiera, quizás ella misma).
    expect(player.discard.some((c) => c.id === 'ostrich')).toBe(false);
    expect([...player.hand, ...player.discard, ...player.deck].some((c) => c.id === 'ostrich')).toBe(false);
    expect(state.animalTrack.some((c) => c.species === 'tyrannosaurus')).toBe(true); // hueco repuesto
  });

  it('sin ninguna moneda de Oro (o mejor) en la mano, no puede evolucionar: cae a robar', () => {
    const { state, player } = setupClean();
    const ostrich = freshInstance('ostrich', 'x');
    const silver = freshInstance('coin-2', 'silver');
    player.hand = [ostrich, silver];
    player.deck = [freshInstance('coin-1', 'top')];
    const rex = state.animalTrack.find((c) => c.species === 'tyrannosaurus')!;
    playCard(state, player.id, ostrich.instanceId, rex.instanceId, silver.instanceId);
    expect(player.discard.some((c) => c.instanceId === rex.instanceId)).toBe(false);
    expect(player.hand.some((c) => c.instanceId === silver.instanceId)).toBe(true);
    expect(player.hand.map((c) => c.id)).toContain('coin-1');
  });
});

describe('Cocodrilo: misma elección, pero solo hacia Mosasaurio', () => {
  it('edición completa: descartando un Oro puede evolucionar a Mosasaurio y usa el texto alternativo', () => {
    const { state, player } = setupClean();
    expect(getCard('crocodile').fullEditionText).toContain('Mosasaurio');
    const croc = freshInstance('crocodile', 'x');
    const gold = freshInstance('coin-3', 'gold');
    player.hand = [croc, gold];
    const mosa = state.animalTrack.find((c) => c.species === 'mosasaurus')!;
    playCard(state, player.id, croc.instanceId, mosa.instanceId, gold.instanceId);
    expect(player.discard.some((c) => c.instanceId === mosa.instanceId)).toBe(true);
    expect(player.discard.some((c) => c.instanceId === gold.instanceId)).toBe(true);
    expect(player.discard.some((c) => c.id === 'crocodile')).toBe(false);
  });

  it('edición clásica: sin Mosasaurio en la partida, jugarlo se comporta exactamente igual que antes (solo roba)', () => {
    const state = createGame(
      [
        { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
        { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
      ],
      { edition: 'classic' }
    );
    const player = state.players[0];
    // Una carta minteada de verdad en clásica muestra el texto de siempre,
    // nunca el de la edición completa (ver mintInstance en model/state.ts).
    const mintedCroc = state.animalTrack.find((c) => c.id === 'crocodile')!;
    expect(mintedCroc.text).toBe(
      'Roba 1 carta.\nAl final de la partida, antes de la puntuación, elimina de tu colección una carta de animal no volador.'
    );

    player.hand = [];
    player.discard = [];
    const croc = freshInstance('crocodile', 'x');
    player.hand = [croc];
    player.deck = [freshInstance('coin-1', 'top')];
    // Sin ninguna acción de mercado que ofrezca un Mosasaurio (no existe en
    // clásica): jugarlo se resuelve exactamente como el drawCards de antes.
    expect(state.sharedDecks['mosasaurus']).toBeUndefined();
    playCard(state, player.id, croc.instanceId);
    expect(player.hand.map((c) => c.id)).toEqual(['coin-1']);
    expect(player.playedThisTurn.some((c) => c.id === 'crocodile')).toBe(true);
  });
});
