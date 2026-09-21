// Texto alternativo para el modo imagen (ver artStyle.tsx): mismo contenido
// que img/_work/card_text_es_print.py (el pipeline de impresión, donde las
// cartas de coste de compra se llaman "bellota" por tema) — portado aquí
// para que la web hable también de "bellota"/"valor de captura en bellotas"
// en vez de "moneda" cuando se ven las ilustraciones reales, pedido
// explícito del usuario 2026-09-21 ("cuando funcione con imágenes los
// textos y acciones deben hablar de bellotas"). Solo hace falta una entrada
// aquí para las cartas cuyo texto (packages/engine/src/cards/data/*.json)
// menciona "moneda"/"valor de captura" — el resto de CardView.tsx sigue
// leyendo card.text tal cual, igual que compose_all.py.
// MANTENER EN SINCRONÍA con card_text_es_print.py: normalmente coinciden
// letra a letra; si diverge, debe ser por algo específico de un medio (p.
// ej. el pipeline de impresión nunca compone la edición completa, así que
// una carta full-only solo necesita estar aquí, no allí, hasta que también
// se imprima).
export const BELLOTA_TEXT: Record<string, string> = {
  tyrannosaurus:
    'Cuesta 1 bellota menos por cada dinosaurio que hayas jugado este turno.\n+4 bellotas.\nCada oponente elimina un animal terrestre de su mano.',
  pterodactyl:
    'Cuesta 1 bellota menos por cada dinosaurio que hayas jugado este turno.\n+4 bellotas.\nCada oponente elimina un animal volador de su mano.',
  mosasaurus:
    'Cuesta 1 bellota menos por cada dinosaurio que hayas jugado este turno.\n+4 bellotas.\nCada oponente elimina un animal acuático de su mano.',
  diplodocus:
    'Cuesta 1 bellota menos por cada dinosaurio que hayas jugado este turno.\n+5 bellotas, pero solo puedes usarlas para comprar dinosaurios.',
  plesiosaurus:
    'Cuesta 2 bellotas menos por cada dinosaurio que hayas jugado este turno.\nAl jugarlo, roba 2 cartas.\nAl final de la partida, +1PV por cada dinosaurio que tengas en toda tu colección.',
  pteranodon:
    'Cuesta 1 bellota menos por cada dinosaurio que hayas jugado este turno.\nAl jugarlo, elige un dinosaurio de la reserva de coste inferior a 8 y ponlo en tu descarte.',
  dog: 'Al jugarlo, puedes dejarlo sobre la mesa en vez de enviarlo al descarte, hasta que barajes tu mazo.\n+1 bellota.',
  hamster: 'Al jugarlo, devuelve a tu mano todos los hámsteres de tu descarte.\n+1 bellota.',
  chicken:
    'Al jugarla, puedes dejarla sobre la mesa en vez de enviarla al descarte, hasta que barajes tu mazo.\nDescarta una bellota de tu mano para capturar, de la reserva, un animal terrestre o acuático de coste 2 o menos y ponlo en tu descarte.',
  'golden-fish': 'Cambia una bellota de tu mano por una bellota de oro (valor 3).',
  otter: 'Descarta una bellota de tu mano de valor 2 o más para mirar las 3 cartas superiores de tu mazo: quédate una y descarta el resto.',
  pig: 'Descarta una bellota de tu mano de valor 2 o más para robar una carta.',
  goose: 'Añade 1 bellota.\nAl final de la partida, +1PV por cada animal doméstico distinto que tengas en toda tu colección.',
  albatross: '+1 bellota.\n+1PV por cada especie distinta que tengas en todo tu mazo.',
  bat: 'Coge una bellota de tu descarte a tu mano.',
  'coin-1': '+1 bellota.',
  'coin-2': '+2 bellotas.',
  'coin-3': '+3 bellotas.',
  'coin-5': '+5 bellotas.',
  dolphin: '+1 bellota por cada animal acuático que tengas en tu mano.',
  duck: 'Elige un jugador: te da una carta de bellota. Si no tiene, muestra su mano.',
  eagle: '+2 bellotas.\n+1PV por cada animal volador que tengas en todo tu mazo.',
  flamingo: 'Intercambia un animal de tu mano, por uno distinto que cueste hasta 2 bellotas más.',
  lion: '+3 bellotas.',
  monkey: '+1 bellota por cada animal terrestre que tengas en tu mano.',
  orca: '+2 bellotas.\n+1PV por cada animal acuático que tengas en todo tu mazo.',
  owl: '+1 bellota.\nRoba una carta.',
  parrot: '+1 bellota por cada animal volador que tengas en tu mano.',
  penguin: 'Añade una carta de bellota de cobre a tu mano.',
  platypus: '+1 bellota por cada animal distinto que tengas en tu mano.',
  'polar-bear': '+2 bellotas.\n+1PV por cada animal terrestre que tengas en todo tu mazo.',
  raven: '+1 bellota por cada carta de bellota en tu mano.',
  seal: '+3 bellotas, pero solo puedes usarlas para capturar animales acuáticos.',
  shark: '+3 bellotas.\nAl final de la partida, +1PV por cada carta de bellota que tengas.',
  squirrel: '+1 bellota.\nAl empezar tu turno, si tienes 1 o más ardillas en tu descarte, pon una de ellas en tu mano.',
  turtle: 'Mejora una bellota de tu mano por otra de un nivel superior.',
};
