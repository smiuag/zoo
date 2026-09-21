import type { GameEdition } from '@zoo/engine';
// Los 4 algoritmos de IA disponibles para cada hueco de bot (pedido
// explícito del usuario 2026-09-21: solo estos 4, nunca los heurísticos/
// aleatorio como opción visible): 'general' sin restricción de hábitat,
// 'land'/'bird'/'aquatic' especialistas restringidos a comprar solo ese
// hábitat. Son EDICIÓN-AGNÓSTICOS a propósito: el mismo valor 'land' se
// resuelve a un bot RL distinto según la edición de la partida (ver
// resolveBot en botAlgorithms.ts) — clásico/aprendizaje usan siempre los
// bots clásicos (aprendizaje no tiene entrenamiento propio, ver
// bots/rlBot.ts), completa usa los suyos si ya están entrenados o cae en el
// heurístico si no (nunca en pesos sin entrenar) — así elegir "Terrestre" y
// cambiar de edición no requiere ningún remapeo: el bot de verdad cambia
// solo, sin que el jugador tenga que volver a elegir nada. Vive aquí (no en
// useGame.ts) para que este archivo y useGame.ts puedan importarse el uno
// al otro sin ciclo.
export type BotAlgorithm = 'general' | 'land' | 'bird' | 'aquatic';

// Límites razonables para el formulario de creación de partida: el motor no
// impone ningún máximo de jugadores, pero el mercado tiene copias limitadas
// por especie (6-10 según coste), así que partidas enormes se quedarían sin
// animales enseguida. 1-4 humanos (turno rotatorio en el mismo dispositivo,
// ver el "pase y juega" en App.tsx) + 0-7 bots cubre de sobra el uso real.
export const MIN_HUMANS = 1;
export const MAX_HUMANS = 4;
export const MIN_BOTS = 0;
export const MAX_BOTS = 7;
// Con 1 solo humano hace falta al menos 1 bot rival; con 2+ humanos ya se
// pueden enfrentar entre ellos sin ningún bot.
export const MIN_TOTAL_PLAYERS = 2;

// Todo bot nuevo (al crear la partida o al subir "Número de bots" en el
// formulario) arranca con el algoritmo genérico sin restricción de hábitat:
// el usuario decide luego, hueco a hueco, si le da preferencia de hábitat a
// alguno. También el fallback en useGame.ts si por lo que sea un asiento de
// bot no tiene algoritmo asignado.
export const DEFAULT_BOT_ALGORITHM: BotAlgorithm = 'general';

// Duraciones de partida seleccionables (en rondas: 1 turno de cada
// jugador). No hay opción "sin límite" a propósito: con una duración
// elegida, esa es la ÚNICA forma en que termina la partida (el criterio de
// agotar mazos compartidos queda desactivado, ver endTurn en engine.ts) —
// esto le da al jugador control real sobre cuánto dura.
export const ROUND_LIMIT_OPTIONS = [10, 15, 20] as const;
export type RoundLimit = (typeof ROUND_LIMIT_OPTIONS)[number];
export const DEFAULT_ROUND_LIMIT: RoundLimit = 15;

// Nick del jugador local (human-0): lo escribe en el formulario y se guarda
// en localStorage para las siguientes partidas en este dispositivo. Corto a
// propósito (MAX_NICK_LENGTH) para que el marcador quepa en una sola línea
// en el móvil incluso con 5 jugadores. Vacío = nombre por defecto ("Tú").
export const MAX_NICK_LENGTH = 4;
const NICK_STORAGE_KEY = 'zoo.nick';

export function loadSavedNick(): string {
  try {
    return (window.localStorage.getItem(NICK_STORAGE_KEY) ?? '').slice(0, MAX_NICK_LENGTH);
  } catch {
    return '';
  }
}

export function saveNick(nick: string): void {
  try {
    if (nick) window.localStorage.setItem(NICK_STORAGE_KEY, nick);
    else window.localStorage.removeItem(NICK_STORAGE_KEY);
  } catch {
    // Sin almacenamiento (modo privado, etc.): simplemente no se recuerda.
  }
}

// Todos los valores posibles de BotAlgorithm, para validar lo leído de
// localStorage (ver loadSavedSetupPrefs): un valor corrupto o de una
// versión antigua del formulario (p. ej. 'heuristic'/'rlFull' de antes de
// este rediseño) no debe colar un algoritmo desconocido que luego reviente
// resolveBot en botAlgorithms.ts — simplemente se descarta como inválido y
// GameSetup cae a sus valores por defecto de siempre.
const ALL_BOT_ALGORITHMS: readonly BotAlgorithm[] = ['general', 'land', 'bird', 'aquatic'];

export interface SetupPrefs {
  numHumans: number;
  botAlgorithms: BotAlgorithm[];
  roundLimit: RoundLimit;
  animationsEnabled: boolean;
}

const SETUP_PREFS_STORAGE_KEY = 'zoo.setupPrefs';

// Configuración recordada del formulario de creación de partida (nº de
// jugadores humanos, bots elegidos con su algoritmo, y si se quieren
// animaciones): igual que el nick (ver loadSavedNick), se guarda en
// localStorage en el momento de empezar la partida, no al tocar cada campo,
// para que el formulario abra ya así la próxima vez en este dispositivo.
// null si nunca se guardó nada o si lo guardado ya no es válido (versión
// antigua, dato corrupto...) — en ese caso GameSetup usa sus valores por
// defecto de siempre.
export function loadSavedSetupPrefs(): SetupPrefs | null {
  try {
    const raw = window.localStorage.getItem(SETUP_PREFS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SetupPrefs> | null;
    if (!parsed || typeof parsed !== 'object') return null;

    const numHumans = Number(parsed.numHumans);
    if (!Number.isInteger(numHumans) || numHumans < MIN_HUMANS || numHumans > MAX_HUMANS) return null;

    if (!Array.isArray(parsed.botAlgorithms) || parsed.botAlgorithms.length > MAX_BOTS) return null;
    const botAlgorithms = parsed.botAlgorithms.filter((a): a is BotAlgorithm =>
      (ALL_BOT_ALGORITHMS as string[]).includes(a as string)
    );
    if (botAlgorithms.length !== parsed.botAlgorithms.length) return null;

    const roundLimit = (ROUND_LIMIT_OPTIONS as readonly number[]).includes(Number(parsed.roundLimit))
      ? (Number(parsed.roundLimit) as RoundLimit)
      : DEFAULT_ROUND_LIMIT;

    return { numHumans, botAlgorithms, roundLimit, animationsEnabled: Boolean(parsed.animationsEnabled) };
  } catch {
    return null;
  }
}

export function saveSetupPrefs(prefs: SetupPrefs): void {
  try {
    window.localStorage.setItem(SETUP_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Sin almacenamiento (modo privado, etc.): simplemente no se recuerda.
  }
}

export interface GameConfig {
  numHumans: number;
  nick: string;
  // Un algoritmo por hueco de bot (longitud = nº de bots elegido).
  botAlgorithms: BotAlgorithm[];
  roundLimit: RoundLimit;
  // Decidido al crear la partida por quien la crea (en online, se aplica
  // igual para todos los que se unan): con esto desactivado, los bots
  // actúan sin ningún retraso artificial (ver BOT_STEP_DELAY_MS en
  // useGame.ts) y no se genera la animación de "vuelo" de compra (ver
  // FlyingCard.tsx) — no toca la de aparición suave de cartas nuevas.
  animationsEnabled: boolean;
  // Nick de cada invitado ONLINE (human-1, human-2...), recogido en la sala
  // de espera antes de empezar (ver GuestApp.tsx / useHostRoom.ts) — el
  // host nunca escribe estos, solo `nick` (el suyo propio, human-0). Ausente
  // en pase-y-juega local: ahí los humanos 2+ siguen usando el nombre por
  // defecto "J2"/"J3" (ver humanName en useGame.ts), sin campo para
  // elegirlo. Las claves son el seatId ("human-1", no el índice).
  guestNicks?: Record<string, string>;
  // Edición de la baraja (ver lib/edition.ts); ausente = 'classic', la oficial.
  edition?: GameEdition;
}

export function defaultGameConfig(): GameConfig {
  return {
    numHumans: 1,
    nick: '',
    botAlgorithms: Array.from({ length: 4 }, () => DEFAULT_BOT_ALGORITHM),
    roundLimit: DEFAULT_ROUND_LIMIT,
    animationsEnabled: true,
  };
}
