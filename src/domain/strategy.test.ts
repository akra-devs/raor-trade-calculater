import { describe, expect, it } from 'vitest'
import {
  calculateOneBuyAmount,
  calculateStarPercent,
  calculateStarPrices,
  calculateTargetPrice,
  floorQuantity,
  generateOrders,
  getStrategyConfig,
  roundToCent,
  type StrategyState,
} from './strategy'

const baseState: StrategyState = {
  mode: 'normal',
  turn: 0,
  cashBalance: 4_000,
  shares: 0,
  averagePrice: 0,
  previousClose: 100,
  reverseDays: 0,
  recentCloses: [],
}

describe('strategy primitives', () => {
  it('defaults G to 15 and accepts an editable gain percent independent of the ETF', () => {
    expect(getStrategyConfig('SOXL', 40).gainPercent).toBe(15)
    expect(getStrategyConfig('SOXL', 40, 12.5).gainPercent).toBe(12.5)
  })

  it('calculates star percent, star prices, one-buy amount, target price, and floored quantity', () => {
    const config = getStrategyConfig('TQQQ', 40)
    const starPrices = calculateStarPrices(100, config.gainPercent, 40, 10)

    expect(calculateStarPercent(15, 40, 10)).toBe(7.5)
    expect(starPrices).toEqual({
      starPercent: 7.5,
      starSellPrice: 107.5,
      starBuyPrice: 107.49,
    })
    expect(
      calculateOneBuyAmount(
        {
          ...baseState,
          cashBalance: 3_000,
          shares: 10,
          averagePrice: 100,
        },
        40,
      ),
    ).toBe(100)
    expect(calculateTargetPrice(100, 15)).toBe(115)
    expect(roundToCent(10.005)).toBe(10.01)
    expect(floorQuantity(100, 33.34)).toBe(2)
  })

  it('skips zero-quantity orders and records warnings', () => {
    const result = generateOrders(getStrategyConfig('TQQQ', 20), {
      ...baseState,
      cashBalance: 200,
      previousClose: 100,
    })

    expect(result.orders).toHaveLength(0)
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'ZERO_QUANTITY_ORDER',
          tag: 'INITIAL_BUY',
        }),
      ]),
    )
  })
})

describe('normal mode orders', () => {
  it('creates the first buy order', () => {
    const result = generateOrders(getStrategyConfig('TQQQ', 40), baseState)

    expect(result.orders).toEqual([
      expect.objectContaining({
        side: 'buy',
        type: 'LOC',
        tag: 'INITIAL_BUY',
        quantity: 1,
        price: 100,
        amount: 100,
      }),
    ])
  })

  it('creates front-half split buys and 1/4 plus 3/4 sells', () => {
    const result = generateOrders(getStrategyConfig('TQQQ', 40), {
      ...baseState,
      turn: 5,
      cashBalance: 39_000,
      shares: 10,
      averagePrice: 100,
      previousClose: 90,
    })

    expect(result.orders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tag: 'STAR_SELL',
          side: 'sell',
          type: 'LOC',
          quantity: 2,
          price: 100.13,
        }),
        expect.objectContaining({
          tag: 'TARGET_SELL',
          side: 'sell',
          type: 'LIMIT',
          quantity: 7,
          price: 115,
        }),
        expect.objectContaining({
          tag: 'FRONT_HALF_BASE_BUY',
          side: 'buy',
          quantity: 5,
          price: 90,
          amount: 500,
        }),
        expect.objectContaining({
          tag: 'FRONT_HALF_STAR_BUY',
          side: 'buy',
          quantity: 4,
          price: 100.12,
          amount: 500,
        }),
      ]),
    )
  })

  it('creates a back-half full star buy', () => {
    const result = generateOrders(getStrategyConfig('TQQQ', 40), {
      ...baseState,
      turn: 25,
      cashBalance: 39_000,
      shares: 10,
      averagePrice: 100,
      previousClose: 90,
    })

    expect(result.orders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tag: 'BACK_FULL_STAR_BUY',
          side: 'buy',
          quantity: 11,
          price: 86.62,
          amount: 1_000,
        }),
      ]),
    )
  })
})

describe('reverse mode orders', () => {
  it('auto-switches when T exceeds N - 1 and creates first-day MOC sell only', () => {
    const result = generateOrders(getStrategyConfig('TQQQ', 20), {
      ...baseState,
      turn: 20,
      shares: 100,
      averagePrice: 100,
      previousClose: 80,
    })

    expect(result.summary.effectiveMode).toBe('reverse')
    expect(result.summary.wasAutoReversed).toBe(true)
    expect(result.orders).toEqual([
      expect.objectContaining({
        side: 'sell',
        type: 'MOC',
        tag: 'REVERSE_DAY_ONE_SELL',
        quantity: 25,
      }),
    ])
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'AUTO_REVERSE',
        }),
      ]),
    )
  })

  it('uses the previous five close average for reverse LOC sell and C/4 buy after day one', () => {
    const result = generateOrders(getStrategyConfig('TQQQ', 20), {
      ...baseState,
      mode: 'reverse',
      turn: 20,
      cashBalance: 4_000,
      shares: 80,
      averagePrice: 100,
      reverseDays: 1,
      recentCloses: [90, 100, 110, 100, 100],
    })

    expect(result.summary.reverseAverageClose).toBe(100)
    expect(result.orders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tag: 'REVERSE_STAR_SELL',
          side: 'sell',
          type: 'LOC',
          quantity: 20,
          price: 85,
        }),
        expect.objectContaining({
          tag: 'REVERSE_CASH_BUY',
          side: 'buy',
          type: 'LOC',
          quantity: 11,
          price: 84.99,
          amount: 1_000,
        }),
      ]),
    )
  })
})
