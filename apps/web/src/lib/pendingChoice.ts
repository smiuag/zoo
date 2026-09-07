import type { Action, CardInstance, GameState, Player } from '@zoo/engine';
import { targetLabel } from './actionQuery';

// Menú contextual genérico: un título + opciones. Cada opción o bien
// aplica una acción directamente, o bien (si trae `next`) abre un segundo
// menú contextual encadenado — solo lo necesita el Flamenco: primero elige
// qué animal de su mano devuelve, y esa elección abre un segundo menú para
// elegir qué animal del mercado coge a cambio.
export interface ChoiceOption {
  label: string;
  action?: Action;
  next?: PendingChoice;
}
export interface PendingChoice {
  title: string;
  options: ChoiceOption[];
}

export function buildPlayCardTargetChoice(
  actions: Action[],
  state: GameState,
  player: Player,
  card: CardInstance
): PendingChoice {
  const playActions = actions.filter((a): a is Extract<Action, { type: 'playCard' }> => a.type === 'playCard');

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

  const options: ChoiceOption[] = [...bySource.entries()].map(([sourceId, group]) => {
    const label = targetLabel(state, player, sourceId);
    const hasSecondaryChoice = group.some((a) => a.secondaryTargetInstanceId);
    if (!hasSecondaryChoice) {
      return { label, action: group[0] };
    }
    return {
      label: `${label} →`,
      next: {
        title: `¿Qué animal coges a cambio de ${label}?`,
        options: group.map((a) => ({
          label: targetLabel(state, player, a.secondaryTargetInstanceId ?? ''),
          action: a,
        })),
      },
    };
  });

  return { title: `${card.name}: elige el objetivo`, options };
}
