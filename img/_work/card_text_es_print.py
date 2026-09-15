# Texto en español SOLO para el mazo impreso (compose_all.py), donde las
# cartas de coste de compra se llaman "bellota" por tema. El texto de
# packages/engine/src/cards/data/*.json (usado por la app web) sigue
# llamándolo "moneda"/"valor de captura" (pedido explícito del usuario,
# 2026-09-14: mantener "moneda" en la app, "bellota" solo en los PDFs). Solo
# hace falta una entrada aquí para las cartas donde el texto difiere del
# JSON — el resto de compose_all.py sigue leyendo card["text"] tal cual.
CARD_TEXT_ES_PRINT = {
    "albatross": "+1 bellota.\n+1PV por cada especie distinta que tengas en todo tu mazo.",
    "bat": "Coge una bellota de tu descarte a tu mano.",
    "coin-1": "+1 bellota.",
    "coin-2": "+2 bellotas.",
    "coin-3": "+3 bellotas.",
    "coin-5": "+5 bellotas.",
    "dolphin": "+1 bellota por cada animal acuático que tengas en tu mano.",
    "duck": "Elige un jugador: te da una carta de bellota. Si no tiene, muestra su mano.",
    "eagle": "+2 bellotas.\n+1PV por cada animal volador que tengas en todo tu mazo.",
    "flamingo": "Intercambia un animal de tu mano, por uno distinto que cueste hasta 2 bellotas más.",
    "lion": "+3 bellotas.",
    "monkey": "+1 bellota por cada animal terrestre que tengas en tu mano.",
    "orca": "+2 bellotas.\n+1PV por cada animal acuático que tengas en todo tu mazo.",
    "owl": "+1 bellota.\nRoba una carta.",
    "parrot": "+1 bellota por cada animal volador que tengas en tu mano.",
    "penguin": "Añade una carta de bellota de cobre a tu mano.",
    "platypus": "+1 bellota por cada animal distinto que tengas en tu mano.",
    "polar-bear": "+2 bellotas.\n+1PV por cada animal terrestre que tengas en todo tu mazo.",
    "raven": "+1 bellota por cada carta de bellota en tu mano.",
    "seal": "+3 bellotas, pero solo puedes usarlas para capturar animales acuáticos.",
    "shark": "+3 bellotas.\nAl final de la partida, +1PV por cada carta de bellota que tengas.",
    "squirrel": "+1 bellota.\nAl empezar tu turno, si tienes 1 o más ardillas en tu descarte, pon una de ellas en tu mano.",
    "turtle": "Mejora una bellota de tu mano por otra de un nivel superior",
}
