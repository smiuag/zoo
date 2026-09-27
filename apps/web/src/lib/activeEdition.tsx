import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { GameEdition } from '@zoo/engine';

// Qué edición está jugando AHORA MISMO la pestaña (o ninguna, si estamos en
// el menú de creación de partida) — leído por CardEncyclopedia.tsx (ver
// components/CardEncyclopedia.tsx) para decidir qué cartas mostrar sin tener
// que enhebrar la edición como prop por todo App.tsx/GuestApp.tsx. Cada uno
// de los dos (host/local y invitado online) reporta la suya con
// useReportActiveEdition; ninguno de los dos sabe nada del otro.
const ActiveEditionContext = createContext<GameEdition | undefined>(undefined);
const SetActiveEditionContext = createContext<(edition: GameEdition | undefined) => void>(() => {});

export function ActiveEditionProvider({ children }: { children: ReactNode }) {
  const [edition, setEdition] = useState<GameEdition | undefined>(undefined);
  return (
    <SetActiveEditionContext.Provider value={setEdition}>
      <ActiveEditionContext.Provider value={edition}>{children}</ActiveEditionContext.Provider>
    </SetActiveEditionContext.Provider>
  );
}

export function useActiveEdition(): GameEdition | undefined {
  return useContext(ActiveEditionContext);
}

// undefined = sin partida en curso (formulario de creación, sala de espera
// online, o invitado que aún no ha recibido el primer estado).
export function useReportActiveEdition(edition: GameEdition | undefined) {
  const setEdition = useContext(SetActiveEditionContext);
  useEffect(() => {
    setEdition(edition);
    return () => setEdition(undefined);
  }, [edition, setEdition]);
}
