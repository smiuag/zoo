import { describe, expect, it } from 'vitest';
import { applyAction, createGame, endTurn, FULL_EDITION_EXTRA_SPECIES, getLegalActions, playCard, resolveDiscard } from '../src/engine';
import { getCard } from '../src/cards/registry';
import { scorePlayer } from '../src/scoring';
import { buildStarterDeck } from './helpers';

function freshInstance(cardId: string, suffix: string) {
  return { ...getCard(cardId), instanceId: `${cardId}#${suffix}` };
}

function setupClean(edition: 'classic' | 'full' = 'full') {
  const state = createGame(
    [
      { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
      { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
    ],
    { edition }
  );
  for (const player of state.players) {
    player.deck = [];
    player.hand = [];
    player.discard = [];
  }
  return { state, player: state.players[0], opponent: state.players[1] };
}

describe('tipos nuevos: mascota y dinosaurio', () => {
  it('las cartas llevan el tipo extra junto a su hábitat', () => {
    expect(getCard('dog').habitats).toEqual(['land', 'pet']);
    expect(getCard('cat').habitats).toEqual(['land', 'pet']);
    expect(getCard('goldfish').habitats).toContain('pet');
    expect(getCard('parakeet').habitats).toContain('pet');
    expect(getCard('crocodile').habitats).toEqual(['land', 'aquatic', 'dinosaur']);
    expect(getCard('diplodocus').habitats).toEqual(['land', 'aquatic', 'dinosaur']);
    expect(getCard('tyrannosaurus').habitats).toEqual(['land', 'dinosaur']);
    expect(getCard('pterodactyl').habitats).toEqual(['bird', 'dinosaur']);
    expect(getCard('mosasaurus').habitats).toEqual(['aquatic', 'dinosaur']);
  });

  it('edición clásica (la oficial, por defecto): ni especies nuevas ni tipos extra', () => {
    const state = createGame([
      { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
      { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
    ]);
    expect(state.edition).toBe('classic');
    expect(state.animalTrack).toHaveLength(33);
    for (const species of FULL_EDITION_EXTRA_SPECIES) {
      expect(state.animalTrack.some((c) => c.species === species)).toBe(false);
      expect(state.sharedDecks[species]).toBeUndefined();
    }
    const everyCard = [...state.animalTrack, ...Object.values(state.sharedDecks).flat()];
    expect(everyCard.some((c) => c.habitats.includes('pet') || c.habitats.includes('dinosaur'))).toBe(false);
    expect(state.animalTrack.find((c) => c.id === 'crocodile')?.habitats).toEqual(['land', 'aquatic']);
  });

  it('edición completa: 50 especies y los tipos extra visibles', () => {
    const { state } = setupClean('full');
    expect(state.animalTrack).toHaveLength(50);
    expect(state.animalTrack.find((c) => c.id === 'crocodile')?.habitats).toEqual(['land', 'aquatic', 'dinosaur']);
  });

  it('las especies nuevas tienen hueco en el mercado de la edición completa', () => {
    const { state } = setupClean();
    for (const species of FULL_EDITION_EXTRA_SPECIES) {
      expect(state.animalTrack.some((c) => c.species === species)).toBe(true);
    }
  });
});

describe('perro: puede quedarse sobre la mesa', () => {
  it('ofrece las dos variantes: al descarte o sobre la mesa', () => {
    const { state, player } = setupClean();
    const dog = freshInstance('dog', 'test');
    player.hand = [dog];
    const plays = getLegalActions(state, player.id).filter((a) => a.type === 'playCard');
    expect(plays).toHaveLength(2);
    expect(plays.filter((a) => a.type === 'playCard' && a.keepOnTable)).toHaveLength(1);
  });

  it('jugado normal va al descarte al acabar el turno', () => {
    const { state, player } = setupClean();
    const dog = freshInstance('dog', 'test');
    player.hand = [dog];
    playCard(state, player.id, dog.instanceId);
    endTurn(state, player.id);
    // Sigue circulando (endTurn roba la mano siguiente, así que puede haber vuelto ya del descarte).
    expect([...player.deck, ...player.hand, ...player.discard].map((c) => c.instanceId)).toContain(dog.instanceId);
    expect(player.table).toHaveLength(0);
  });

  it('dejado sobre la mesa no vuelve al descarte, pero sigue puntuando', () => {
    const { state, player } = setupClean();
    const dog = freshInstance('dog', 'test');
    player.hand = [dog];
    applyAction(state, player.id, { type: 'playCard', instanceId: dog.instanceId, keepOnTable: true });
    // Durante el turno sigue contando como jugado este turno.
    expect(player.playedThisTurn.map((c) => c.instanceId)).toContain(dog.instanceId);
    endTurn(state, player.id);
    expect(player.table.map((c) => c.instanceId)).toEqual([dog.instanceId]);
    expect([...player.deck, ...player.hand, ...player.discard].some((c) => c.instanceId === dog.instanceId)).toBe(false);
    // El Perro vale 2PV (bajado de 3, ver dog.json) desde que también da +1
    // de valor de compra al jugarlo (pedido explícito del usuario 2026-09-21).
    expect(scorePlayer(state, player)).toBe(2);
  });

  it('una carta sin esa habilidad no se puede dejar sobre la mesa', () => {
    const { state, player } = setupClean();
    const lion = freshInstance('lion', 'test');
    player.hand = [lion];
    expect(() => playCard(state, player.id, lion.instanceId, undefined, undefined, undefined, true)).toThrow();
  });
});

describe('dinosaurios: cada oponente elimina un animal de su mano', () => {
  it('tiranosaurio: +4 de valor de captura y elimina un terrestre de cada OPONENTE, nunca de quien lo juega', () => {
    const { state, player, opponent } = setupClean();
    const rex = freshInstance('tyrannosaurus', 'test');
    const ownLion = freshInstance('lion', 'own');
    const oppMonkey = freshInstance('monkey', 'opp');
    player.hand = [rex, ownLion];
    opponent.hand = [oppMonkey, freshInstance('coin-1', 'opp')];

    playCard(state, player.id, rex.instanceId);

    expect(player.bonusPurchasingPowerThisTurn).toBe(4);
    // El oponente solo tenía un terrestre elegible: se resuelve solo.
    expect(state.pendingDecision).toBeNull();
    expect(player.hand.map((c) => c.instanceId)).toEqual([ownLion.instanceId]);
    expect(opponent.hand.some((c) => c.instanceId === oppMonkey.instanceId)).toBe(false);
    expect(opponent.discard).toHaveLength(0);
    expect(player.destroyedCards.map((c) => c.instanceId)).toEqual([oppMonkey.instanceId]);
  });

  it('con varios elegibles, el afectado elige cuál elimina', () => {
    const { state, player, opponent } = setupClean();
    const ptero = freshInstance('pterodactyl', 'test');
    const owl = freshInstance('owl', 'opp');
    const eagle = freshInstance('eagle', 'opp');
    player.hand = [ptero];
    opponent.hand = [owl, eagle, freshInstance('lion', 'opp')];

    playCard(state, player.id, ptero.instanceId);

    expect(state.pendingDecision?.kind).toBe('destroy');
    const options = getLegalActions(state, opponent.id);
    expect(options.map((a) => (a.type === 'resolveDiscard' ? a.instanceId : '')).sort()).toEqual(
      [owl.instanceId, eagle.instanceId].sort()
    );
    resolveDiscard(state, opponent.id, owl.instanceId);
    expect(state.pendingDecision).toBeNull();
    expect(opponent.hand.map((c) => c.instanceId)).toContain(eagle.instanceId);
  });

  it('quien no tiene ningún animal de ese tipo no pierde nada', () => {
    const { state, player, opponent } = setupClean();
    const mosa = freshInstance('mosasaurus', 'test');
    player.hand = [mosa, freshInstance('seal', 'own')];
    opponent.hand = [freshInstance('owl', 'opp')];
    playCard(state, player.id, mosa.instanceId);
    expect(state.pendingDecision).toBeNull();
    // Ni el rival (sin acuáticos) ni quien lo juega (su Foca no se toca) pierden nada.
    expect(player.hand).toHaveLength(1);
    expect(player.destroyedCards).toHaveLength(0);
    expect(opponent.hand).toHaveLength(1);
  });
});

describe('gato: se descarta en vez de eliminar un terrestre', () => {
  it('entregar el Gato lo manda al descarte y salva al otro terrestre', () => {
    const { state, player, opponent } = setupClean();
    const rex = freshInstance('tyrannosaurus', 'test');
    const cat = freshInstance('cat', 'opp');
    const lion = freshInstance('lion', 'opp');
    player.hand = [rex];
    opponent.hand = [cat, lion];

    playCard(state, player.id, rex.instanceId);
    expect(state.pendingDecision).not.toBeNull();
    resolveDiscard(state, opponent.id, cat.instanceId);

    expect(state.pendingDecision).toBeNull();
    expect(opponent.discard.map((c) => c.instanceId)).toEqual([cat.instanceId]);
    expect(opponent.hand.map((c) => c.instanceId)).toEqual([lion.instanceId]);
    expect(player.destroyedCards).toHaveLength(0);
  });

  it('el Gato solo, sin otro terrestre, también se salva: va al descarte', () => {
    const { state, player, opponent } = setupClean();
    const rex = freshInstance('tyrannosaurus', 'test');
    const cat = freshInstance('cat', 'opp');
    player.hand = [rex];
    opponent.hand = [cat];
    playCard(state, player.id, rex.instanceId);
    expect(opponent.discard.map((c) => c.instanceId)).toEqual([cat.instanceId]);
    expect(player.destroyedCards).toHaveLength(0);
  });

  it('no protege de eliminar un volador o un acuático', () => {
    const { state, player, opponent } = setupClean();
    const mosa = freshInstance('mosasaurus', 'test');
    const seal = freshInstance('seal', 'opp');
    player.hand = [mosa];
    opponent.hand = [freshInstance('cat', 'opp'), seal];
    playCard(state, player.id, mosa.instanceId);
    expect(player.destroyedCards.map((c) => c.instanceId)).toEqual([seal.instanceId]);
    expect(opponent.hand.map((c) => c.id)).toEqual(['cat']);
  });
});
