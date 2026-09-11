import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// null cuando el proyecto no tiene configurado Supabase (ver
// apps/web/.env.example): el modo local sigue funcionando igual, y la UI usa
// isOnlineAvailable para ocultar la opción "Crear partida online" en vez de
// romper al intentar conectar.
export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null;

export const isOnlineAvailable = supabase !== null;
