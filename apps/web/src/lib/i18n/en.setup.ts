// Traducciones al inglés (clave = texto en castellano tal como aparece en el código).
// Formulario de creación de partida, configuración, selector de bots/edición.
export const en_setup: Record<string, string> = {
  // GameSetup
  'Idioma': 'Language',
  'Jugador {n}': 'Player {n}',
  'Es tu idioma: cada jugador elige el suyo (online, al unirse; en este dispositivo, con el botón de idioma durante la partida).':
    'This is your language: each player picks their own (online, when joining; on this device, with the language button during the game).',
  '🌐 Partida online sin terminar': '🌐 Unfinished online game',
  'Parece que refrescaste la página a mitad de la sala': 'It looks like you refreshed the page in the middle of room',
  'Puedes seguir donde lo dejaste, con los mismos enlaces ya repartidos.':
    'You can pick up where you left off, with the same links already handed out.',
  '▶ Reanudar partida': '▶ Resume game',
  'Descartar': 'Discard',
  'Nueva partida': 'New game',
  'Configuración de la partida': 'Game settings',
  'Configuración': 'Settings',
  'Tu nick': 'Your nickname',
  'Tú': 'You',
  'Hasta {n} letras, para que el marcador quepa en el móvil. Se recuerda en este dispositivo.':
    'Up to {n} letters, so the scoreboard fits on a phone. Remembered on this device.',
  'Jugadores humanos': 'Human players',
  'Turno rotatorio en este mismo dispositivo: el indicador de turno siempre muestra a quién le toca.':
    'Players take turns on this same device: the turn indicator always shows whose turn it is.',
  'Empezar partida': 'Start game',
  '🌐 Crear partida online': '🌐 Create online game',
  'Con 1 solo jugador humano hace falta al menos 1 bot rival: sube el número de bots o de jugadores.':
    'With only 1 human player you need at least 1 rival bot: raise the number of bots or players.',
  'Elige al menos una especie en Configuración → Personalizado antes de empezar.':
    'Pick at least one species in Settings → Custom before starting.',
  'No configurada en este despliegue (falta VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY).':
    'Not set up in this deployment (VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY missing).',
  '🌰 Calculadora': '🌰 Calculator',
  '🏆 Ranking': '🏆 Ranking',
  '📖 Cartas': '📖 Cards',

  // GameConfigFields
  'Número de bots': 'Number of bots',
  'Bot {n}': 'Bot {n}',
  '{n} rondas': '{n} rounds',
  'Aprendizaje': 'Learning',
  'Clásica': 'Classic',
  'Personalizado': 'Custom',
  'Mismo mazo clásico de siempre, pero el mercado solo ofrece animales de coste {n} o menos: partidas más sencillas y rápidas para aprender.':
    'The usual classic deck, but the market only offers animals costing {n} or less: simpler, faster games to learn with.',
  'Elige tú qué especies entran en el mercado y cuántas copias hay de cada una, desde ⚙️ Configuración.':
    'You choose which species go in the market and how many copies of each there are, from ⚙️ Settings.',
  'La oficial: 33 especies, sin restricciones.': 'The official one: 33 species, no restrictions.',
  '🎓 Ver tutorial': '🎓 View tutorial',

  // BOT_ALGORITHM_OPTIONS
  'Genérico': 'Generic',
  'Terrestre': 'Land',
  'Volador': 'Flying',
  'Acuático': 'Aquatic',

  // GameSettingsModal
  '⚙️ Configuración': '⚙️ Settings',
  '✕ cerrar': '✕ close',
  '🖼️ Imagen': '🖼️ Image',
  '🐯 Emoji': '🐯 Emoji',
  'Con animaciones': 'With animations',
  'Sin animaciones': 'No animations',
  'Se usa cuando eliges la edición Personalizado en la pantalla principal: elige qué especies entran en el mercado y cuántas copias hay de cada una.':
    'Used when you pick the Custom edition on the main screen: choose which species go in the market and how many copies of each there are.',
  'Copias extra respecto al nº de jugadores': 'Extra copies relative to the number of players',
  'Coste menor a 5': 'Cost under 5',
  'Coste 5 o mayor': 'Cost 5 or more',
  'Random': 'Random',
  '{n} especies al azar': '{n} random species',
  'Completo': 'Full',
  'Todas las especies': 'All species',
  'Reducido': 'Reduced',
  'Versión reducida compensada': 'Balanced reduced version',
  '{n} especies marcadas de {total}.': '{n} of {total} species selected.',
  'Coste 1-2': 'Cost 1-2',
  'Coste 3': 'Cost 3',
  'Coste 4': 'Cost 4',
  'Coste 5-7': 'Cost 5-7',
  'Coste 8 o más': 'Cost 8 or more',
};
