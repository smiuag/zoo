import { describe, expect, it } from 'vitest';
import { createGame, playCard } from '../src/engine';
import { legalActionsForBot } from '../src/bots/actionPriority';
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
  return { state, player: state.players[0] };
}

// Ley de prioridad para TODOS los bots (pedido explícito del usuario,
// 2026-09-16): jugar de la mano siempre antes que comprar, y dentro de
// jugar, una carta que haga robar de alguna manera siempre antes que
// cualquier otra. Ver actionPriority.ts — cada bot y el entrenamiento pasan
// por legalActionsForBot en vez de llamar a getLegalActions directamente.
describe('legalActionsForBot: ley de prioridad para todos los bots', () => {
  it('con una carta de robo en la mano, SOLO ofrece jugarla (nunca comprar ni jugar otra cosa distinta)', () => {
    const { state, player } = setupClean();
    const owl = freshInstance('owl', 'a1'); // Búho: roba 1 carta
    const monkey = freshInstance('monkey', 'a2'); // no es de robo
    player.hand = [owl, monkey];

    const actions = legalActionsForBot(state, player.id);

    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every((a) => a.type === 'playCard' && a.instanceId === owl.instanceId)).toBe(true);
  });

  it('sin ninguna carta de robo pero con otras en mano, ofrece jugar (nunca comprar) aunque el mercado sea pagable', () => {
    const { state, player } = setupClean();
    const monkey = freshInstance('monkey', 'a1');
    player.hand = [monkey];

    const actions = legalActionsForBot(state, player.id);

    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every((a) => a.type === 'playCard')).toBe(true);
  });

  it('con la mano vacía, ofrece comprar/terminar turno con normalidad', () => {
    const { state, player } = setupClean();
    player.hand = [];

    const actions = legalActionsForBot(state, player.id);

    expect(actions.some((a) => a.type === 'playCard')).toBe(false);
    expect(actions.some((a) => a.type === 'buyAnimal' || a.type === 'buyCoin' || a.type === 'endTurn')).toBe(true);
  });

  it('con solo monedas en la mano (nunca se juegan), se comporta como mano vacía: ofrece comprar/terminar turno', () => {
    const { state, player } = setupClean();
    player.hand = [freshInstance('coin-1', 'c1'), freshInstance('coin-3', 'c2')];

    const actions = legalActionsForBot(state, player.id);

    expect(actions.some((a) => a.type === 'playCard')).toBe(false);
    expect(actions.some((a) => a.type === 'buyAnimal' || a.type === 'buyCoin' || a.type === 'endTurn')).toBe(true);
  });

  it('un descarte forzoso pendiente no se ve afectado: se devuelve tal cual, sin intentar aplicar ninguna prioridad', () => {
    const { state, player } = setupClean();
    const opponent = state.players[1];
    const hippo = freshInstance('hippopotamus', 'o1');
    opponent.hand = [hippo];
    const vulture = freshInstance('vulture', 'v1'); // Buitre: descarte forzoso
    player.hand = [vulture];

    // Se juega directamente vía el motor para dejar el descarte pendiente.
    playCard(state, player.id, vulture.instanceId);

    const actions = legalActionsForBot(state, opponent.id);
    expect(actions).toEqual([{ type: 'resolveDiscard', instanceId: hippo.instanceId }]);
  });
});
