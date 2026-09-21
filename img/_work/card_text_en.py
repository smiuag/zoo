# English translations for the print-only PDF variants (build_deck_pdf_en.py /
# build_deck_pdf_1cara_en.py). The game engine data in
# packages/engine/src/cards/data/*.json stays in Spanish (used by the web
# app) — this is a separate overlay used only when composing the English
# print deck.

HABITAT_EN = {"land": "Land", "aquatic": "Aquatic", "bird": "Flying", "pet": "Pet", "dinosaur": "Dinosaur"}

CARD_TEXT_EN = {
    "dog": ("Dogs", "When you play it, you may leave it on the table instead of sending it to your discard pile, until you shuffle your deck: while it's there, it plays itself again and repeats its ability every turn.\n+1 acorn."),
    "diplodocus": ("Diplodocus", "Costs 1 acorn less for each dinosaur you have played this turn."),
    "tyrannosaurus": ("Tyrannosaurus", "Costs 1 acorn less for each dinosaur you have played this turn.\n+4 acorns.\nEach opponent removes a LAND animal from their hand."),
    "pterodactyl": ("Pterodactyls", "Costs 1 acorn less for each dinosaur you have played this turn.\nWhen you play it, choose a dinosaur from the supply costing less than 8 and put it in your discard pile."),
    "mosasaurus": ("Mosasaurs", "Costs 1 acorn less for each dinosaur you have played this turn.\n+4 acorns.\nEach opponent removes an AQUATIC animal from their hand."),
    "chicken": ("Chickens", "Discard an acorn from your hand to capture, from the supply, a LAND or AQUATIC animal costing 2 or less, and put it in your discard pile."),
    "golden-fish": ("Golden Fish", "Swap an acorn from your hand for a gold acorn (value 3)."),
    "goose": ("Geese", "Add 1 to your capture value.\nAt the end of the game, +1 VP for each distinct pet animal in your whole collection."),
    "hamster": ("Hamsters", "When you play it, return all Hamsters from your discard pile to your hand.\n+1 acorn."),
    "hummingbird": ("Hummingbirds", "When you play it, you may leave it on the table instead of sending it to your discard pile, until you shuffle your deck: while it's there, it plays itself again every turn."),
    "iguana": ("Iguanas", "Draw 1 card."),
    "ostrich": ("Ostriches", "Choose: draw 1 card, or discard a Gold acorn (or better) and return it to its supply to get a Tyrannosaurus or a Pterodactyl from the market."),
    "otter": ("Otters", "Discard an acorn of value 2 or more from your hand to look at the top 3 cards of your deck: keep one and discard the rest."),
    "pig": ("Pigs", "Discard an acorn of value 2 or more from your hand to draw 1 card."),
    "plesiosaurus": ("Plesiosaurs", "Costs 2 acorns less for each dinosaur you have played this turn.\nWhen you play it, draw 2 cards.\nAt the end of the game, +1 VP for each dinosaur in your whole collection."),
    "pteranodon": ("Pteranodons", "Costs 1 acorn less for each dinosaur you have played this turn.\n+4 acorns.\nEach opponent removes a FLYING animal from their hand."),
    "cat": ("Cats", "When you have to remove an animal (of any type), you may discard the Cat instead of removing it."),
    "albatross": (
        "Albatross",
        "+1 acorn.\n+1 VP for each distinct animal in your deck.",
    ),
    "bat": (
        "Bats",
        "Take an acorn from your discard pile to your hand.",
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
        "Choose a LAND animal from the market, costing 5 or less, and put it in your discard pile.",
    ),
    "flamingo": (
        "Flamingos",
        "Exchange an animal from your hand for a different one costing up to 2 acorns more.",
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
        "Add 3 to your purchasing power.",
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
        "Add a copper acorn card to your hand.",
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
        "Add 3 to your purchasing power.\nAt the end of the game, +1 VP for each acorn card you have.",
    ),
    "sloth": ("Sloths", "Does nothing. Just sleeps."),
    "snake": (
        "Snakes",
        "Each opponent discards an animal from their hand.\nChoose one of the discarded animals and use its ability.",
    ),
    "spider": (
        "Spiders",
        "Choose a FLYING or AQUATIC animal from the market, costing 3 or less, and put it in your discard pile.",
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
