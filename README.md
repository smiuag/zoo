# Zoo Deckbuilder

Juego de cartas tipo deckbuilder ambientado en un zoo. Este repo contiene el
motor del juego, sus tests y una app web para jugar contra un bot.

## Estructura

- `packages/engine` — motor del juego (TypeScript puro, sin UI). Las cartas
  se definen como datos en `packages/engine/src/cards/data/*.json` y se
  validan contra un schema al cargarlas.
- `apps/web` — interfaz web (Vite + React) para jugar una partida contra un
  bot y probar las cartas visualmente.
- `tools/print` — (futuro) generación de las imágenes de las cartas para
  imprimir.

## Uso

```bash
npm install

# tests del motor
npm test

# app web en localhost
npm run dev:web
```

## Jugar online (opcional)

`apps/web` puede alojar partidas con varios jugadores en dispositivos
distintos, sin que nadie tenga que registrarse en nada (todo vía enlaces de
invitación) y sin coste. Requiere una configuración de una sola vez:

1. Crea un proyecto gratis en [supabase.com](https://supabase.com) (no hace
   falta tarjeta, ni crear ninguna tabla, ni activar autenticación — solo se
   usa Realtime, que viene activado por defecto).
2. Copia `apps/web/.env.example` a `apps/web/.env.local` y rellena
   `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (Ajustes del proyecto → API).
3. `npm run dev:web` y, en el formulario de nueva partida, con 2+ jugadores
   humanos configurados, aparece el botón "Crear partida online": genera un
   enlace de invitación por cada jugador adicional para compartir por chat.

Sin esas variables de entorno, la app sigue funcionando igual en local
(pase-y-juega + bots); el botón de partida online simplemente se oculta.

Para jugar por internet (no solo en la misma red local) hace falta además
desplegar `apps/web` en algún sitio — por ejemplo [Vercel](https://vercel.com)
(plan gratuito, conectando este repo): es un build de Vite estándar, sin
configuración especial.

## Añadir una carta nueva

1. Crea un archivo JSON en `packages/engine/src/cards/data/`, siguiendo el
   schema de `packages/engine/src/cards/schema.ts`.
2. Si la carta necesita un efecto nuevo (no cubierto por los handlers en
   `packages/engine/src/effects/registry.ts`), añade un handler ahí.
3. Añade o actualiza tests en `packages/engine/tests/`.
