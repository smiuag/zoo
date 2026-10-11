import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAllCards, type Card, type CardInstance, type GameEdition } from '@zoo/engine';
import { CardView } from './CardView';
import { useActiveEdition } from '../lib/activeEdition';
import { habitatLabel } from '../lib/cardVisuals';
import { useT } from '../lib/i18n';

// 'classic'/'learning' juegan con el mismo mazo de 33 especies + Perezoso
// (ver game_editions_classic_vs_full); 'full'/'custom' pueden incluir
// además mascotas/dinosaurios exclusivos de la completa (custom elige
// especies concretas, pero mostrar el superconjunto completo con filtros ya
// cubre "quiero ver qué cartas hay" sin tener que leer state.customSpecies).
function showsFullEditionCards(edition: GameEdition | undefined): boolean {
  return edition === 'full' || edition === 'custom';
}

const HABITAT_ORDER = ['land', 'bird', 'aquatic', 'pet', 'dinosaur'] as const;
type HabitatFilter = (typeof HABITAT_ORDER)[number];

const HABITAT_ICON: Record<HabitatFilter, string> = {
  land: '🌳',
  bird: '🪶',
  aquatic: '🌊',
  pet: '🏠',
  dinosaur: '🦴',
};

function habitatFilterLabel(h: HabitatFilter): string {
  // habitatLabel espera una carta completa; basta una mínima con ese único
  // hábitat para reutilizar el mismo texto que ya usan las cartas del juego
  // (Terrestre/Volador/Acuático/Mascota/Dinosaurio), sin duplicar la lista.
  return habitatLabel({ habitats: [h] } as CardInstance);
}

function toCardInstance(card: Card, showFullExtras: boolean): CardInstance {
  const habitats = showFullExtras ? card.habitats : card.habitats.filter((h) => h === 'land' || h === 'bird' || h === 'aquatic');
  const text = showFullExtras ? (card.fullEditionText ?? card.text) : card.text;
  return { ...card, habitats, text, instanceId: card.id };
}

// Selección única por grupo (pedido explícito del usuario): pinchar en
// Volador despincha Acuático/Terrestre si estaba activo, y pinchar en un
// coste despincha cualquier otro coste — dentro de un mismo grupo NO se
// acumulan. Los dos grupos SÍ se combinan entre sí (coste Y hábitat a la
// vez), por eso son dos estados independientes en vez de un único Set.
function toggleSingle<T>(current: T | null, value: T): T | null {
  return current === value ? null : value;
}

export function CardEncyclopedia() {
  const { t, lang, cardName } = useT();
  const navigate = useNavigate();
  const activeGameEdition = useActiveEdition();
  const [manualEdition, setManualEdition] = useState<'classic' | 'full'>('classic');
  const showFullExtras = activeGameEdition !== undefined ? showsFullEditionCards(activeGameEdition) : manualEdition === 'full';

  const [costFilter, setCostFilter] = useState<number | null>(null);
  const [habitatFilter, setHabitatFilter] = useState<HabitatFilter | null>(null);

  const allCards = useMemo(() => getAllCards().filter((c) => c.type === 'animal'), []);
  const cards = useMemo(() => {
    const visible = allCards.filter((c) => showFullExtras || c.edition !== 'full');
    return visible
      .map((c) => toCardInstance(c, showFullExtras))
      .sort((a, b) => (a.marketCost ?? 0) - (b.marketCost ?? 0) || cardName(a).localeCompare(cardName(b), lang === 'en' ? 'en' : 'es'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allCards, showFullExtras, lang]);

  const availableCosts = useMemo(() => [...new Set(cards.map((c) => c.marketCost ?? 0))].sort((a, b) => a - b), [cards]);
  const availableHabitats = useMemo(
    () => HABITAT_ORDER.filter((h) => cards.some((c) => (c.habitats as string[]).includes(h))),
    [cards]
  );

  const filtered = cards.filter((c) => {
    if (costFilter !== null && (c.marketCost ?? 0) !== costFilter) return false;
    if (habitatFilter !== null && !(c.habitats as string[]).includes(habitatFilter)) return false;
    return true;
  });

  return (
    <div className={`encyclopedia${showFullExtras ? ' encyclopedia--full' : ''}`}>
      <div className="encyclopedia__header">
        <h1>📖 {t('Enciclopedia de cartas')}</h1>
        <button className="btn btn--ghost" type="button" onClick={() => navigate(-1)}>
          ✕ {t('Cerrar')}
        </button>
      </div>

      {activeGameEdition === undefined ? (
        <div className="encyclopedia__edition-toggle" role="tablist" aria-label={t('Edición a mostrar')}>
          <button
            type="button"
            className={`btn btn--pill${manualEdition === 'classic' ? ' btn--pill-active' : ''}`}
            onClick={() => setManualEdition('classic')}
          >
            {t('Clásica')}
          </button>
          <button
            type="button"
            className={`btn btn--pill${manualEdition === 'full' ? ' btn--pill-active' : ''}`}
            onClick={() => setManualEdition('full')}
          >
            {t('Completa')}
          </button>
        </div>
      ) : (
        <div className="encyclopedia__edition-note">
          {t('Cartas de tu partida en curso ({edition})', {
            edition: showFullExtras ? t('edición completa') : t('edición clásica'),
          })}
        </div>
      )}

      <div className="encyclopedia__filters">
        <div className="encyclopedia__filter-group">
          <span className="encyclopedia__filter-label">{t('Coste:')}</span>
          {availableCosts.map((cost) => (
            <button
              key={cost}
              type="button"
              className={`btn btn--pill${costFilter === cost ? ' btn--pill-active' : ''}`}
              onClick={() => setCostFilter(toggleSingle(costFilter, cost))}
            >
              {cost === 0 ? t('Gratis') : cost}
            </button>
          ))}
          {costFilter !== null && (
            <button type="button" className="btn btn--ghost btn--pill" onClick={() => setCostFilter(null)}>
              {t('Quitar filtro')}
            </button>
          )}
        </div>
        <div className="encyclopedia__filter-group">
          <span className="encyclopedia__filter-label">{t('Hábitat:')}</span>
          {availableHabitats.map((h) => (
            <button
              key={h}
              type="button"
              className={`btn btn--pill${habitatFilter === h ? ' btn--pill-active' : ''}`}
              onClick={() => setHabitatFilter(toggleSingle(habitatFilter, h))}
            >
              {HABITAT_ICON[h]} {t(habitatFilterLabel(h))}
            </button>
          ))}
          {habitatFilter !== null && (
            <button type="button" className="btn btn--ghost btn--pill" onClick={() => setHabitatFilter(null)}>
              {t('Quitar filtro')}
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="encyclopedia__empty">{t('Ninguna carta cumple los filtros elegidos.')}</p>
      ) : (
        <div className="encyclopedia__grid">
          {filtered.map((card) => (
            <div className="encyclopedia__card-slot" key={card.instanceId}>
              <CardView card={card} showAbilityInline />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
