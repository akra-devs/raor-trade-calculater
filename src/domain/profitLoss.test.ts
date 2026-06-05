import { describe, expect, it } from 'vitest'
import { calculateProfitLoss } from './profitLoss'
import type { Order } from './strategy'

describe('profit loss calculation', () => {
  it('marks the current position to market with an exit cost', () => {
    const result = calculateProfitLoss({
      averagePrice: 100,
      budget: 10_000,
      cashBalance: 5_000,
      markDate: '2026-06-04',
      markPrice: 110,
      orders: [],
      shares: 50,
    })

    expect(result).toEqual({
      budget: 10_000,
      budgetReturnPercent: 4.9725,
      cashBalanceAfterOrders: 5_000,
      executedOrderCount: 0,
      executedOrders: [],
      markDate: '2026-06-04',
      markPrice: 110,
      netEquity: 10_497.25,
      positionExitFee: 2.75,
      positionValue: 5_497.25,
      remainingShares: 50,
      totalFees: 2.75,
      totalProfitLoss: 497.25,
    })
  })

  it('includes estimated executions, remaining position value, and buy/sell costs', () => {
    const orders: Order[] = [
      {
        id: '1-TARGET_SELL',
        label: '목표가 매도',
        price: 120,
        quantity: 20,
        side: 'sell',
        tag: 'TARGET_SELL',
        type: 'LIMIT',
      },
      {
        id: '2-FRONT_HALF_STAR_BUY',
        label: '전반전 별지점 매수',
        price: 105,
        quantity: 10,
        side: 'buy',
        tag: 'FRONT_HALF_STAR_BUY',
        type: 'LOC',
      },
    ]

    const result = calculateProfitLoss({
      averagePrice: 100,
      budget: 10_000,
      cashBalance: 5_000,
      executionPrice: {
        close: 104,
        date: '2026-06-05',
        high: 121,
      },
      markDate: '2026-06-04',
      markPrice: 104,
      orders,
      shares: 50,
    })

    expect(result?.cashBalanceAfterOrders).toBe(6_358.28)
    expect(result?.executedOrderCount).toBe(2)
    expect(result?.markDate).toBe('2026-06-05')
    expect(result?.netEquity).toBe(10_516.2)
    expect(result?.positionValue).toBe(4_157.92)
    expect(result?.remainingShares).toBe(40)
    expect(result?.totalFees).toBe(3.8)
    expect(result?.totalProfitLoss).toBe(516.2)
    expect(result?.budgetReturnPercent).toBe(5.162)
  })
})
