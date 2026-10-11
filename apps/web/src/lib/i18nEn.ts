import { en_board } from './i18n/en.board';
import { en_misc } from './i18n/en.misc';
import { en_online } from './i18n/en.online';
import { en_setup } from './i18n/en.setup';
import { en_tutorial } from './i18n/en.tutorial';

// Diccionario castellano -> inglés de toda la interfaz. La clave es el texto
// EXACTO en castellano que se pasa a t()/tr() (con sus {marcadores}); está
// repartido por zonas en lib/i18n/ para que sea manejable.
export const EN: Record<string, string> = {
  ...en_setup,
  ...en_board,
  ...en_online,
  ...en_misc,
  ...en_tutorial,
};
