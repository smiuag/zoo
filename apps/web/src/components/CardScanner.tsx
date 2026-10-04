import { useRef, useState } from 'react';
import { scanPhoto } from '../lib/cardScan';
import { SCAN_CARDS, scoreFromCounts, type ScanCounts, type ScanScore } from '../lib/scanScoring';

interface CardScannerProps {
  playerName: string;
  onApply: (score: ScanScore) => void;
  onCancel: () => void;
}

const FORMULAS: { key: keyof ScanScore['factors']; label: string; icon: string }[] = [
  { key: 'eagle', label: 'Águila × voladores', icon: '🦅' },
  { key: 'panda', label: 'Oso panda × terrestres', icon: '🐼' },
  { key: 'orca', label: 'Orca × acuáticos', icon: '🐋' },
  { key: 'albatross', label: 'Albatros × especies', icon: '🕊️' },
  { key: 'toucan', label: 'Tucán × coste 5+', icon: '🦜' },
  { key: 'shark', label: 'Tiburón × bellotas', icon: '🦈' },
];

// Escanea una foto de las cartas de un jugador (escalonadas, con el nombre de
// cada una a la vista) y enseña el recuento por carta y la puntuación
// resultante, con las cantidades editables antes de volcarlas a la
// calculadora. Todo el reconocimiento ocurre en el dispositivo.
export function CardScanner({ playerName, onApply, onCancel }: CardScannerProps) {
  const [status, setStatus] = useState<'idle' | 'scanning' | 'review' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [counts, setCounts] = useState<ScanCounts>({});
  const [addId, setAddId] = useState('');
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setStatus('scanning');
    setProgress(0);
    try {
      setCounts(await scanPhoto(file, setProgress));
      setStatus('review');
    } catch (err) {
      console.error(err);
      setStatus('error');
    }
  }

  function change(id: string, delta: number) {
    setCounts((prev) => ({ ...prev, [id]: Math.max(0, (prev[id] ?? 0) + delta) }));
  }

  const score = scoreFromCounts(counts);
  const detected = SCAN_CARDS.filter((c) => (counts[c.id] ?? 0) > 0);
  const totalCards = detected.reduce((sum, c) => sum + (counts[c.id] ?? 0), 0);
  const addable = SCAN_CARDS.filter((c) => (counts[c.id] ?? 0) === 0);

  const pickers = (
    <>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </>
  );

  return (
    <div className="scan-panel">
      {pickers}
      <div className="scan-panel__header">
        <h3>📷 Escanear cartas de {playerName || 'este jugador'}</h3>
        <button className="icon-btn" type="button" aria-label="Cerrar escáner" onClick={onCancel}>
          ✕
        </button>
      </div>

      {(status === 'idle' || status === 'error') && (
        <>
          <p className="scan-hint">
            Coloca las cartas <strong>escalonadas</strong>, de modo que se vea el <strong>nombre</strong> (el tablón de
            madera) de todas. Pueden ir en varias filas o columnas, una especie junta. Haz la foto de frente, con buena luz
            y sin reflejos.
          </p>
          {status === 'error' && (
            <p className="scan-hint scan-hint--error">No se pudo leer la foto (¿sin conexión la primera vez?). Prueba otra vez.</p>
          )}
          <div className="scan-actions">
            <button className="btn btn--primary" type="button" onClick={() => cameraRef.current?.click()}>
              📷 Hacer foto
            </button>
            <button className="btn" type="button" onClick={() => galleryRef.current?.click()}>
              🖼️ Elegir imagen
            </button>
          </div>
          <p className="scan-hint scan-hint--small">
            La foto no sale del móvil. La primera vez se descarga el diccionario de lectura (unos MB); después va más
            rápido.
          </p>
        </>
      )}

      {status === 'scanning' && (
        <div className="scan-progress" role="status">
          <div className="scan-progress__bar">
            <div className="scan-progress__fill" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <span>Leyendo las cartas… {Math.round(progress * 100)}%</span>
        </div>
      )}

      {status === 'review' && (
        <>
          <p className="scan-hint">
            Detectadas <strong>{totalCards}</strong> cartas. Revisa el recuento y corrige lo que haga falta: la puntuación se
            recalcula al momento.
          </p>

          <div className="scan-list">
            {detected.length === 0 && <p className="scan-hint">No se ha detectado ninguna carta. Añádelas a mano o repite la foto.</p>}
            {detected.map((c) => (
              <div key={c.id} className="scan-item">
                <span className="scan-item__name">{c.name}</span>
                <span className="scan-stepper">
                  <button type="button" className="icon-btn" aria-label={`Quitar una ${c.name}`} onClick={() => change(c.id, -1)}>
                    −
                  </button>
                  <span className="scan-stepper__n">{counts[c.id]}</span>
                  <button type="button" className="icon-btn" aria-label={`Añadir una ${c.name}`} onClick={() => change(c.id, 1)}>
                    +
                  </button>
                </span>
              </div>
            ))}
          </div>

          {addable.length > 0 && (
            <div className="scan-add">
              <select value={addId} onChange={(e) => setAddId(e.target.value)} aria-label="Carta a añadir">
                <option value="">Añadir una carta que falte…</option>
                {addable.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn"
                disabled={!addId}
                onClick={() => {
                  change(addId, 1);
                  setAddId('');
                }}
              >
                ➕
              </button>
            </div>
          )}

          <div className="scan-score">
            <div className="scan-score__row">
              <span>🌰 Puntos directos</span>
              <span>{score.direct}</span>
            </div>
            {FORMULAS.map(({ key, label, icon }) => {
              const [a, b] = score.factors[key];
              if (a === 0) return null;
              return (
                <div key={key} className="scan-score__row">
                  <span>
                    {icon} {label}
                  </span>
                  <span>
                    {a} × {b} = {a * b}
                  </span>
                </div>
              );
            })}
            <div className="scan-score__row scan-score__row--total">
              <span>Total</span>
              <span>{score.total}</span>
            </div>
          </div>

          <div className="scan-actions">
            <button className="btn btn--primary" type="button" onClick={() => onApply(score)}>
              ✅ Usar estos datos
            </button>
            <button className="btn" type="button" onClick={() => setStatus('idle')}>
              📷 Otra foto
            </button>
          </div>
        </>
      )}
    </div>
  );
}
