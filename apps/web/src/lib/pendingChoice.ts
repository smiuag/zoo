import type { Action, CardInstance, GameState, Player } from '@zoo/engine';
import { targetLabel } from './actionQuery';
import { findAnywhere } from './actionLabels';
import { cardAccentClass } from './cardVisuals';
import type { ArtStyle } from './artStyle';

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

// Genérico sobre el TIPO de acción a propósito: sirve igual para jugar una
// carta de la mano de verdad (playCard) que para usar la habilidad de un
// animal ajeno recién descartado vía la Serpiente
// (useDiscardedAnimalAbility, ver GameBoard.tsx) — ambas comparten la misma
// forma de campos de objetivo (target(Instance|Player)Id/
// secondaryTargetInstanceId), y aquí nunca importa cuál de las dos es, solo
// qué objetivo(s) elegir.
export function buildTargetChoice(
  actions: Action[],
  state: GameState,
  player: Player,
  card: CardInstance,
  artStyle: ArtStyle
): PendingChoice {
  const playActions = actions.filter(
    (a): a is Extract<Action, { type: 'playCard' | 'useDiscardedAnimalAbility' }> =>
      a.type === 'playCard' || a.type === 'useDiscardedAnimalAbility'
  );

  const hasKeepOnTableVariant = playActions.some((a) => a.type === 'playCard' && a.keepOnTable);
  const hasRealTargeting = playActions.some((a) => a.targetInstanceId || a.targetPlayerId);

  // Perro/Colibrí: la única elección es dónde acaba la carta al terminar el
  // turno (sobre la mesa o al descarte); no hay ningún otro objetivo que
  // elegir. La Gallina SÍ combina ambas cosas (objetivo real + quedarse en
  // la mesa) — para ella se sigue el flujo normal de abajo, que resuelve esa
  // combinación con leafChoice.
  if (hasKeepOnTableVariant && !hasRealTargeting) {
    const options: ChoiceOption[] = playActions.map((a) => ({
      label: a.type === 'playCard' && a.keepOnTable ? 'Dejarlo sobre la mesa' : 'Enviarlo al descarte',
      action: a,
    }));
    options.sort((a, b) => Number(b.label === 'Dejarlo sobre la mesa') - Number(a.label === 'Dejarlo sobre la mesa'));
    return { title: `${card.name}: ¿dónde lo dejas?`, options };
  }

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
  const bySource = new Map<string, Extract<Action, { type: 'playCard' | 'useDiscardedAnimalAbility' }>[]>();
  for (const a of playActions) {
    const key = a.targetInstanceId ?? '';
    const group = bySource.get(key);
    if (group) group.push(a);
    else bySource.set(key, [a]);
  }

  // Varias copias de la misma especie en mano (2 Leones, 2 Flamencos...)
  // son intercambiables como origen a devolver: una sola opción por
  // especie en el menú, no una por copia física. Única excepción: la
  // PROPIA carta que se está jugando siempre es la representante de su
  // especie si es una de las copias repetidas (2 Flamencos en mano, uno de
  // ellos es este) — así "Flamenco" en el menú siempre significa
  // "devuélvete a ti mismo", nunca a la otra copia. Jugar un segundo
  // Flamenco después reconstruye este menú desde cero con la mano ya
  // actualizada (lo que se devolvió/cogió con el primero), así que ofrece
  // sin más las especies que queden en ese momento.
  const representativeSourceBySpecies = new Map<string, string>();
  for (const sourceId of bySource.keys()) {
    const species = findAnywhere(state, player, sourceId)?.species ?? sourceId;
    if (!representativeSourceBySpecies.has(species) || sourceId === card.instanceId) {
      representativeSourceBySpecies.set(species, sourceId);
    }
  }

  // Avestruz/Cocodrilo (drawOrReturnSelfForSpecies): la opción de "no
  // transformarse" siempre viaja como un targetInstanceId vacío (sourceId
  // ''), que targetLabel no sabe etiquetar (target no encontrado, cae al
  // '?' genérico) — se le da aquí una etiqueta legible a partir del propio
  // efecto de la carta en vez de eso.
  const drawOrReturnEffect = card.effects.find((e) => e.type === 'drawOrReturnSelfForSpecies');
  const drawAmount =
    drawOrReturnEffect && typeof drawOrReturnEffect.params?.drawAmount === 'number' ? drawOrReturnEffect.params.drawAmount : 1;

  const options: ChoiceOption[] = [...representativeSourceBySpecies.values()]
    .sort((a, b) => costOf(state, player, a) - costOf(state, player, b))
    .map((sourceId) => {
      const group = bySource.get(sourceId)!;
      const label =
        sourceId === '' && drawOrReturnEffect
          ? `Robar ${drawAmount} carta${drawAmount === 1 ? '' : 's'} (no transformarla)`
          : targetLabel(state, player, sourceId, artStyle);
      const accentClassName = accentClassFor(state, player, sourceId);
      const hasSecondaryChoice = group.some((a) => a.secondaryTargetInstanceId);
      if (!hasSecondaryChoice) {
        return { label, accentClassName, ...leafChoice(card.name, group) };
      }
      // Gallina (discardCoinToCapture) combina esta segunda elección con la
      // de quedarse en la mesa o no: cada animal del mercado puede tener 1
      // (sin mayStayOnTable) o 2 (con ella) acciones agrupadas aquí — ver
      // leafChoice, que resuelve esa combinación con un tercer menú.
      const bySecondary = new Map<string, PlayOrUseAbilityAction[]>();
      for (const a of group) {
        const key = a.secondaryTargetInstanceId ?? '';
        const existing = bySecondary.get(key);
        if (existing) existing.push(a);
        else bySecondary.set(key, [a]);
      }
      return {
        label: `${label} →`,
        accentClassName,
        next: {
          title: `¿Qué animal coges a cambio de ${label}?`,
          options: [...bySecondary.keys()]
            .sort((x, y) => costOf(state, player, x) - costOf(state, player, y))
            .map((secondaryId) => ({
              label: targetLabel(state, player, secondaryId, artStyle),
              accentClassName: accentClassFor(state, player, secondaryId),
              ...leafChoice(card.name, bySecondary.get(secondaryId)!),
            })),
        },
      };
    });

  return { title: `${card.name}: elige el objetivo`, options };
}

type PlayOrUseAbilityAction = Extract<Action, { type: 'playCard' | 'useDiscardedAnimalAbility' }>;

// Resuelve, para un mismo objetivo (o combinación de objetivos) ya elegido,
// si además hay que decidir dónde acaba la carta (Gallina: mayStayOnTable
// combinado con un objetivo real) — 2 acciones para el mismo objetivo,
// una con keepOnTable y otra sin. Con una sola acción (el caso normal, toda
// carta sin mayStayOnTable) no añade ningún menú extra: comportamiento
// idéntico al de antes de que existiera la Gallina.
function leafChoice(cardName: string, group: PlayOrUseAbilityAction[]): { action?: Action; next?: PendingChoice } {
  if (group.length === 1) return { action: group[0] };
  const tableAction = group.find((a) => a.type === 'playCard' && a.keepOnTable);
  const discardAction = group.find((a) => !(a.type === 'playCard' && a.keepOnTable));
  if (!tableAction || !discardAction) return { action: group[0] };
  return {
    next: {
      title: `${cardName}: ¿dónde lo dejas?`,
      options: [
        { label: 'Dejarlo sobre la mesa', action: tableAction },
        { label: 'Enviarlo al descarte', action: discardAction },
      ],
    },
  };
}
