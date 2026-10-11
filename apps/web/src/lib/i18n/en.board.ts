// Traducciones al inglés (clave = texto en castellano tal como aparece en el código).
// Zona: tablero de partida (GameBoard, ActivePlayerBoard, PlayerPiles, CardView,
// pendingChoice, actionQuery, cardVisuals).
export const en_board: Record<string, string> = {
  // Estado de la partida / barra de turno
  'efecto': 'effect',
  'Elimina': 'Remove',
  'Entrega': 'Hand over',
  'Descarta': 'Discard',
  'carta': 'card',
  'cartas': 'cards',
  'Partida terminada': 'Game over',
  'Ronda {round}/{max}': 'Round {round}/{max}',
  'turno de {name}': "{name}'s turn",
  '¡último turno!': 'last turn!',
  '🏁 ¡Último turno! Cuando lo termines, se acaba la partida.': '🏁 Last turn! When you finish it, the game ends.',
  'Cerrar aviso': 'Close notice',
  'Terminar turno': 'End turn',
  'Reiniciar turno': 'Restart turn',
  'Enciclopedia de cartas': 'Card encyclopedia',
  'Cartas': 'Cards',
  'Nueva partida': 'New game',
  'Valor de compra de {name}: {available} disponibles; {total} en total este turno contando lo ya gastado':
    "{name}'s buying power: {available} available; {total} in total this turn, counting what has already been spent",
  'Valor de compra': 'Buying power',

  // Marcador y puntos
  'PV': 'VP',
  '{count}× {pv} PV': '{count}× {pv} VP',
  '{pv} PV': '{pv} VP',
  '{n}PV': '{n}VP',
  'ver mazo': 'view deck',
  'mazo privado hasta que termine la partida': 'deck is private until the game ends',

  // Mano y mesa
  'Tu mano': 'Your hand',
  '{n} en el mazo': '{n} in the deck',
  '{n} en el descarte': '{n} in the discard pile',
  '{n} sobre la mesa': '{n} on the table',
  'Mesa de {name}': "{name}'s table",
  'Jugado este turno': 'Played this turn',
  '(nada todavía)': '(nothing yet)',
  'Mazo de {name}': "{name}'s deck",
  'Descarte de {name}': "{name}'s discard pile",

  // Resumen final
  'Resumen de la partida': 'Game summary',
  'Empate entre {names} con {pv} PV.': 'Tie between {names} with {pv} VP.',
  'y': 'and',
  '{name} gana con {pv} PV.': '{name} wins with {pv} VP.',
  'Jugador': 'Player',
  'Valor baraja': 'Deck value',
  'Compras': 'Purchases',
  'Terrestres': 'Land',
  'Voladores': 'Flying',
  'Acuáticos': 'Aquatic',
  'Turno con más dinero': 'Richest turn',
  'Ronda {round} · {amount} {currency}': 'Round {round} · {amount} {currency}',
  'Ver mazo →': 'View deck →',

  // Repetir partida
  '¿Repetir con la misma configuración?': 'Play again with the same settings?',
  'Cancelar': 'Cancel',
  'Sí, repetir': 'Yes, play again',
  'Repetir partida': 'Play again',
  'Algún invitado se ha desconectado': 'A guest has disconnected',
  'Esperando a los demás para repetir ({n}/{total})...': 'Waiting for the others to play again ({n}/{total})...',
  '{name} propone repetir la partida ({n}/{total} aceptado)': '{name} proposes playing again ({n}/{total} accepted)',
  'Rechazar': 'Decline',
  'Aceptar': 'Accept',
  'Volver a la sala de espera para cambiar modo o configuración, sin perder a los invitados':
    'Go back to the waiting room to change the mode or settings without losing the guests',
  'Cambiar modo': 'Change mode',

  // Paneles
  '✕ cancelar': '✕ cancel',
  'Ver log de la partida': 'View game log',
  'Bots': 'Bots',
  'mano: {n}': 'hand: {n}',
  'descarte: {n}': 'discard: {n}',
  'mesa: {n}': 'table: {n}',
  'Genérico': 'Generic',
  'Terrestre': 'Land',
  'Volador': 'Flying',
  'Acuático': 'Aquatic',

  // Descarte forzoso
  '{name} ha jugado': '{name} played',
  'tienes que': 'you must',
  'eliminar de la partida': 'remove from the game',
  'darle a {name}': 'give {name}',
  'descartar': 'discard',
  'una carta': 'a card',
  '{n} cartas': '{n} cards',
  'de las que tienes sobre la mesa': 'from those you have on the table',
  'de tu mano o de tu mesa': 'from your hand or your table',
  'de tu mano': 'from your hand',
  'Elige cuál.': 'Choose which one.',
  'Elige cuáles.': 'Choose which ones.',
  'Truco:': 'Tip:',
  'descartar tu {animal} cubre toda la entrega él solo.': 'discarding your {animal} covers the whole hand-over by itself.',
  'sobre la mesa': 'on the table',
  'No encuentro ninguna carta que puedas entregar, así que no hay nada que elegir. Esto no debería pasar: si lo ves, cuéntamelo con una captura.':
    "I can't find any card you can hand over, so there is nothing to choose. This shouldn't happen: if you see it, please tell me with a screenshot.",

  // Serpiente
  'Elige una habilidad': 'Choose an ability',
  'Tu': 'Your',
  'hizo que cada jugador descartara un animal.': 'made each player discard an animal.',
  'Elige uno de ellos para usar su habilidad como si lo hubieras jugado tú (se queda donde está, en el descarte de quien lo entregó).':
    'Choose one of them to use its ability as if you had played it yourself (it stays where it is, in the discard pile of the player who handed it over).',

  // Confirmación de fin de turno
  '¿Terminar turno?': 'End turn?',
  'Todavía tienes animales por jugar o dinero por gastar. ¿Seguro que quieres terminar el turno?':
    'You still have animals to play or money to spend. Are you sure you want to end your turn?',
  'Sí, terminar turno': 'Yes, end turn',

  // Mazo de un jugador
  'Mazo de {name} · {n} cartas · {pv} PV': "{name}'s deck · {n} cards · {pv} VP",
  '✕ cerrar': '✕ close',
  'Eliminadas ({n}, fuera de la colección para siempre — no puntúan)':
    'Removed ({n}, out of the collection for good — they do not score)',

  // Carta
  'vale {n}': 'worth {n}',
  'Eliminada de la partida': 'Removed from the game',
  'Incluida': 'Included',
  'Todoterreno': 'All-terrain',
  'Mascota': 'Pet',
  'Dinosaurio': 'Dinosaur',
  'bellota': 'acorn',
  'bellotas': 'acorns',
  'moneda': 'coin',
  'monedas': 'coins',

  // Menús de elección (pendingChoice / actionQuery)
  'Dejarlo sobre la mesa': 'Leave it on the table',
  'Enviarlo al descarte': 'Send it to the discard pile',
  '{card}: ¿dónde lo dejas?': '{card}: where do you put it?',
  '{card}: ¿a qué jugador afecta?': '{card}: which player does it affect?',
  'Robar {n} carta (no transformarla)': 'Draw {n} card (do not transform it)',
  'Robar {n} cartas (no transformarla)': 'Draw {n} cards (do not transform it)',
  '¿Qué animal coges a cambio de {label}?': 'Which animal do you take in exchange for {label}?',
  '{card}: elige el objetivo': '{card}: choose the target',
};
