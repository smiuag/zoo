import { useRef, useState } from 'react';
import { scanPhoto } from '../lib/cardScanVision';
import { SCAN_CARDS, scoreFromCounts, type ScanCounts, type ScanScore } from '../lib/scanScoring';
import { useT } from '../lib/i18n';

interface CardScannerProps {
  playerName: string;
  onApply: (score: ScanScore) => void;
  onCancel: () => void;
}

const FORMULAS: { key: keyof ScanScore['factors']; label: string; icon: string }[] = [
  { key: 'eagle', label: 'Águila × voladores', icon: '🦅' },
  { key: 'panda', label: 'Tigre × terrestres', icon: '🐯' },
  { key: 'orca', label: 'Orca × acuáticos', icon: '🐋' },
  { key: 'albatross', label: 'Albatros × especies', icon: '🕊️' },
  { key: 'toucan', label: 'Tucán × coste 5+', icon: '🦜' },
  { key: 'shark', label: 'Tiburón × bellotas', icon: '🦈' },
];

// Escanea una foto de las cartas de un jugador, apiladas por especie y
// escalonadas dejando a la vista la franja superior de todas (bolsa de coste y
// escudo de PV), y enseña el recuento por carta y la puntuación resultante, con
// las cantidades editables antes de volcarlas a la calculadora. Todo el
// reconocimiento ocurre en el dispositivo (ver lib/cardScanCv.ts).
export function CardScanner({ playerName, onApply, onCancel }: CardScannerProps) {
  const { t, cardName } = useT();
  const [status, setStatus] = useState<'idle' | 'scanning' | 'review' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [counts, setCounts] = useState<ScanCounts>({});
  const [unknownCards, setUnknownCards] = useState(0);
  const [addId, setAddId] = useState('');
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setStatus('scanning');
    setProgress(0);
    try {
      const scan = await scanPhoto(file, setProgress);
      setCounts(scan.counts);
      setUnknownCards(scan.unknownCards);
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
        <h3>📷 {t('Escanear cartas de {name}', { name: playerName || t('este jugador') })}</h3>
        <button className="icon-btn" type="button" aria-label={t('Cerrar escáner')} onClick={onCancel}>
          ✕
        </button>
      </div>

      {(status === 'idle' || status === 'error') && (
        <>
          <p className="scan-hint">
            {t('Apila las cartas')} <strong>{t('por especie')}</strong>
            {t(', una pila por especie, y ')}
            <strong>{t('escalónalas hacia arriba')}</strong>
            {t(': cada carta debe dejar a la vista su ')}
            <strong>{t('franja superior')}</strong>
            {t(
              ' (la bolsa con el coste y el escudo con los PV). La carta de delante, entera. Deja un hueco entre pilas, haz la foto desde arriba, con buena luz y sin reflejos; las cartas pueden salir giradas. Mejor la foto original del móvil que una reenviada por WhatsApp.'
            )}
          </p>
          {status === 'error' && (
            <p className="scan-hint scan-hint--error">
              {t('No se pudo analizar la foto (¿sin conexión la primera vez?). Prueba otra vez.')}
            </p>
          )}
          <div className="scan-actions">
            <button className="btn btn--primary" type="button" onClick={() => cameraRef.current?.click()}>
              {t('📷 Hacer foto')}
            </button>
            <button className="btn" type="button" onClick={() => galleryRef.current?.click()}>
              {t('🖼️ Elegir imagen')}
            </button>
          </div>
          <p className="scan-hint scan-hint--small">
            {t(
              'La foto no sale del móvil. La primera vez se descarga el motor de visión (unos 13 MB); después va más rápido. Si falla alguna carta, corrígela a mano.'
            )}
          </p>
        </>
      )}

      {status === 'scanning' && (
        <div className="scan-progress" role="status">
          <div className="scan-progress__bar">
            <div className="scan-progress__fill" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <span>{t('Buscando las cartas… {pct}%', { pct: Math.round(progress * 100) })}</span>
        </div>
      )}

      {status === 'review' && (
        <>
          <p className="scan-hint">
            {t('Detectadas')} <strong>{totalCards}</strong>{' '}
            {t('cartas. Revisa el recuento y corrige lo que haga falta: la puntuación se recalcula al momento.')}
            {unknownCards > 0 && (
              <>
                {' '}
                <strong>{unknownCards}</strong>{' '}
                {unknownCards === 1
                  ? t('carta no se ha podido identificar: añádelas con el desplegable.')
                  : t('cartas no se han podido identificar: añádelas con el desplegable.')}
              </>
            )}
          </p>

          <div className="scan-list">
            {detected.length === 0 && <p className="scan-hint">{t('No se ha detectado ninguna carta. Añádelas a mano o repite la foto.')}</p>}
            {detected.map((c) => (
              <div key={c.id} className="scan-item">
                <span className="scan-item__name">{cardName(c)}</span>
                <span className="scan-stepper">
                  <button type="button" className="icon-btn" aria-label={t('Quitar una {name}', { name: cardName(c) })} onClick={() => change(c.id, -1)}>
                    −
                  </button>
                  <span className="scan-stepper__n">{counts[c.id]}</span>
                  <button type="button" className="icon-btn" aria-label={t('Añadir una {name}', { name: cardName(c) })} onClick={() => change(c.id, 1)}>
                    +
                  </button>
                </span>
              </div>
            ))}
          </div>

          {addable.length > 0 && (
            <div className="scan-add">
              <select value={addId} onChange={(e) => setAddId(e.target.value)} aria-label={t('Carta a añadir')}>
                <option value="">{t('Añadir una carta que falte…')}</option>
                {addable.map((c) => (
                  <option key={c.id} value={c.id}>
                    {cardName(c)}
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
              <span>🌰 {t('Puntos directos')}</span>
              <span>{score.direct}</span>
            </div>
            {FORMULAS.map(({ key, label, icon }) => {
              const [a, b] = score.factors[key];
              if (a === 0) return null;
              return (
                <div key={key} className="scan-score__row">
                  <span>
                    {icon} {t(label)}
                  </span>
                  <span>
                    {a} × {b} = {a * b}
                  </span>
                </div>
              );
            })}
            <div className="scan-score__row scan-score__row--total">
              <span>{t('Total')}</span>
              <span>{score.total}</span>
            </div>
          </div>

          <div className="scan-actions">
            <button className="btn btn--primary" type="button" onClick={() => onApply(score)}>
              {t('✅ Usar estos datos')}
            </button>
            <button className="btn" type="button" onClick={() => setStatus('idle')}>
              {t('📷 Otra foto')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
