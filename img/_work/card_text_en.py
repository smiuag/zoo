# English translations for the print-only PDF variants (build_deck_pdf_en.py /
# build_deck_pdf_1cara_en.py). The game engine data in
# packages/engine/src/cards/data/*.json stays in Spanish (used by the web
# app) — this is a separate overlay used only when composing the English
# print deck.

HABITAT_EN = {"land": "Land", "aquatic": "Aquatic", "bird": "Flying"}

CARD_TEXT_EN = {
    "albatross": (
        "Albatross",
        "+1 acorn.\n+1 VP for each distinct animal in your deck.",
    ),
    "bat": (
        "Bats",
        "Discard to prevent a Lion, Hawk or Shark from eliminating a card from your hand.",
    ),
    "coin-1": ("Bronze", "+1 acorn."),
    "coin-2": ("Silver", "+2 acorns."),
    "coin-3": ("Gold", "+3 acorns."),
    "coin-5": ("Platinum", "+5 acorns."),
    "crocodile": (
        "Crocodiles",
        "Draw 1 card.\nAt the end of the game, before scoring, remove one non-flying animal card from your collection.",
    ),
    "dolphin": (
        "Dolphins",
        "+1 acorn for each aquatic animal in your hand.",
    ),
    "duck": (
        "Ducks",
        "Choose a player: they give you an acorn card. If they have none, they reveal their hand.",
    ),
    "eagle": (
        "Eagles",
        "+2 acorns.\n+1 VP for each flying animal in your whole deck.",
    ),
    "elephant": (
        "Elephants",
        "Capture for free (without spending coins) the LAND animal of your choice from the market, costing 5 or less.",
    ),
    "flamingo": (
        "Flamingos",
        "Exchange an animal from your hand for a different one costing up to 2 coins more.",
    ),
    "giraffe": (
        "Giraffes",
        "Retrieve an animal from your discard pile to your hand.",
    ),
    "goldfish": (
        "Goldfish",
        "Counts as 2 aquatic animals.",
    ),
    "hippopotamus": ("Hippos", "Draw 2 cards."),
    "hyena": (
        "Hyenas",
        "Each opponent reveals their hand and discards their highest-cost animal.",
    ),
    "lion": (
        "Lions",
        "Eliminate a land animal costing 3 or less from each opponent's hand.\n+1 acorn for each one.\n+1 VP for each eliminated animal.",
    ),
    "hawk": (
        "Hawks",
        "Eliminate a flying animal costing 3 or less from each opponent's hand.\n+1 acorn for each one.\n+1 VP for each eliminated animal.",
    ),
    "monkey": (
        "Monkeys",
        "+1 acorn for each land animal in your hand.",
    ),
    "orca": (
        "Orcas",
        "+2 acorns.\n+1 VP for each aquatic animal in your whole deck.",
    ),
    "owl": ("Owls", "+1 acorn.\nDraw 1 card."),
    "parakeet": (
        "Parakeets",
        "Counts as 2 flying animals.",
    ),
    "parrot": (
        "Parrots",
        "+1 acorn for each flying animal in your hand.",
    ),
    "peacock": ("Peacocks", "Draw 1 card."),
    "penguin": (
        "Penguins",
        "Add a silver acorn card to your hand.",
    ),
    "raven": (
        "Ravens",
        "+1 acorn for each acorn card in your hand.",
    ),
    "platypus": (
        "Platypuses",
        "+1 acorn for each distinct animal in your hand.",
    ),
    "polar-bear": (
        "Polar Bears",
        "+2 acorns.\n+1 VP for each land animal in your whole deck.",
    ),
    "rabbit": (
        "Rabbits",
        "Reveal the top card of your deck. If it isn't an animal costing more than 2, add it to your hand.",
    ),
    "seal": (
        "Seals",
        "+3 acorns, but you can only spend them on aquatic animals.",
    ),
    "shark": (
        "Sharks",
        "Eliminate an aquatic animal costing 3 or less from each opponent's hand.\n+1 acorn for each one.\n+1 VP for each eliminated animal.",
    ),
    "sloth": ("Sloths", "Does nothing. Just sleeps."),
    "snake": (
        "Snakes",
        "Each opponent chooses and discards 1 card from their hand.\nDraw 1 card for each coin discarded this way.",
    ),
    "spider": (
        "Spiders",
        "Capture for free (without spending coins) the FLYING or AQUATIC animal of your choice from the market, costing 3 or less.",
    ),
    "squirrel": (
        "Squirrels",
        "+1 acorn.\nAt the start of your turn, if you have 1 or more Squirrels in your discard pile, put one in your hand.",
    ),
    "tiger": (
        "Tigers",
        "Draw 2 cards.\nThen put 1 card from your hand on top of your deck.",
    ),
    "toucan": (
        "Toucans",
        "Draw 1 card.\n+1 VP for each animal costing 5 or more in your whole deck.",
    ),
    "turtle": (
        "Turtles",
        "Upgrade an acorn in your hand for one of the next tier.",
    ),
    "vulture": (
        "Vultures",
        "Each opponent chooses and discards 2 cards from their hand.",
    ),
}
