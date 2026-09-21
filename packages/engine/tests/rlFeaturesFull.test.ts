import { describe, expect, it } from 'vitest';
import { createGame, getLegalActions, playCard } from '../src/engine';
import { getCard } from '../src/cards/registry';
import {
  CRITIC_FEATURE_DIM_FULL,
  encodeAction,
  encodeActionsForPlayer,
  encodePlayerContext,
  FEATURE_DIM_FULL,
} from '../src/bots/rl/featuresFull';
import { buildStarterDeck } from './helpers';
import type { CardInstance } from '../src/model/state';

function freshInstance(cardId: string, suffix: string): CardInstance {
  return { ...getCard(cardId), instanceId: `${cardId}#${suffix}` };
}

function setupFull() {
  const state = createGame(
    [
      { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
      { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
    ],
    { edition: 'full' }
  );
  return { state, player: state.players[0], opponent: state.players[1] };
}

describe('rl/featuresFull (edición completa)', () => {
  it('encodePlayerContext siempre mide CRITIC_FEATURE_DIM_FULL, sin NaN/Infinity', () => {
    const { state, player } = setupFull();
    const features = encodePlayerContext(state, player);
    expect(features).toHaveLength(CRITIC_FEATURE_DIM_FULL);
    for (const f of features) expect(Number.isFinite(f)).toBe(true);
  });

  it('encodeAction siempre devuelve FEATURE_DIM_FULL para cada acción legal de una partida completa, sin NaN', () => {
    const { state, player } = setupFull();
    for (const action of getLegalActions(state, player.id)) {
      const features = encodeAction(state, player.id, action);
      expect(features).toHaveLength(FEATURE_DIM_FULL);
      for (const f of features) expect(Number.isFinite(f)).toBe(true);
    }
  });

  it('no genera NaN/Infinity aunque varios mazos compartidos estén agotados (incluidas las especies nuevas)', () => {
    const { state, player } = setupFull();
    for (const deck of Object.values(state.sharedDecks)) deck.length = 0;
    for (const action of getLegalActions(state, player.id)) {
      const features = encodeAction(state, player.id, action);
      for (const f of features) expect(Number.isFinite(f)).toBe(true);
    }
  });

  it('el bloque de la carta ve el coste REAL de comprar un dinosaurio con descuento, no el de catálogo', () => {
    const { state, player } = setupFull();
    const diplodocus = state.animalTrack.find((c) => c.species === 'diplodocus')!;
    const before = encodeAction(state, player.id, { type: 'buyAnimal', trackInstanceId: diplodocus.instanceId });

    // Jugar dinosaurios este turno reduce effectiveMarketCost, y por tanto
    // la feature de coste de la misma acción candidata.
    player.playedThisTurn.push(freshInstance('iguana', 'd1'), freshInstance('iguana', 'd2'));
    const after = encodeAction(state, player.id, { type: 'buyAnimal', trackInstanceId: diplodocus.instanceId });

    // Índice del coste dentro del bloque de carta: contexto(43) + tipo de
    // acción(4) + [PV, COSTE, valor...].
    const costIndex = CRITIC_FEATURE_DIM_FULL + 4 + 1;
    expect(after[costIndex]).toBeLessThan(before[costIndex]);
    expect(after[costIndex]).toBeCloseTo((12 - 2) / 10, 6);
  });

  it('el hábitat "dinosaur" se ve en el bloque de carta (no solo los 3 básicos)', () => {
    const { state, player } = setupFull();
    const ptera = freshInstance('pteranodon', 'x');
    player.hand = [ptera];
    const actions = getLegalActions(state, player.id).filter((a) => a.type === 'playCard' && a.instanceId === ptera.instanceId);
    expect(actions.length).toBeGreaterThan(0);
    const features = encodeActionsForPlayer(state, player.id, actions)[0];
    // Bloque de carta: contexto(43) + tipoAcción(4) + [PV, coste, valor, land, bird, aquatic, pet, dinosaur, ...efectos]
    const habitatBase = CRITIC_FEATURE_DIM_FULL + 4 + 3;
    // land=0, bird=1(Pteranodon es volador), aquatic=0, pet=0, dinosaur=1.
    expect(features[habitatBase + 0]).toBe(0); // land
    expect(features[habitatBase + 1]).toBe(1); // bird
    expect(features[habitatBase + 4]).toBe(1); // dinosaur
  });

  it('Nutria: el objetivo secundario (carta en tu propio mazo) se resuelve, no queda en blanco', () => {
    const { state, player } = setupFull();
    const otter = freshInstance('otter', 'x');
    const silver = freshInstance('coin-2', 'silver');
    player.hand = [otter, silver];
    player.deck = [freshInstance('lion', 'a'), freshInstance('tiger', 'b'), freshInstance('monkey', 'c')];

    const actions = getLegalActions(state, player.id).filter(
      (a) => a.type === 'playCard' && a.instanceId === otter.instanceId && a.secondaryTargetInstanceId
    );
    expect(actions.length).toBeGreaterThan(0);
    const features = encodeActionsForPlayer(state, player.id, actions)[0];

    // Bloque de carta (49) + liveScoreDelta(1) + bloque de objetivo primario(8)
    // = donde empieza el bloque de objetivo SECUNDARIO; su primera columna
    // ("existe") debe ser 1, no 0 (en blanco).
    const secondaryBase = CRITIC_FEATURE_DIM_FULL + 4 + 49 + 1 + 8;
    expect(features[secondaryBase]).toBe(1);
  });

  it('Avestruz: el objetivo secundario (la moneda que costea evolucionar, EN LA MANO) se resuelve, no queda en blanco', () => {
    const { state, player } = setupFull();
    const ostrich = freshInstance('ostrich', 'x');
    const gold = freshInstance('coin-3', 'gold');
    player.hand = [ostrich, gold];

    const actions = getLegalActions(state, player.id).filter(
      (a) => a.type === 'playCard' && a.instanceId === ostrich.instanceId && a.secondaryTargetInstanceId
    );
    expect(actions.length).toBeGreaterThan(0);
    const features = encodeActionsForPlayer(state, player.id, actions)[0];

    const secondaryBase = CRITIC_FEATURE_DIM_FULL + 4 + 49 + 1 + 8;
    // "existe" = 1 (no en blanco): a diferencia de Nutria (carta del propio
    // mazo), aquí la moneda está en la MANO, no en mazo/descarte/mercado, así
    // que ejercita la rama nueva de secondaryTargetCard (sin ella, la red
    // vería este bloque entero en blanco y sería ciega al coste real).
    expect(features[secondaryBase]).toBe(1);
  });

  it('mayStayOnTable (Perro) SÍ está representado en EFFECT_TYPES de la edición completa', () => {
    const { state, player } = setupFull();
    const dog = freshInstance('dog', 'x');
    player.hand = [dog];
    const actions = getLegalActions(state, player.id).filter((a) => a.type === 'playCard' && !a.keepOnTable);
    const features = encodeActionsForPlayer(state, player.id, actions)[0];
    // No debería ser un vector todo-ceros en el bloque de efectos: basta con
    // comprobar que al menos una columna del bloque de carta está encendida
    // más allá de PV/coste/valor/hábitats (índice tras habitatBase+5).
    const effectsStart = CRITIC_FEATURE_DIM_FULL + 4 + 3 + 5;
    const effectsSlice = features.slice(effectsStart, effectsStart + 41);
    expect(effectsSlice.some((v) => v === 1)).toBe(true);
  });

  it('eachOpponentDestroysAnimalFromHand (Tiranosaurio/Terodáctilo/Mosasaurio) SÍ está representado', () => {
    const { state, player } = setupFull();
    const rex = freshInstance('tyrannosaurus', 'x');
    player.hand = [rex];
    const actions = getLegalActions(state, player.id).filter((a) => a.type === 'playCard');
    const features = encodeActionsForPlayer(state, player.id, actions)[0];
    const effectsStart = CRITIC_FEATURE_DIM_FULL + 4 + 3 + 5;
    const effectsSlice = features.slice(effectsStart, effectsStart + 41);
    // gainFlatBonusPurchasingPower Y eachOpponentDestroysAnimalFromHand: al
    // menos 2 columnas encendidas, no solo 1 (si la segunda faltara, esta
    // carta sería indistinguible en ese aspecto de una que solo diera dinero).
    expect(effectsSlice.filter((v) => v === 1)).toHaveLength(2);
  });

  it('jugar un dinosaurio de verdad (playCard) no revienta nada al recalcular acciones legales', () => {
    const { state, player } = setupFull();
    const rex = freshInstance('tyrannosaurus', 'x');
    player.hand = [rex];
    playCard(state, player.id, rex.instanceId);
    for (const action of getLegalActions(state, player.id)) {
      const features = encodeAction(state, player.id, action);
      expect(features).toHaveLength(FEATURE_DIM_FULL);
      for (const f of features) expect(Number.isFinite(f)).toBe(true);
    }
  });
});
