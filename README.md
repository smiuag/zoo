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

## Añadir una carta nueva

1. Crea un archivo JSON en `packages/engine/src/cards/data/`, siguiendo el
   schema de `packages/engine/src/cards/schema.ts`.
2. Si la carta necesita un efecto nuevo (no cubierto por los handlers en
   `packages/engine/src/effects/registry.ts`), añade un handler ahí.
3. Añade o actualiza tests en `packages/engine/tests/`.
