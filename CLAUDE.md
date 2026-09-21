# Zoo Deckbuilder

Juego de cartas tipo deckbuilder de animales (coste/PV/hábitat/efectos), con
motor propio, app web (local + online) y bots de refuerzo (RL) entrenados por
autojuego. Monorepo npm workspaces.

```
packages/engine/   Motor del juego (TS puro, sin UI) + bots + entrenamiento RL
apps/web/           App React/Vite (local pase-y-juega + online vía Supabase)
img/                Arte e impresión de las cartas físicas (scripts Python)
```

## Comandos

Desde la raíz (usa `npm workspaces`):

```bash
npm run test           # tests del motor (vitest, packages/engine)
npm run dev:web         # app web en modo dev (Vite)
npm run train:rl        # entrena el bot RL genérico (packages/engine)
npm run arena:rl         # enfrenta bots entre sí
```

Variantes de entrenamiento (todas se lanzan desde `packages/engine`, o con
`-w packages/engine` desde la raíz):

```bash
RL_HABITAT=land|bird|aquatic npm run train:rl   # especialista de hábitat
RL_EDITION=full npm run train:rl                 # edición completa (generalista)
RL_EDITION=full RL_HABITAT=land npm run train:rl # especialista de la completa
```

Build de la web: `npm run build -w apps/web` (Vite). No hay CI configurado;
`npm run test` y `tsc --noEmit` (en `packages/engine` y `apps/web`) son la
verificación de referencia antes de dar algo por terminado.

## Entorno de desarrollo (Windows)

- Shell habitual: Git Bash. El intérprete Python del pipeline de impresión
  **no** está en el PATH normal: usar `/c/Python310/python` (tiene Pillow,
  numpy, scipy, PyMuPDF).
- Los comandos de Bash de más de ~8 KB (heredocs largos, scripts pegados
  inline) fallan con `unexpected EOF while looking for matching '''`, aunque
  el contenido sea correcto — es un límite de longitud de línea de comandos
  de este setup, no un problema de comillas. Dividir en varios comandos o
  escribir el script a un archivo (scratchpad) y ejecutarlo desde ahí.
- Para ejecutar TS suelto que use el registro de cartas (`import.meta.glob`
  en `cards/registry.ts`) hace falta `vite-node`, nunca `node`/`esbuild` a
  secas.
- `TaskStop` sobre un proceso de entrenamiento en background **no mata de
  forma fiable** el árbol de procesos `node.exe`/`vite-node` en este Windows
  — puede dejar procesos zombis escribiendo a los mismos `weights*.json`.
  Antes de relanzar un entrenamiento, comprobar y matar restos:
  ```powershell
  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*selfPlay.ts*" } | Select-Object ProcessId,CommandLine
  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*train:rl*" -or $_.CommandLine -like "*selfPlay.ts*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  ```
  Si un cambio en los datos de las cartas ocurre a mitad de un entrenamiento
  en marcha, hay que pararlo (verificando que no queda zombi) y relanzarlo
  desde cero — entrenar contra datos de carta obsoletos produce bots que no
  reflejan las reglas actuales.

## Motor (`packages/engine/src`)

- `cards/data/*.json` — un fichero por especie/moneda, validado por Zod
  (`cards/schema.ts`). Cada carta tiene coste, PV, hábitats, y una lista de
  `effects: [{ trigger: 'onPlay' | 'onScore' | 'onTurnStart', type, params }]`
  resuelta por el registro de `effects/registry.ts`
  (`registerEffect`/`resolveEffect`, `registerScoreEffect`/`resolveScoreEffect`).
  Una carta solo-edición-completa lleva `"edition": "full"` en su JSON; su
  texto alternativo (cuando una carta clásica se comporta distinto en la
  completa, como el Cocodrilo) va en `fullEditionText`.
- `engine.ts` — reglas del juego: `createGame`, resolución de turnos, compra
  de mercado, `ANIMAL_SPECIES` (las 33 especies clásicas — de ahí dependen
  los bots RL clásicos, no tocar sin retrenar) y `FULL_EDITION_EXTRA_SPECIES`
  (especies solo de la edición completa). `marketSpeciesFor(edition)` decide
  qué especies tienen hueco de mercado según la edición; `effectiveMarketCost`
  aplica el descuento dinámico por dinosaurio jugado ese turno.
- `model/state.ts` — `GameState`, `GameEdition = 'classic' | 'full' | 'learning'`,
  `mintInstance` (acuña una instancia de carta, quitando los tipos extra
  `pet`/`dinosaur` fuera de la edición completa).
- `scoring.ts` — cálculo de puntuación final.
- `bots/` — `Bot = { chooseAction(state, playerId): Action }`. Bots simples
  (`randomBot`, `animalBuyerBot`, `heuristicBot`, `expensiveFirstBot`) y los
  bots RL (ver más abajo). `actionPriority.ts` calcula las acciones legales y
  filtra por hábitat para los especialistas.

## Ediciones del juego

| Edición | Mazo | Mercado | Impresión | Web publicada |
|---|---|---|---|---|
| `classic` | 33 especies, 3 hábitats (terrestre/volador/acuático) | todas | **sí, la única que se imprime** | sí |
| `learning` | igual que clásica | solo coste ≤ 4 (`LEARNING_EDITION_MAX_COST`, 21 de 33 especies) | no | sí |
| `full` | clásica + especies extra (mascotas y dinosaurios, tipos `pet`/`dinosaur`) | todas | no | sí (desde 2026-09-21) |

- `classic` es la **única edición oficial que se imprime en físico**
  (`img/`, ver más abajo). `learning` y `full` son solo digitales.
- Las 3 ediciones se pueden elegir libremente en la app web, publicada o en
  local — no hay ninguna restricción por host. El selector vive en
  `apps/web/src/components/GameSetup.tsx`; la resolución de qué edición se
  le pasa realmente al motor está en `apps/web/src/lib/edition.ts`.
- `learning` no tiene bots RL propios (ni se van a entrenar): siempre usa los
  bots clásicos, sea cual sea el algoritmo elegido.

## Bots RL

Dos codificadores de features **completamente separados**, que nunca
comparten pesos ni featureDim entre sí:

- `bots/rl/features.ts` — edición clásica. `FEATURE_DIM` fijo, no tocar sin
  necesidad real (invalida todos los `weights*.json` clásicos).
- `bots/rl/featuresFull.ts` — edición completa (`FEATURE_DIM_FULL`), ve
  también los hábitats/tipos extra `pet`/`dinosaur` y la lista completa de
  tipos de efecto (`EFFECT_TYPES`). **Si se añade un tipo de efecto nuevo a
  una carta de la completa, hay que añadirlo también aquí** — un efecto
  ausente de `EFFECT_TYPES` deja a la red ciega a esa habilidad sin que
  ningún test lo detecte automáticamente (pasó una vez con
  `eachOpponentDestroysAnimalFromHand`, obligó a reentrenar los 4 bots de la
  completa). Hay un test dedicado (`rlFeaturesFull.test.ts`) que compara la
  lista de tipos de efecto de los datos de carta contra `EFFECT_TYPES`.

Pesos entrenados, en `bots/rl/`:
- Clásicos: `weights.json` (generalista), `weights-land.json`,
  `weights-bird.json`, `weights-aquatic.json`.
- Completa: `weights-full.json`, `weights-full-land.json`,
  `weights-full-bird.json`, `weights-full-aquatic.json`.

`rlBot.ts` (clásico) y `rlBotFull.ts` (completa) exportan bots ya resueltos
contra esos ficheros (`rlBot`, `landRlBot`, `birdRlBot`, `aquaticRlBot` /
`rlBotFull`, `fullLandRlBot`, `fullBirdRlBot`, `fullAquaticRlBot`). Si un
`weights*.json` de la completa no existe, no coincide en `featureDim` o está
corrupto, el bot correspondiente cae automáticamente en `heuristicBot` en vez
de jugar con una red sin entrenar (decidido una vez al cargar el módulo, no
en cada jugada) — los bots clásicos, en cambio, caen en pesos aleatorios si
el fichero falta (comportamiento histórico, no cambiado).

En la web, `apps/web/src/lib/botAlgorithms.ts` expone solo 4 algoritmos
agnósticos de edición — `general` / `land` / `bird` / `aquatic`
(`BotAlgorithm` en `apps/web/src/lib/gameConfig.ts`) — y `resolveBot(algorithm,
edition)` los traduce al bot real según la edición de la partida en curso.
No hay forma en la interfaz de mezclar bots de una edición con otra a
propósito (decisión explícita del usuario); cualquier prueba cruzada se hace
con scripts sueltos en `packages/engine/scripts/rl/`, nunca vía UI.

### Entrenamiento (`packages/engine/scripts/rl/`)

- `selfPlay.ts` (via `npm run train:rl`) — bucle principal de autojuego,
  varios workers en paralelo (`worker.ts`). Guarda checkpoints en
  `weights*.json`/`critic*.json` periódicamente.
- `trainCore.ts` — hiperparámetros y curriculum. Por defecto, partidas de 4
  jugadores (uno de cada variante de hábitat + generalista) — regla fija,
  entrenar en solitario no la sustituye por defecto. `RL_EDITION`/
  `RL_HABITAT` seleccionan codificador/curriculum/nombre de fichero de pesos.
  Valores por defecto actuales: `SHAPING_WEIGHT = 3` (crédito inmediato por
  los PV reales de cada compra, no solo la ventaja terminal),
  `RL_EPSILON = 0.05` si `RL_HABITAT=land`, `0.1` en el resto (exploración
  epsilon-greedy: evita que una carta con score hundido deje de muestrearse
  para siempre — ver "cartas muertas" abajo). Optimizador: SGD para la
  política (nunca Adam sin weight-decay/tope de norma probado, hace crecer
  las normas de los pesos sin freno), Adam solo para el crítico.
  `clampWeightNorms` en `train.ts` limita las normas tras cada actualización
  (`RL_MAX_NORM_W1/W2`, 16/16).
- Crítico: red pequeña separada (`CRITIC_FEATURE_DIM`) que predice el retorno
  esperado desde el estado (turno/ronda/mano/mazo/hábitats propios) para dar
  una ventaja condicionada al estado en vez de restar una media global fija.
  Si se toca su normalización de gradiente, probar primero en una tanda corta
  (~100-150 batches) vigilando que `critic_avg_abs_advantage` no diverja.
- `deadCards.ts` — tras cualquier entrenamiento, comprobar especies
  "muertas" (comprables ≥50 veces observadas, 0 compras reales): el softmax
  de entrenamiento puede dejar de muestrear para siempre una carta cuyo score
  cae muy por detrás de las demás ("pozo"), y entonces nunca vuelve a recibir
  gradiente por mucho que se entrene más. `reviveDeadCards.ts` hace un
  rescate supervisado puntual si hace falta.
- `calibrateScalerValues.ts` — recalibra `scalerCalibration.json` tras
  cualquier entrenamiento nuevo (clásico). No existe aún versión para la
  edición completa (queda vacío `{}`).
- `arena.ts`, `duelVersions.ts`, `eightPlayerMatch.ts`, `cardPreference.ts` y
  similares — scripts de evaluación/diagnóstico. Los que son puramente
  puntuales (comparar una tanda concreta) se escriben, se usan y se borran
  después; los reutilizables quedan commiteados.
- Empujar a mano el score de compra de cartas concretas (fuera de la red, en
  scripts desechables) no mejora el winrate — probado con 14 cartas a
  distintas intensidades, sin ganancia neta (y claramente peor a intensidad
  alta). No repetir ese enfoque.
- Entrenar una variante en solitario (sin rivales disputando mercado) solo
  ayuda si el mercado se rellena al tamaño de una mesa real
  (`RL_SOLO_MARKET_PLAYERS`, ver `trainCoreSolo.ts`) — y aun así el resultado
  no se generaliza automáticamente entre variantes (mejoró claramente al
  especialista de aves, empeoró al generalista con la misma receta). Evaluar
  caso por caso con partidas reales antes de promover un resultado así a
  producción.

## App web (`apps/web/src`)

- `components/GameSetup.tsx` — formulario de creación de partida (edición,
  jugadores, bots, duración, animaciones, estilo de carta).
- `components/GameBoard.tsx` / `ActivePlayerBoard.tsx` / `CardView.tsx` /
  `PlayerPiles.tsx` / `FlyingCard.tsx` / `Ranking.tsx` / `ScoreCalculator.tsx`
  — tablero y componentes de partida.
- `state/useGame.ts` — estado de la partida en curso, turnos de bots
  (`resolveBot` para decidir qué IA usa cada bot).
- `lib/edition.ts`, `lib/gameConfig.ts`, `lib/botAlgorithms.ts` — selección de
  edición y algoritmo de bot, preferencias guardadas en `localStorage`.
- `lib/artStyle.tsx` — estilo de ilustración de carta (imagen real vs emoji),
  guardado por dispositivo.
- `online/` — multijugador vía Supabase Realtime (Broadcast + Presence, sin
  tablas ni autenticación). Incluye un chat entre los miembros de la partida
  (`online/useRoomChat.ts` + `components/RoomChat.tsx`): canal compartido
  `room:CODE:chat` al que se suscriben anfitrión e invitados por igual, sin
  pasar por el anfitrión; texto y reacciones rápidas, SIN historial (quien
  entra tarde o recarga no ve lo anterior), sin moderación y solo online —
  decisiones explícitas del usuario, no carencias. `supabaseClient.ts` lee `VITE_SUPABASE_URL` /
  `VITE_SUPABASE_ANON_KEY` de variables de entorno; si faltan,
  `isOnlineAvailable` es `false` y la app funciona igual en modo local (pase
  y juega + bots), simplemente ocultando "Crear partida online". Ver
  `apps/web/.env.example` para cómo crear un proyecto Supabase gratuito y
  rellenar `apps/web/.env.local` (no versionado, sin claves en el repo).

## Impresión y arte de las cartas (`img/`)

Documentación completa y siempre actualizada en `img/_work/README.md` —
léelo antes de tocar nada de esto, en vez de fiarte de un resumen. Puntos
clave:

- Todo el arte impreso se genera desde `img/_work/*.py` (Python;
  `/c/Python310/python`, no `python`/`python3` a secas) a partir de
  `packages/engine/src/cards/data/*.json` + fotos en `img/`.
- Orden de regeneración: `compose_all.py` / `compose_all_en.py` →
  `build_pdf.py` / `build_pdf_en.py` (hoja de referencia, 1 copia de cada
  carta) → `build_deck_pdf.py` / `build_deck_pdf_en.py` (mazo de impresión
  real, con recuentos por especie). "Regenerar los PDFs" significa siempre
  los 4.
- El mazo de impresión debe sumar un **múltiplo de 18** cartas (18 por
  plancha física). Se cuadra ajustando solo Plata/Oro/Platino (`COUNTS` en
  ambos `build_deck_pdf*.py`) — Bronce (49 copias) y Perezoso (21 copias)
  nunca se tocan: son el mínimo exacto para la mano inicial de 7 jugadores.
- Solo se imprime la edición clásica. La completa se puede componer aparte
  con `ZOO_EDITION=full` (a `img/cards_completa*`) pero nunca alimenta los
  PDFs de impresión.
- Añadir una especie nueva requiere tocar 3 sitios antes de que
  `compose_all.py` funcione: `ANIMAL_SPECIES`/`FULL_EDITION_EXTRA_SPECIES` en
  `engine.ts`, el diccionario `SPECIES_PHOTO` en `compose_all.py`, y una
  entrada en `CARD_TEXT_EN` (`card_text_en.py`) — si falta cualquiera de los
  tres, el build revienta o queda incompleto en silencio.

## Convenciones

- El código, datos de carta y comentarios del repo están en **castellano**.
  Los mensajes de commit siguen ese mismo idioma cuando el resto del
  historial ya lo está.
- No hay archivo `.env` con claves en el repo; `apps/web/.env.local` (fuera
  de git) es donde vive cualquier credencial real de Supabase.
- Antes de dar por bueno un cambio en el motor: `npm run test -w
  packages/engine` y `npx tsc --noEmit` en `packages/engine` y `apps/web`.
