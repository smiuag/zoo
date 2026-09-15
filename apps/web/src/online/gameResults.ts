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

export interface GameResultInput {
  nick: string;
  score: number;
  mode: GameMode;
  numPlayers: number;
  roundLimit: number | null;
}

export interface GameResultRow {
  nick: string;
  score: number;
  mode: GameMode;
  num_players: number;
  created_at: string;
}

// Mejor esfuerzo siempre: sin Supabase configurado, sin tabla creada
// todavía, o sin conexión, esto nunca debe romper ni bloquear la partida
// real — solo se pierde ese resultado del ranking.
export async function recordGameResult(input: GameResultInput): Promise<void> {
  if (!supabase) return;
  const nick = input.nick.trim() || 'Anon';
  try {
    await supabase.from('game_results').insert({
      nick,
      device_id: getDeviceId(),
      score: input.score,
      mode: input.mode,
      num_players: input.numPlayers,
      round_limit: input.roundLimit,
    });
  } catch {
    // ver comentario de arriba
  }
}

export async function fetchTopScores(limit = 20): Promise<GameResultRow[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('game_results')
      .select('nick, score, mode, num_players, created_at')
      .order('score', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data as GameResultRow[];
  } catch {
    return [];
  }
}

export async function fetchMyHistory(limit = 20): Promise<GameResultRow[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('game_results')
      .select('nick, score, mode, num_players, created_at')
      .eq('device_id', getDeviceId())
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data as GameResultRow[];
  } catch {
    return [];
  }
}
