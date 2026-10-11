import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CARD_NAME_EN, CARD_TEXT_EN } from './cardTextEn';
import { EN } from './i18nEn';

// Idiomas de la interfaz (2026-10-11, pedido explícito del usuario): cada
// jugador ve la partida en el suyo, elegido al empezar/unirse. El castellano
// es el idioma "fuente": todo el texto del código sigue escrito en castellano
// y `t('texto en castellano')` lo traduce buscándolo en i18nEn.ts; si no hay
// traducción, se muestra el castellano tal cual (nunca revienta ni deja en
// blanco).
export type Lang = 'es' | 'en';
export const LANGS: readonly Lang[] = ['es', 'en'];
export const LANG_LABELS: Record<Lang, string> = { es: 'Español', en: 'English' };
export const DEFAULT_LANG: Lang = 'es';

const DEVICE_LANG_KEY = 'zoo.lang';
const PLAYER_LANGS_KEY = 'zoo.playerLangs';

export function isLang(value: unknown): value is Lang {
  return value === 'es' || value === 'en';
}

function detectBrowserLang(): Lang {
  try {
    return navigator.language?.toLowerCase().startsWith('en') ? 'en' : 'es';
  } catch {
    return DEFAULT_LANG;
  }
}

// Idioma de este dispositivo: el último elegido aquí; la primera vez, el del
// navegador. Es lo que usa un invitado online (su idioma es solo cosa suya).
export function loadDeviceLang(): Lang {
  try {
    const raw = localStorage.getItem(DEVICE_LANG_KEY);
    if (isLang(raw)) return raw;
  } catch {
    /* sin localStorage: idioma del navegador */
  }
  return detectBrowserLang();
}

export function saveDeviceLang(lang: Lang): void {
  try {
    localStorage.setItem(DEVICE_LANG_KEY, lang);
  } catch {
    /* sin localStorage: no se recuerda */
  }
}

// Idioma de cada humano de la última partida local creada en este dispositivo
// (índice = human-N). Se completa con el idioma del dispositivo si faltan.
export function loadPlayerLangs(count: number): Lang[] {
  const fallback = loadDeviceLang();
  let saved: unknown[] = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(PLAYER_LANGS_KEY) ?? '[]');
    if (Array.isArray(parsed)) saved = parsed;
  } catch {
    /* ignora lo corrupto */
  }
  return Array.from({ length: count }, (_, i) => (isLang(saved[i]) ? (saved[i] as Lang) : fallback));
}

export function savePlayerLangs(langs: readonly Lang[]): void {
  try {
    localStorage.setItem(PLAYER_LANGS_KEY, JSON.stringify(langs));
    if (langs[0]) saveDeviceLang(langs[0]);
  } catch {
    /* sin localStorage: no se recuerda */
  }
}

// Idioma actual a nivel de módulo: lo actualiza LangProvider en cada render
// con el valor vigente. Permite que helpers que no son componentes
// (pendingChoice.ts, actionLabels.ts...) traduzcan con `tr()` sin recibir el
// idioma como parámetro — siempre se les llama desde un componente que ya
// se ha suscrito con useT()/useLang(), así que se vuelve a ejecutar al
// cambiar de idioma.
let currentLang: Lang = DEFAULT_LANG;

function interpolate(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}

// Traduce un texto escrito en castellano (con {marcadores} opcionales) al
// idioma vigente.
export function tr(es: string, vars?: Record<string, string | number>): string {
  const text = currentLang === 'en' ? (EN[es] ?? es) : es;
  return interpolate(text, vars);
}

export function currentLanguage(): Lang {
  return currentLang;
}

// Nombre y texto de una carta en el idioma vigente (el motor solo trae el
// castellano). `card` es cualquier cosa con id/name/text (CardDefinition o
// instancia).
export function cardNameLocalized(card: { id: string; name: string }): string {
  return currentLang === 'en' ? (CARD_NAME_EN[card.id] ?? card.name) : card.name;
}

export function cardTextLocalized(card: { id: string; text?: string }, esFallback?: string): string {
  if (currentLang === 'en') return CARD_TEXT_EN[card.id] ?? esFallback ?? card.text ?? '';
  return esFallback ?? card.text ?? '';
}

interface LangContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

const LangContext = createContext<LangContextValue>({ lang: DEFAULT_LANG, setLang: () => undefined });

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(loadDeviceLang);
  // Se asigna durante el render (no en un efecto) para que los hijos que se
  // renderizan en esta misma pasada ya vean el idioma nuevo.
  currentLang = lang;
  const setLang = useCallback((next: Lang) => setLangState(next), []);
  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  return useContext(LangContext);
}

// Hook principal de los componentes: se suscribe al idioma (re-render al
// cambiar) y devuelve `t`, `lang` y los helpers de cartas ya ligados.
export function useT() {
  const { lang, setLang } = useContext(LangContext);
  return useMemo(
    () => ({
      lang,
      setLang,
      t: tr,
      cardName: cardNameLocalized,
      cardText: cardTextLocalized,
    }),
    [lang, setLang]
  );
}
