import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Volcado de la partida en curso a un archivo en disco (solo en `vite dev`,
// nunca en el build de producción): así, después de que el usuario juegue
// en su navegador, se puede releer esta partida entera (turno a turno, con
// el bot y algoritmo responsable de cada acción) sin depender de la consola
// del navegador, que no persiste entre sesiones.
const GAME_LOG_PATH = path.resolve(__dirname, 'game.log');

function gameLogPlugin(): Plugin {
  return {
    name: 'game-log-writer',
    configureServer(server) {
      server.middlewares.use('/__game-log', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          try {
            const payload = JSON.parse(body) as { lines?: string[]; clear?: boolean };
            if (payload.clear) fs.writeFileSync(GAME_LOG_PATH, '');
            if (payload.lines?.length) fs.appendFileSync(GAME_LOG_PATH, payload.lines.join('\n') + '\n');
          } catch {
            // Ayuda de depuración best-effort: un payload malformado no debe
            // romper la partida real.
          }
          res.statusCode = 204;
          res.end();
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), gameLogPlugin()],
});
