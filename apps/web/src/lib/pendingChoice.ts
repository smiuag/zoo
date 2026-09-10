import type { Action, CardInstance, GameState, Player } from '@zoo/engine';
import { targetLabel } from './actionQuery';
import { findAnywhere } from './actionLabels';
import { cardAccentClass } from './cardVisuals';

// Menú contextual genérico: un título + opciones. Cada opción o bien
// aplica una acción directamente, o bien (si trae `next`) abre un segundo
// menú contextual encadenado — solo lo necesita el Flamenco: primero elige
// qué animal de su mano devuelve, y esa elección abre un segundo menú para
// elegir qué animal del mercado coge a cambio. `accentClassName` (si el
// objetivo es una carta localizable) es la misma clase de color por tipo
// que usa CardView, para que este menú de solo texto no pierda esa pista
// visual.
export interface ChoiceOption {
  label: string;
  action?: Action;
  next?: PendingChoice;
  accentClassName?: string;
}
export interface PendingChoice {
  title: string;
  options: ChoiceOption[];
}

function accentClassFor(state: GameState, player: Player, targetInstanceId: string): string | undefined {
  const card = findAnywhere(state, player, targetInstanceId);
  return card ? cardAccentClass(card) : undefined;
}

// Coste de mercado del objetivo, para ordenar las opciones de estos menús
// (Elefante/Araña, Flamenco en sus 2 niveles) de más barato a más caro, en
// vez del orden en que las devuelve el motor (alfabético por especie, ver
// animalTrack.sort en engine.ts). 0 para un id vacío o no encontrado, para
// que nunca rompa el orden ni lance.
function costOf(state: GameState, player: Player, targetInstanceId: string): number {
  return findAnywhere(state, player, targetInstanceId)?.marketCost ?? 0;
}

export function buildPlayCardTargetChoice(
  actions: Action[],
  state: GameState,
  player: Player,
  card: CardInstance
): PendingChoice {
  const playActions = actions.filter((a): a is Extract<Action, { type: 'playCard' }> => a.type === 'playCard');

  // Pato: elige un JUGADOR, no una carta. Una opción por rival, sin segundo
  // menú encadenado.
  if (playActions.some((a) => a.targetPlayerId)) {
    const options: ChoiceOption[] = playActions.map((a) => ({
      label: state.players.find((p) => p.id === a.targetPlayerId)?.name ?? '?',
      action: a,
    }));
    return { title: `${card.name}: ¿a qué jugador afecta?`, options };
  }

  // Las variantes con secondaryTargetInstanceId (Flamenco) necesitan un
  // segundo menú: primero se agrupan por targetInstanceId (qué animal
  // propio se devuelve).
  const bySource = new Map<string, Extract<Action, { type: 'playCard' }>[]>();
  for (const a of playActions) {
    const key = a.targetInstanceId ?? '';
    const group = bySource.get(key);
    if (group) group.push(a);
    else bySource.set(key, [a]);
  }

  const options: ChoiceOption[] = [...bySource.entries()]
    .sort(([a], [b]) => costOf(state, player, a) - costOf(state, player, b))
    .map(([sourceId, group]) => {
      const label = targetLabel(state, player, sourceId);
      const accentClassName = accentClassFor(state, player, sourceId);
      const hasSecondaryChoice = group.some((a) => a.secondaryTargetInstanceId);
      if (!hasSecondaryChoice) {
        return { label, action: group[0], accentClassName };
      }
      return {
        label: `${label} →`,
        accentClassName,
        next: {
          title: `¿Qué animal coges a cambio de ${label}?`,
          options: [...group]
            .sort((x, y) => costOf(state, player, x.secondaryTargetInstanceId ?? '') - costOf(state, player, y.secondaryTargetInstanceId ?? ''))
            .map((a) => ({
              label: targetLabel(state, player, a.secondaryTargetInstanceId ?? ''),
              action: a,
              accentClassName: accentClassFor(state, player, a.secondaryTargetInstanceId ?? ''),
            })),
        },
      };
    });

  return { title: `${card.name}: elige el objetivo`, options };
}
