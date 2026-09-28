import type { GameEdition, PlayerScore } from '@zoo/engine';
import { supabase } from './supabaseClient';
import { getDeviceId } from '../lib/deviceId';

// Ranking/histórico de partidas (pedido explícito del usuario, sin
// autenticar a nadie): una fila por HUMANO que termina una partida, en la
// tabla `game_results` de Supabase (ver ../../../supabase/game_results.sql
// para la migración — hay que ejecutarla una vez a mano en el SQL editor
// del proyecto, esto no puede crear tablas por su cuenta con la clave
// anónima). Identidad = nick (público, para el ranking) + device_id
// (anónimo, solo localStorage — ver lib/deviceId.ts — para poder filtrar
// "mis partidas" sin mezclarlas con las de otro "Tú").
export type GameMode = 'solo' | 'local' | 'online';

// Ediciones que se distinguen en el ranking (ver lib/edition.ts): las 3 que
// se pueden elegir en la web. En el ranking "Personalizado" hace de "completo".
export type ResultEdition = 'classic' | 'learning' | 'custom';
export const RESULT_EDITIONS: readonly ResultEdition[] = ['classic', 'learning', 'custom'];

// 'full' (solo motor/entrenamiento, sin botón en la web) y cualquier valor
// desconocido cuentan como clásica, igual que effectiveEdition en lib/edition.ts.
export function toResultEdition(edition: GameEdition | undefined): ResultEdition {
  return edition === 'custom' || edition === 'learning' ? edition : 'classic';
}

// Colección final comprimida: un par por CADA id de carta distinto que
// tuvieras (deck+mano+descarte+jugado este turno), con cuántas copias — sin
// esto, "ver la baraja" no tendría sentido: solo se guarda el número
// (score), nunca qué compraste de verdad.
export interface DeckSummaryEntry {
  id: string;
  count: number;
}

export interface GameResultInput {
  nick: string;
  score: number;
  mode: GameMode;
  numPlayers: number;
  roundLimit: number | null;
  edition: ResultEdition;
  // Puesto final entre TODOS los jugadores de la partida (humanos y bots),
  // 1 = el que más puntos hizo — ver computePosition más abajo.
  position: number;
  deck: DeckSummaryEntry[];
}

export interface GameResultRow {
  nick: string;
  score: number;
  mode: GameMode;
  num_players: number;
  created_at: string;
  round_limit: number | null;
  // null en filas anteriores a esta columna (se tratan como clásicas).
  edition: ResultEdition | null;
  position: number | null;
  // null en filas registradas antes de añadir esta columna: Ranking.tsx
  // debe tratarlo como "sin baraja guardada", nunca como baraja vacía.
  deck: DeckSummaryEntry[] | null;
}

// Cuántos jugadores (de TODOS los de la partida, no solo humanos) sacaron
// estrictamente más puntos que este — ranking "por competición": un empate
// en 1er puesto dejaría al siguiente en 3º, no en 2º.
export function computePosition(scores: PlayerScore[], playerId: string): number {
  const mine = scores.find((s) => s.playerId === playerId)?.score ?? 0;
  return scores.filter((s) => s.score > mine).length + 1;
}

// Agrupa una colección de cartas (cualquier cosa con un `id`, típicamente
// CardInstance) por id de carta, para no guardar cada instancia suelta (su
// instanceId no aporta nada de cara al ranking).
export function summarizeCollection(cards: { id: string }[]): DeckSummaryEntry[] {
  const counts = new Map<string, number>();
  for (const card of cards) counts.set(card.id, (counts.get(card.id) ?? 0) + 1);
  return [...counts.entries()].map(([id, count]) => ({ id, count }));
}

// Petición colgada (nunca llega a resolver NI a rechazar) != petición que
// falla: un try/catch no ayuda contra eso, así que se corre en paralelo con
// un timeout que gana por defecto si Supabase (o algo delante, como el
// challenge anti-bot de Cloudflare en su dominio) no contesta a tiempo. Sin
// esto, Ranking.tsx se quedaba en "Cargando..." para siempre en vez de
// mostrar la lista vacía como con cualquier otro fallo.
function withTimeout<T>(promise: Promise<T>, fallback: T, ms = 8000): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}

const RESULT_COLUMNS = 'nick, score, mode, num_players, created_at, round_limit, edition, position, deck';

// Mejor esfuerzo siempre: sin Supabase configurado, sin tabla creada
// todavía, o sin conexión, esto nunca debe romper ni bloquear la partida
// real — solo se pierde ese resultado del ranking.
export async function recordGameResult(input: GameResultInput): Promise<void> {
  if (!supabase) return;
  const nick = input.nick.trim() || 'Anon';
  try {
    const row = {
      nick,
      device_id: getDeviceId(),
      score: input.score,
      mode: input.mode,
      num_players: input.numPlayers,
      round_limit: input.roundLimit,
      position: input.position,
      deck: input.deck,
    };
    const { error } = await supabase.from('game_results').insert({ ...row, edition: input.edition });
    // Si la columna `edition` aún no existe en la tabla (falta ejecutar la
    // migración, ver supabase/game_results.sql), se guarda el resultado sin
    // ella antes que perderlo.
    if (error) await supabase.from('game_results').insert(row);
  } catch {
    // ver comentario de arriba
  }
}

export interface TopScoresFilter {
  roundLimit: number;
  edition: ResultEdition;
  // null = todos los tamaños de mesa.
  numPlayers: number | null;
}

// Top puntuaciones para UNA combinación de duración, edición y (opcional) nº
// de jugadores: no tiene sentido comparar una partida a 10 rondas contra una a
// 20, ni una de 2 jugadores contra una de 6, ni clásica contra personalizada
// (pedido explícito del usuario) — Ranking.tsx pide cada combinación por
// separado en vez de traer todo mezclado y filtrar en el cliente. Las filas
// sin `edition` (anteriores a la columna) cuentan como clásicas.
export async function fetchTopScores(filter: TopScoresFilter, limit = 20): Promise<GameResultRow[]> {
  if (!supabase) return [];
  const run = (async () => {
    try {
      let query = supabase.from('game_results').select(RESULT_COLUMNS).eq('round_limit', filter.roundLimit);
      query = filter.edition === 'classic' ? query.or('edition.eq.classic,edition.is.null') : query.eq('edition', filter.edition);
      if (filter.numPlayers !== null) query = query.eq('num_players', filter.numPlayers);
      const { data, error } = await query.order('score', { ascending: false }).limit(limit);
      if (error || !data) return [];
      return data as GameResultRow[];
    } catch {
      return [];
    }
  })();
  return withTimeout(run, []);
}

export async function fetchMyHistory(limit = 20): Promise<GameResultRow[]> {
  if (!supabase) return [];
  const run = (async () => {
    try {
      const { data, error } = await supabase
        .from('game_results')
        .select(RESULT_COLUMNS)
        .eq('device_id', getDeviceId())
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error || !data) return [];
      return data as GameResultRow[];
    } catch {
      return [];
    }
  })();
  return withTimeout(run, []);
}
