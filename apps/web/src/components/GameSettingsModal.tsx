import { getCard, type CardInstance } from '@zoo/engine';
import { CardView } from './CardView';
import { useArtStyle } from '../lib/artStyle';
import { CUSTOM_COPY_DELTA_OPTIONS, CUSTOM_PICKABLE_SPECIES, type CustomCopyDeltas } from '../lib/gameConfig';

// Reducido (uno de los 3 presets del picker, ver abajo): todo marcado salvo
// estas 11 especies clásicas — pedido explícito del usuario 2026-09-21,
// mismos ids verificados contra ANIMAL_SPECIES.
const REDUCED_EXCLUDED_SPECIES = new Set([
  'polar-bear',
  'orca',
  'eagle',
  'albatross',
  'toucan',
  'monkey',
  'seal',
  'raven',
  'rabbit',
  'lion',
  'spider',
]);

// Agrupa por COSTE (en vez de por hábitat, como al principio): con varios
// hábitats a la vez por carta, agrupar por tipo dejaba grupos con el mismo
// tipo repetido varias veces y no aportaba nada que el propio pie de la
// carta no dijera ya — pedido explícito del usuario 2026-09-21, "agrupalas
// por coste en vez de tipo, q los tipos se repiten". Tramos fijos pedidos
// explícitamente por el usuario: "coste 1 y 2, 3, 4, 5, 6 y 7; más de 7".
const COST_BUCKETS: { label: string; test: (cost: number) => boolean }[] = [
  { label: 'Coste 1-2', test: (cost) => cost <= 2 },
  { label: 'Coste 3', test: (cost) => cost === 3 },
  { label: 'Coste 4', test: (cost) => cost === 4 },
  { label: 'Coste 5-7', test: (cost) => cost >= 5 && cost <= 7 },
  { label: 'Coste 8 o más', test: (cost) => cost > 7 },
];

function groupSpeciesByCost(): { label: string; species: string[] }[] {
  return COST_BUCKETS.map(({ label, test }) => ({
    label,
    species: CUSTOM_PICKABLE_SPECIES.filter((id) => test(getCard(id).marketCost ?? 0)).sort(
      (a, b) => (getCard(a).marketCost ?? 0) - (getCard(b).marketCost ?? 0) || getCard(a).name.localeCompare(getCard(b).name)
    ),
  })).filter((group) => group.species.length > 0);
}

function speciesCardInstance(id: string): CardInstance {
  return { ...getCard(id), instanceId: id };
}

// Fisher-Yates local: @zoo/engine no exporta su `shuffle` interno, y no
// merece la pena tocar el paquete solo por esto.
function shuffleCopy<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const RANDOM_PRESET_SIZE = 30;

interface GameSettingsModalProps {
  animationsEnabled: boolean;
  onAnimationsEnabledChange: (value: boolean) => void;
  customSpecies: Set<string>;
  onCustomSpeciesChange: (value: Set<string>) => void;
  customCopyDeltas: CustomCopyDeltas;
  onCustomCopyDeltasChange: (value: CustomCopyDeltas) => void;
  onClose: () => void;
}

// Panel de configuración de la partida: engranaje junto a "Nueva partida"
// (ver GameSetup.tsx) — pedido explícito del usuario 2026-09-21. Absorbe el
// estilo de carta y las animaciones (antes sueltos en el formulario) y el
// editor de la edición "Personalizado" (elegir qué especies entran en el
// mercado y cuántas copias hay de cada tramo de coste) — se elige la
// edición en sí (Aprendizaje/Clásica/Personalizado) en la pantalla
// principal, no aquí; este editor siempre está disponible para dejarlo
// listo de antemano. Componente controlado: todo el estado vive en
// GameSetup, este archivo solo renderiza los controles.
export function GameSettingsModal({
  animationsEnabled,
  onAnimationsEnabledChange,
  customSpecies,
  onCustomSpeciesChange,
  customCopyDeltas,
  onCustomCopyDeltasChange,
  onClose,
}: GameSettingsModalProps) {
  const [artStyle, setArtStyle] = useArtStyle();

  const groupedSpecies = groupSpeciesByCost();

  function toggleSpecies(id: string) {
    const next = new Set(customSpecies);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onCustomSpeciesChange(next);
  }

  function applyRandomPreset() {
    onCustomSpeciesChange(new Set(shuffleCopy(CUSTOM_PICKABLE_SPECIES).slice(0, RANDOM_PRESET_SIZE)));
  }

  function applyCompletePreset() {
    onCustomSpeciesChange(new Set(CUSTOM_PICKABLE_SPECIES));
  }

  function applyReducedPreset() {
    onCustomSpeciesChange(new Set(CUSTOM_PICKABLE_SPECIES.filter((id) => !REDUCED_EXCLUDED_SPECIES.has(id))));
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="panel__header">
          <h2>⚙️ Configuración</h2>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            ✕ cerrar
          </button>
        </div>

        <div className="setup-row">
          <div className="pair-row">
            <div className="pair-row__group">
              <button
                type="button"
                className={`btn ${artStyle === 'imagen' ? 'btn--primary' : 'btn--ghost'}`}
                aria-pressed={artStyle === 'imagen'}
                onClick={() => setArtStyle('imagen')}
              >
                🖼️ Imagen
              </button>
              <button
                type="button"
                className={`btn ${artStyle === 'emoji' ? 'btn--primary' : 'btn--ghost'}`}
                aria-pressed={artStyle === 'emoji'}
                onClick={() => setArtStyle('emoji')}
              >
                🐯 Emoji
              </button>
            </div>
            <div className="pair-row__group">
              <button
                type="button"
                className={`btn ${animationsEnabled ? 'btn--primary' : 'btn--ghost'}`}
                aria-pressed={animationsEnabled}
                onClick={() => onAnimationsEnabledChange(true)}
              >
                Con animaciones
              </button>
              <button
                type="button"
                className={`btn ${!animationsEnabled ? 'btn--primary' : 'btn--ghost'}`}
                aria-pressed={!animationsEnabled}
                onClick={() => onAnimationsEnabledChange(false)}
              >
                Sin animaciones
              </button>
            </div>
          </div>
        </div>

        <div className="settings-modal__section">
          <h3>Personalizado</h3>
          <p className="setup-hint">
            Se usa cuando eliges la edición Personalizado en la pantalla principal: elige qué especies entran en el
            mercado y cuántas copias hay de cada una.
          </p>

          <div className="setup-row">
            <span className="delta-groups__heading">Copias extra respecto al nº de jugadores</span>
            <div className="delta-groups">
              <div className="delta-group">
                <span className="delta-group__label">Coste &lt;5</span>
                <div className="setup-round-options">
                  {CUSTOM_COPY_DELTA_OPTIONS.map((delta) => (
                    <button
                      key={delta}
                      type="button"
                      className={`btn ${customCopyDeltas.cheap === delta ? 'btn--primary' : 'btn--ghost'}`}
                      aria-pressed={customCopyDeltas.cheap === delta}
                      onClick={() => onCustomCopyDeltasChange({ ...customCopyDeltas, cheap: delta })}
                    >
                      {delta > 0 ? `+${delta}` : delta}
                    </button>
                  ))}
                </div>
              </div>
              <div className="delta-group">
                <span className="delta-group__label">Coste ≥5</span>
                <div className="setup-round-options">
                  {CUSTOM_COPY_DELTA_OPTIONS.map((delta) => (
                    <button
                      key={delta}
                      type="button"
                      className={`btn ${customCopyDeltas.expensive === delta ? 'btn--primary' : 'btn--ghost'}`}
                      aria-pressed={customCopyDeltas.expensive === delta}
                      onClick={() => onCustomCopyDeltasChange({ ...customCopyDeltas, expensive: delta })}
                    >
                      {delta > 0 ? `+${delta}` : delta}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="setup-row setup-row--spaced">
            <div className="preset-buttons">
              <button type="button" className="preset-btn" onClick={applyRandomPreset}>
                <span className="preset-btn__icon">🎲</span>
                <span className="preset-btn__label">Random</span>
                <span className="preset-btn__hint">{RANDOM_PRESET_SIZE} especies al azar</span>
              </button>
              <button type="button" className="preset-btn" onClick={applyCompletePreset}>
                <span className="preset-btn__icon">🗂️</span>
                <span className="preset-btn__label">Completo</span>
                <span className="preset-btn__hint">Todas las especies</span>
              </button>
              <button type="button" className="preset-btn" onClick={applyReducedPreset}>
                <span className="preset-btn__icon">✂️</span>
                <span className="preset-btn__label">Reducido</span>
                <span className="preset-btn__hint">Sin las más complicadas</span>
              </button>
            </div>
            <p className="setup-hint">{customSpecies.size} especies marcadas de {CUSTOM_PICKABLE_SPECIES.length}.</p>
          </div>

          <div className="card-picker">
            {groupedSpecies.map(({ label, species }) => (
              <div key={label} className="card-picker__habitat-group">
                <h4>{label}</h4>
                <div className="card-row">
                  {species.map((id) => (
                    <CardView
                      key={id}
                      card={speciesCardInstance(id)}
                      compact
                      selected={customSpecies.has(id)}
                      onClick={() => toggleSpecies(id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
