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
  export function renameSync(oldPath: string, newPath: string): void;
}

declare module 'node:url' {
  export function fileURLToPath(url: URL): string;
}

// Solo lo que usan selfPlay.ts (orquestador) y worker.ts (proceso worker)
// para el paralelismo de simulación (ver WORKER_COUNT en selfPlay.ts):
// lanzar procesos worker de larga duración y hablar con ellos línea a línea
// por stdin/stdout.
declare module 'node:child_process' {
  interface ChildProcessWithoutNullStreams {
    stdin: { write(data: string): void; end(): void };
    stdout: unknown;
    kill(): void;
    on(event: 'exit', listener: (code: number | null, signal: string | null) => void): void;
  }
  interface SpawnOptions {
    cwd?: string;
    env?: Record<string, string | undefined>;
    stdio?: string[];
  }
  export function spawn(command: string, args: string[], options: SpawnOptions): ChildProcessWithoutNullStreams;
  export type { ChildProcessWithoutNullStreams };
}

declare module 'node:readline' {
  interface Interface {
    on(event: 'line', listener: (line: string) => void): void;
  }
  export function createInterface(options: { input: unknown }): Interface;
}

declare const process: {
  env: Record<string, string | undefined>;
  argv: string[];
  pid: number;
  execPath: string;
  stdin: unknown;
  stdout: { write(data: string): void };
};
