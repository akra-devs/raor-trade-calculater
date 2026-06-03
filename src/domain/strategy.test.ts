import { describe, expect, it } from 'vitest'
import {
  calculateNormalTurnAfterBuy,
  calculateNormalTurnAfterLimitSellAndLocBuy,
  calculateNormalTurnAfterQuarterSell,
  calculateNextTurnFromExecution,
  calculateOneBuyAmount,
  calculateReverseExitPrice,
  calculateReverseSellQuantity,
  calculateReverseStarPoint,
  calculateReverseTurnAfterBuy,
  calculateReverseTurnAfterSell,
  calculateStarPercent,
  calculateStarPrices,
  calculateTargetPrice,
  floorQuantity,
  getDefaultTargetProfitPercent,
  generateOrders,
  getStrategyConfig,
  roundToCent,
  shouldExitReverseMode,
  type StrategyState,
} from './strategy'

const baseState: StrategyState = {
  mode: 'normal',
  turn: 0,
  cashBalance: 40_000,
  shares: 0,
  averagePrice: 0,
  previousClose: 100,
  reverseDays: 0,
  recentCloses: [],
}

describe('strategy primitives', () => {
  it('uses the documented target profit defaults and accepts an explicit override', () => {
    expect(getDefaultTargetProfitPercent('TQQQ')).toBe(15)
    expect(getDefaultTargetProfitPercent('SOXL')).toBe(20)
    expect(getStrategyConfig('SOXL', 40).gainPercent).toBe(20)
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
          turn: 10,
          cashBalance: 3_000,
          shares: 10,
          averagePrice: 100,
        },
        40,
      ),
    ).toBe(100)
    expect(calculateOneBuyAmount(baseState, 40)).toBe(1_000)
    expect(calculateTargetPrice(100, 15)).toBe(115)
    expect(roundToCent(10.005)).toBe(10.01)
    expect(floorQuantity(100, 33.34)).toBe(2)
  })

  it('calculates reverse star, reverse sell quantity, turn updates, and exit threshold', () => {
    expect(calculateReverseStarPoint([90, 100, 110, 100, 100])).toBe(100)
    expect(calculateReverseStarPoint([90, 0, 110, 100, 100])).toBeUndefined()
    expect(calculateReverseSellQuantity(198, 40)).toBe(9)
    expect(calculateNormalTurnAfterBuy(2.5)).toBe(3.5)
    expect(calculateNormalTurnAfterBuy(2.5, 0.5)).toBe(3)
    expect(calculateNormalTurnAfterQuarterSell(8)).toBe(6)
    expect(calculateNormalTurnAfterLimitSellAndLocBuy(8, 0.5)).toBe(2.5)
    expect(calculateReverseTurnAfterSell(39.5, 40)).toBeCloseTo(37.525)
    expect(calculateReverseTurnAfterBuy(37.525, 40)).toBeCloseTo(38.14375)
    expect(calculateReverseExitPrice(40, 20)).toBe(32)
    expect(shouldExitReverseMode(32, 40, 20)).toBe(false)
    expect(shouldExitReverseMode(32.01, 40, 20)).toBe(true)
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
        quantity: 8,
        price: 115,
        amount: 1_000,
      }),
    ])
  })

  it('creates front-half split buys, quarter sell, and remaining target sell', () => {
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
          price: 111.25,
        }),
        expect.objectContaining({
          tag: 'TARGET_SELL',
          side: 'sell',
          type: 'LIMIT',
          quantity: 8,
          price: 115,
        }),
        expect.objectContaining({
          tag: 'FRONT_HALF_BASE_BUY',
          side: 'buy',
          quantity: 5,
          price: 100,
          amount: 557.15,
        }),
        expect.objectContaining({
          tag: 'FRONT_HALF_STAR_BUY',
          side: 'buy',
          quantity: 5,
          price: 111.24,
          amount: 557.15,
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
          quantity: 27,
          price: 96.24,
          amount: 2_600,
        }),
      ]),
    )
  })

  it('calculates the next T from normal-mode execution prices', () => {
    const config = getStrategyConfig('TQQQ', 40)
    const state: StrategyState = {
      ...baseState,
      turn: 5,
      cashBalance: 39_000,
      shares: 10,
      averagePrice: 100,
      previousClose: 90,
    }
    const result = generateOrders(config, state)

    expect(
      calculateNextTurnFromExecution(config, state, result.orders, {
        close: 99,
        high: 110,
      }),
    ).toEqual(
      expect.objectContaining({
        nextTurn: 6,
        nextShares: 20,
        nextCashBalance: 38_010,
        nextAveragePrice: 99.5,
        nextMode: 'normal',
        executedOrderTags: ['FRONT_HALF_BASE_BUY', 'FRONT_HALF_STAR_BUY'],
      }),
    )

    expect(
      calculateNextTurnFromExecution(config, state, result.orders, {
        close: 112,
        high: 114,
      }),
    ).toEqual(
      expect.objectContaining({
        nextTurn: 3.75,
        nextShares: 8,
        nextCashBalance: 39_224,
        nextAveragePrice: 100,
        nextMode: 'normal',
        executedOrderTags: ['STAR_SELL'],
      }),
    )

    expect(
      calculateNextTurnFromExecution(config, state, result.orders, {
        close: 99,
        high: 116,
      }),
    ).toEqual(
      expect.objectContaining({
        nextTurn: 2.25,
        nextShares: 12,
        nextCashBalance: 38_930,
        nextAveragePrice: 99.17,
        nextMode: 'normal',
        usedHighForLimitSell: true,
        executedOrderTags: [
          'TARGET_SELL',
          'FRONT_HALF_BASE_BUY',
          'FRONT_HALF_STAR_BUY',
        ],
      }),
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
        quantity: 10,
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
          quantity: 8,
          price: 100,
        }),
        expect.objectContaining({
          tag: 'REVERSE_CASH_BUY',
          side: 'buy',
          type: 'LOC',
          quantity: 10,
          price: 99.99,
          amount: 1_000,
        }),
      ]),
    )
  })

  it('calculates the next T from reverse-mode execution prices', () => {
    const config = getStrategyConfig('TQQQ', 40)
    const firstDayState: StrategyState = {
      ...baseState,
      mode: 'reverse',
      turn: 39.5,
      shares: 200,
      averagePrice: 100,
      reverseDays: 0,
    }
    const firstDayResult = generateOrders(config, firstDayState)

    expect(
      calculateNextTurnFromExecution(
        config,
        firstDayState,
        firstDayResult.orders,
        { close: 80 },
      ),
    ).toEqual(
      expect.objectContaining({
        nextTurn: 37.525,
        nextShares: 190,
        nextCashBalance: 40_800,
        nextAveragePrice: 100,
        nextMode: 'reverse',
        executedOrderTags: ['REVERSE_DAY_ONE_SELL'],
      }),
    )

    const laterState: StrategyState = {
      ...firstDayState,
      turn: 37.525,
      reverseDays: 1,
      cashBalance: 4_000,
      recentCloses: [90, 100, 110, 100, 100],
    }
    const laterResult = generateOrders(config, laterState)

    expect(
      calculateNextTurnFromExecution(config, laterState, laterResult.orders, {
        close: 99.99,
      }),
    ).toEqual(
      expect.objectContaining({
        nextTurn: 38.14375,
        nextShares: 210,
        nextCashBalance: 3_000.1,
        nextAveragePrice: 100,
        nextMode: 'normal',
        didExitReverse: true,
        executedOrderTags: ['REVERSE_CASH_BUY'],
      }),
    )
  })
})
