import { describe, expect, it } from 'vitest';
import { getAllCards, getCard } from '../src/cards/registry';

const SPECIES_TIERS: Record<string, { cost: number; pv: number }> = {
  goldfish: { cost: 1, pv: 1 },
  snake: { cost: 4, pv: 1 },
  parrot: { cost: 3, pv: 2 },
  penguin: { cost: 4, pv: 2 },
  peacock: { cost: 2, pv: 1 },
  dolphin: { cost: 3, pv: 2 },
  giraffe: { cost: 3, pv: 3 },
  hippopotamus: { cost: 5, pv: 4 },
  tiger: { cost: 4, pv: 3 },
  lion: { cost: 5, pv: 3 },
  monkey: { cost: 4, pv: 2 },
  spider: { cost: 3, pv: 3 },
  crocodile: { cost: 5, pv: 7 },
  vulture: { cost: 5, pv: 3 },
  elephant: { cost: 5, pv: 3 },
  orca: { cost: 6, pv: 2 },
  albatross: { cost: 6, pv: 2 },
  hyena: { cost: 4, pv: 5 },
  'polar-bear': { cost: 7, pv: 0 },
  duck: { cost: 2, pv: 1 },
  flamingo: { cost: 3, pv: 1 },
  seal: { cost: 3, pv: 2 },
  parakeet: { cost: 2, pv: 0 },
  owl: { cost: 4, pv: 3 },
  bat: { cost: 1, pv: 1 },
  turtle: { cost: 2, pv: 1 },
  platypus: { cost: 3, pv: 2 },
  rabbit: { cost: 2, pv: 2 },
  eagle: { cost: 5, pv: 0 },
};

describe('card registry', () => {
  it('carga y valida todos los ficheros de datos de cartas', () => {
    const cards = getAllCards();
    // 29 especies de mercado + 1 Perezoso (solo de mazo inicial) + 3 monedas = 33.
    expect(cards.length).toBe(33);
  });

  it('el Perezoso es terrestre, no cuesta ni da nada, y no está en el mercado de animales', () => {
    const sloth = getCard('sloth');
    expect(sloth.type).toBe('animal');
    expect(sloth.habitats).toEqual(['land']);
    expect(sloth.marketCost).toBe(0);
    expect(sloth.victoryPoints).toBe(0);
    expect(sloth.effects).toHaveLength(0);
  });

  it('expone las 3 monedas (1/2/3) sin efectos; cobre 0PV, plata 1PV, oro 2PV', () => {
    const expectedPv: Record<number, number> = { 1: 0, 2: 1, 3: 2 };
    for (const value of [1, 2, 3]) {
      const coin = getCard(`coin-${value}`);
      expect(coin.type).toBe('coin');
      expect(coin.value).toBe(value);
      expect(coin.victoryPoints).toBe(expectedPv[value]);
      expect(coin.effects).toHaveLength(0);
    }
  });

  it('coin-2 y coin-3 se pueden comprar (3 y 5); coin-1 no', () => {
    expect(getCard('coin-1').marketCost).toBe(0);
    expect(getCard('coin-2').marketCost).toBe(3);
    expect(getCard('coin-3').marketCost).toBe(5);
  });

  it('expone las 29 especies de animal (1 carta cada una, sin sexo) con su coste/PV según tabla', () => {
    const species = Object.keys(SPECIES_TIERS);
    expect(species).toHaveLength(29);
    for (const id of species) {
      const card = getCard(id);
      expect(card.type).toBe('animal');
      expect(card.species).toBe(id);
      expect(card.marketCost).toBe(SPECIES_TIERS[id].cost);
      expect(card.victoryPoints).toBe(SPECIES_TIERS[id].pv);
    }
  });

  it('cada especie con habilidad la tiene registrada; las mudas no tienen efectos', () => {
    expect(getCard('monkey').effects[0]).toMatchObject({ type: 'discardFromEachOpponentAndDrawPerCoin' });
    expect(getCard('vulture').effects[0]).toMatchObject({
      type: 'chooseDiscardFromEachOpponent',
      params: { amount: 2 },
    });
    expect(getCard('penguin').effects[0]).toMatchObject({
      trigger: 'onPlay',
      type: 'gainFlatBonusPurchasingPower',
      params: { amount: 1 },
    });
    expect(getCard('penguin').effects[1]).toMatchObject({ trigger: 'onScore', type: 'scorePerDistinctSpecies' });
    expect(getCard('peacock').effects[0]).toMatchObject({ type: 'drawCards', params: { amount: 1 } });
    expect(getCard('hippopotamus').effects[0]).toMatchObject({ type: 'drawCards', params: { amount: 2 } });
    expect(getCard('lion').effects[0]).toMatchObject({
      type: 'gainFlatBonusPurchasingPower',
      params: { amount: 3 },
    });
    expect(getCard('tiger').effects[0]).toMatchObject({ type: 'drawThenTopdeck' });
    expect(getCard('dolphin').effects[0]).toMatchObject({
      type: 'gainAquaticOnlyBonusPurchasingPower',
      params: { amount: 2 },
    });
    expect(getCard('elephant').effects[0]).toMatchObject({
      type: 'freeCaptureUpToCost',
      params: { habitat: 'land', maxCost: 5 },
    });
    expect(getCard('giraffe').effects[0]).toMatchObject({ type: 'topdeckSlothForChosenPlayer' });
    expect(getCard('giraffe').effects[1]).toMatchObject({
      type: 'gainFlatBonusPurchasingPower',
      params: { amount: 1 },
    });
    expect(getCard('turtle').effects[0]).toMatchObject({ type: 'upgradeCoin' });
    expect(getCard('spider').effects[0]).toMatchObject({
      type: 'freeCaptureUpToCost',
      params: { habitat: ['bird', 'aquatic'], maxCost: 3 },
    });
    expect(getCard('hyena').effects[0]).toMatchObject({ type: 'discardAnimalFromEachOpponent' });
    expect(getCard('crocodile').effects[0]).toMatchObject({
      trigger: 'onPlay',
      type: 'gainFlatBonusPurchasingPower',
      params: { amount: 1 },
    });
    expect(getCard('crocodile').effects[1]).toMatchObject({
      trigger: 'onScore',
      type: 'destroyWeakestNonFlyingOnScore',
    });
    expect(getCard('orca').effects[0]).toMatchObject({
      trigger: 'onPlay',
      type: 'gainFlatBonusPurchasingPower',
      params: { amount: 2 },
    });
    expect(getCard('orca').effects[1]).toMatchObject({
      trigger: 'onScore',
      type: 'scorePerHabitatCount',
      params: { habitat: 'aquatic' },
    });
    expect(getCard('polar-bear').effects[0]).toMatchObject({
      trigger: 'onPlay',
      type: 'gainFlatBonusPurchasingPower',
      params: { amount: 2 },
    });
    expect(getCard('polar-bear').effects[1]).toMatchObject({
      trigger: 'onScore',
      type: 'scorePerHabitatCount',
      params: { habitat: 'land' },
    });
    expect(getCard('albatross').effects[0]).toMatchObject({
      trigger: 'onPlay',
      type: 'gainFlatBonusPurchasingPower',
      params: { amount: 2 },
    });
    expect(getCard('albatross').effects[1]).toMatchObject({
      trigger: 'onScore',
      type: 'scorePerHabitatCount',
      params: { habitat: 'bird' },
    });

    expect(getCard('seal').effects[0]).toMatchObject({
      type: 'gainBonusPurchasingPowerPerHabitatInHand',
      params: { habitat: 'aquatic' },
    });
    expect(getCard('goldfish').effects).toHaveLength(0);
    expect(getCard('snake').effects[0]).toMatchObject({
      type: 'gainBonusPurchasingPowerPerHabitatInHand',
      params: { habitat: 'land' },
    });
    expect(getCard('parrot').effects[0]).toMatchObject({
      type: 'gainBonusPurchasingPowerPerHabitatInHand',
      params: { habitat: 'bird' },
    });
    expect(getCard('duck').effects[0]).toMatchObject({ type: 'stealCoinFromChosenPlayer' });
    expect(getCard('flamingo').effects[0]).toMatchObject({ type: 'returnAnimalForUpgrade' });
    expect(getCard('parakeet').effects[0]).toMatchObject({
      trigger: 'onPlay',
      type: 'gainFlatBonusPurchasingPower',
      params: { amount: 1 },
    });
    expect(getCard('parakeet').effects[1]).toMatchObject({
      trigger: 'onScore',
      type: 'scoreBonusIfSpeciesCountAtLeast',
      params: { minCount: 4, bonus: 10 },
    });
    expect(getCard('owl').effects[0]).toMatchObject({ type: 'drawCards', params: { amount: 1 } });
    expect(getCard('owl').effects[1]).toMatchObject({
      type: 'gainFlatBonusPurchasingPower',
      params: { amount: 1 },
    });
    expect(getCard('bat').effects[0]).toMatchObject({ type: 'swapSelfWithTopOfDeck' });
    expect(getCard('platypus').effects[0]).toMatchObject({
      type: 'gainBonusPurchasingPowerPerDistinctSpeciesInHand',
    });
    expect(getCard('rabbit').effects[0]).toMatchObject({
      type: 'drawTopUnlessExpensiveAnimal',
      params: { maxCost: 2 },
    });
  });

  it('lanza un error para un id de carta desconocido', () => {
    expect(() => getCard('does-not-exist')).toThrow();
  });
});
