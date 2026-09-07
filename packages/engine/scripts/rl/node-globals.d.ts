// Tipos ambientales mínimos para las pocas APIs de Node que usa el script de
// entrenamiento (leer/escribir weights.json, resolver su ruta, leer
// hiperparámetros de env vars). Evita añadir @types/node como dependencia
// solo para este script de desarrollo que no forma parte del motor ni de la
// app: vite-node lo ejecuta igualmente sin estas declaraciones, son solo
// para que `tsc`/el editor no se quejen.
declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: 'utf-8'): string;
  export function writeFileSync(path: string, data: string): void;
}

declare module 'node:url' {
  export function fileURLToPath(url: URL): string;
}

declare const process: { env: Record<string, string | undefined> };
