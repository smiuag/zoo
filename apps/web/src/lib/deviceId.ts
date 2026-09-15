// Identificador anónimo persistente de ESTE navegador (nunca de la
// persona): sin login, es lo único que permite luego "mi historial" en el
// ranking sin mezclar partidas de otro "Tú" con el mismo nick — ver
// online/gameResults.ts. Se genera una única vez y se guarda en
// localStorage, igual que el nick (ver lib/gameConfig.ts). A propósito NO
// es la IP (poco fiable tras redes compartidas/móviles, y habría que leerla
// desde un servidor) ni requiere ninguna cuenta.
const DEVICE_ID_KEY = 'zoo.deviceId';

export function getDeviceId(): string {
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_ID_KEY, fresh);
    return fresh;
  } catch {
    // Sin almacenamiento (modo privado, cuota llena...): un id de usar y
    // tirar para esta sola carga de página. No agrupará bien "mi
    // historial" entre partidas, pero no rompe nada.
    return crypto.randomUUID();
  }
}
