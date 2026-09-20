import { createContext, useContext, useState, type ReactNode } from 'react';

// Estilo visual de las cartas: "imagen" (ilustración real, ver
// cardImageUrl en cardVisuals.ts) o "emoji" (el Twemoji de toda la vida,
// ver cardIcon). Elegido una vez en GameSetup y recordado en este
// dispositivo (ver loadSavedArtStyle/saveArtStyle) — puramente de
// presentación local: nunca viaja por el protocolo online, así que cada
// jugador de una misma sala puede verlo a su gusto sin afectar a nadie más.
export type ArtStyle = 'imagen' | 'emoji';

const ART_STYLE_STORAGE_KEY = 'zoo.artStyle';
export const DEFAULT_ART_STYLE: ArtStyle = 'imagen';

export function loadSavedArtStyle(): ArtStyle {
  try {
    const raw = window.localStorage.getItem(ART_STYLE_STORAGE_KEY);
    return raw === 'imagen' || raw === 'emoji' ? raw : DEFAULT_ART_STYLE;
  } catch {
    return DEFAULT_ART_STYLE;
  }
}

export function saveArtStyle(style: ArtStyle): void {
  try {
    window.localStorage.setItem(ART_STYLE_STORAGE_KEY, style);
  } catch {
    // Sin almacenamiento (modo privado, etc.): simplemente no se recuerda.
  }
}

const ArtStyleContext = createContext<[ArtStyle, (style: ArtStyle) => void] | null>(null);

// Un único Provider en la raíz (ver App.tsx) para que CardView pueda leer
// el estilo elegido sin que cada componente intermedio (GameBoard,
// GuestApp, las filas de mano/mercado...) tenga que reenviarlo a mano.
export function ArtStyleProvider({ children }: { children: ReactNode }) {
  const [artStyle, setArtStyleState] = useState<ArtStyle>(loadSavedArtStyle);

  function setArtStyle(style: ArtStyle) {
    setArtStyleState(style);
    saveArtStyle(style);
  }

  return <ArtStyleContext.Provider value={[artStyle, setArtStyle]}>{children}</ArtStyleContext.Provider>;
}

export function useArtStyle(): [ArtStyle, (style: ArtStyle) => void] {
  const ctx = useContext(ArtStyleContext);
  if (!ctx) throw new Error('useArtStyle debe usarse dentro de <ArtStyleProvider>');
  return ctx;
}
