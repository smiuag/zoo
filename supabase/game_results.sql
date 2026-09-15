-- Ranking / histórico de partidas (ver apps/web/src/online/gameResults.ts).
-- Ejecutar UNA VEZ, a mano, en el SQL editor del proyecto de Supabase
-- (Dashboard -> SQL Editor -> New query -> pegar esto -> Run). No hace
-- falta auth ni RLS complejo: no hay cuentas de usuario, todo el mundo
-- (incluida la clave "anon" que ya usa la app) puede insertar y leer.

create table if not exists public.game_results (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  -- Nick visible en el ranking (el mismo que ya se usa en la partida, ver
  -- lib/gameConfig.ts) — nunca vacío gracias a recordGameResult, que cae a
  -- "Anon" si hiciera falta.
  nick text not null,
  -- Anónimo, generado una vez en localStorage (ver lib/deviceId.ts): solo
  -- sirve para poder filtrar "mis partidas" en este dispositivo, nunca se
  -- muestra en el ranking público.
  device_id text not null,
  score integer not null,
  mode text not null check (mode in ('solo', 'local', 'online')),
  num_players integer not null,
  round_limit integer
);

create index if not exists game_results_score_idx on public.game_results (score desc);
create index if not exists game_results_device_id_idx on public.game_results (device_id, created_at desc);

alter table public.game_results enable row level security;

-- Cualquiera (incluido un visitante sin login, con la clave "anon") puede
-- añadir su propio resultado...
drop policy if exists "anyone can insert game results" on public.game_results;
create policy "anyone can insert game results"
  on public.game_results
  for insert
  to anon, authenticated
  with check (true);

-- ...y leer el ranking/histórico completo (es público, sin datos privados:
-- ni IP ni nada que identifique a una persona real, solo un nick y un id
-- anónimo de dispositivo).
drop policy if exists "anyone can read game results" on public.game_results;
create policy "anyone can read game results"
  on public.game_results
  for select
  to anon, authenticated
  using (true);
