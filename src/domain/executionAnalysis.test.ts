import { describe, expect, it } from 'vitest'
import { calculateExecutionAnalysis } from './executionAnalysis'
import type { ExecutionAnalysisRecord } from './executionAnalysis'

function record(
  overrides: Partial<ExecutionAnalysisRecord>,
): ExecutionAnalysisRecord {
  const price = overrides.price ?? 100
  const quantity = overrides.quantity ?? 1

  return {
    createdAt: overrides.createdAt ?? `${overrides.date ?? '2026-01-01'}T00:00:00.000Z`,
    date: overrides.date ?? '2026-01-01',
    feeAmount: overrides.feeAmount ?? 0,
    grossAmount: overrides.grossAmount ?? price * quantity,
    price,
    quantity,
    side: overrides.side ?? 'buy',
    symbol: overrides.symbol ?? 'TQQQ',
    ...overrides,
  }
}

describe('execution analysis', () => {
  it('calculates sell quantity and weighted sell average from sell records', () => {
    const result = calculateExecutionAnalysis({
      records: [
        record({
          date: '2026-01-05',
          feeAmount: 0.13,
          grossAmount: 260,
          price: 130,
          quantity: 2,
          side: 'sell',
        }),
        record({
          date: '2026-01-03',
          feeAmount: 0.24,
          grossAmount: 480,
          price: 120,
          quantity: 4,
          side: 'sell',
        }),
        record({
          date: '2026-01-01',
          feeAmount: 0.5,
          grossAmount: 1000,
          price: 100,
          quantity: 10,
          side: 'buy',
        }),
      ],
      symbol: 'TQQQ',
    })

    expect(result.sellQuantity).toBe(6)
    expect(result.sellAmount).toBe(740)
    expect(result.sellAveragePrice).toBe(123.33)
    expect(result.sellFeeAmount).toBe(0.37)
    expect(result.sellRecordCount).toBe(2)
  })

  it('uses previous buys for end-date position while period sells only use the selected range', () => {
    const result = calculateExecutionAnalysis({
      endDate: '2026-01-03',
      records: [
        record({
          date: '2026-01-06',
          grossAmount: 550,
          price: 110,
          quantity: 5,
          side: 'buy',
        }),
        record({
          date: '2026-01-03',
          grossAmount: 480,
          price: 120,
          quantity: 4,
          side: 'sell',
        }),
        record({
          date: '2026-01-01',
          feeAmount: 0.5,
          grossAmount: 1000,
          price: 100,
          quantity: 10,
          side: 'buy',
        }),
      ],
      startDate: '2026-01-03',
      symbol: 'TQQQ',
    })

    expect(result.matchedRecordCount).toBe(1)
    expect(result.sellQuantity).toBe(4)
    expect(result.sellAveragePrice).toBe(120)
    expect(result.positionQuantity).toBe(6)
    expect(result.averagePrice).toBe(100.05)
  })

  it('filters out other symbols', () => {
    const result = calculateExecutionAnalysis({
      records: [
        record({
          date: '2026-01-01',
          grossAmount: 1000,
          quantity: 10,
          side: 'buy',
          symbol: 'TQQQ',
        }),
        record({
          date: '2026-01-02',
          grossAmount: 900,
          price: 90,
          quantity: 10,
          side: 'sell',
          symbol: 'SOXL',
        }),
      ],
      symbol: 'TQQQ',
    })

    expect(result.symbolRecordCount).toBe(1)
    expect(result.sellQuantity).toBe(0)
    expect(result.sellAveragePrice).toBeUndefined()
    expect(result.positionQuantity).toBe(10)
  })

  it('prefers saved position metadata when available at the analysis end date', () => {
    const result = calculateExecutionAnalysis({
      endDate: '2026-01-02',
      records: [
        record({
          averagePriceAfter: 101.23,
          date: '2026-01-02',
          grossAmount: 480,
          price: 120,
          quantity: 4,
          sharesAfter: 6,
          side: 'sell',
        }),
        record({
          date: '2026-01-01',
          grossAmount: 1000,
          price: 100,
          quantity: 10,
          side: 'buy',
        }),
      ],
      symbol: 'TQQQ',
    })

    expect(result.positionQuantity).toBe(6)
    expect(result.averagePrice).toBe(101.23)
  })

  it('returns an invalid state when the start date is after the end date', () => {
    const result = calculateExecutionAnalysis({
      endDate: '2026-01-01',
      records: [
        record({
          date: '2026-01-01',
          grossAmount: 1000,
          quantity: 10,
          side: 'buy',
        }),
      ],
      startDate: '2026-01-02',
      symbol: 'TQQQ',
    })

    expect(result.isInvalidPeriod).toBe(true)
    expect(result.matchedRecordCount).toBe(0)
    expect(result.positionQuantity).toBe(0)
  })
})
