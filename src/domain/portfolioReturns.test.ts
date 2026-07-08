import { describe, expect, it } from 'vitest'
import { calculatePortfolioReturns } from './portfolioReturns'
import type { DailyCandle } from './dailyPrices'
import type { PortfolioReturnCheckpoint } from './portfolioReturns'

describe('portfolio return calculation', () => {
  it('uses saved post-execution checkpoints as account state instead of replaying them as deltas', () => {
    const result = calculatePortfolioReturns({
      candles: [
        createCandle('2026-06-27', 100),
        createCandle('2026-06-28', 100),
        createCandle('2026-07-01', 110),
        createCandle('2026-07-07', 105),
      ],
      checkpoints: [
        createCheckpoint({
          cashBalance: 6000,
          date: '2026-06-28',
          shares: 5,
          sourceSnapshotId: 'june-state',
        }),
        createCheckpoint({
          cashBalance: 5600,
          date: '2026-07-07',
          executedRecordCount: 2,
          shares: 10,
          sourceCreatedAt: '2026-07-07T09:30:00.000Z',
          sourceSnapshotId: 'latest-state',
        }),
      ],
      endDate: '2026-07-07',
      symbol: 'TQQQ',
    })

    expect(result.status).toBe('ready')
    expect(result.budget).toBe(6600)
    expect(result.firstExecutionDate).toBe('2026-06-28')
    expect(result.points.map((point) => point.date)).toEqual([
      '2026-06-28',
      '2026-07-01',
      '2026-07-07',
    ])
    expect(result.points[0]).toMatchObject({
      cashBalance: 6000,
      positionValue: 500,
      returnPercent: -1.5152,
      shares: 5,
      totalAsset: 6500,
      totalProfitLoss: -100,
    })
    expect(result.latestPoint).toMatchObject({
      cashBalance: 5600,
      executedRecordCount: 2,
      positionValue: 1050,
      returnPercent: 0.7576,
      shares: 10,
      sourceSnapshotId: 'latest-state',
      totalAsset: 6650,
      totalProfitLoss: 50,
    })
  })

  it('uses the latest checkpoint on the same date and sums same-day executed counts', () => {
    const result = calculatePortfolioReturns({
      candles: [createCandle('2026-07-07', 100)],
      checkpoints: [
        createCheckpoint({
          cashBalance: 6100,
          date: '2026-07-07',
          executedRecordCount: 1,
          shares: 4,
          sourceCreatedAt: '2026-07-07T09:00:00.000Z',
          sourceSnapshotId: 'early',
        }),
        createCheckpoint({
          cashBalance: 5900,
          date: '2026-07-07',
          executedRecordCount: 2,
          shares: 8,
          sourceCreatedAt: '2026-07-07T18:00:00.000Z',
          sourceSnapshotId: 'late',
        }),
      ],
      symbol: 'TQQQ',
    })

    expect(result.latestPoint).toMatchObject({
      cashBalance: 5900,
      executedRecordCount: 3,
      positionValue: 800,
      sourceSnapshotId: 'late',
      totalAsset: 6700,
      totalProfitLoss: 100,
    })
  })

  it('filters checkpoints to the active symbol', () => {
    const result = calculatePortfolioReturns({
      candles: [createCandle('2026-07-07', 100)],
      checkpoints: [
        createCheckpoint({
          cashBalance: 3000,
          shares: 100,
          symbol: 'SOXL',
        }),
        createCheckpoint({
          cashBalance: 6200,
          shares: 5,
          symbol: 'TQQQ',
        }),
      ],
      symbol: 'TQQQ',
    })

    expect(result.checkpointCount).toBe(1)
    expect(result.latestPoint).toMatchObject({
      cashBalance: 6200,
      positionValue: 500,
      totalAsset: 6700,
      totalProfitLoss: 100,
    })
  })

  it('returns explicit empty statuses for missing inputs and invalid ranges', () => {
    const checkpoint = createCheckpoint({
      date: '2026-07-07',
    })

    expect(
      calculatePortfolioReturns({
        candles: [createCandle('2026-07-07', 100)],
        checkpoints: [],
        symbol: 'TQQQ',
      }).status,
    ).toBe('missing-history')
    expect(
      calculatePortfolioReturns({
        candles: [createCandle('2026-07-07', 100)],
        checkpoints: [
          createCheckpoint({
            budget: 0,
          }),
        ],
        symbol: 'TQQQ',
      }).status,
    ).toBe('invalid-budget')
    expect(
      calculatePortfolioReturns({
        candles: [],
        checkpoints: [checkpoint],
        symbol: 'TQQQ',
      }).status,
    ).toBe('missing-prices')
    expect(
      calculatePortfolioReturns({
        candles: [createCandle('2026-07-07', 100)],
        checkpoints: [checkpoint],
        endDate: '2026-07-06',
        symbol: 'TQQQ',
      }).status,
    ).toBe('invalid-range')
    expect(
      calculatePortfolioReturns({
        candles: [createCandle('2026-07-06', 100)],
        checkpoints: [checkpoint],
        endDate: '2026-07-08',
        symbol: 'TQQQ',
      }).status,
    ).toBe('no-prices-in-range')
  })
})

function createCheckpoint(
  overrides: Partial<PortfolioReturnCheckpoint> = {},
): PortfolioReturnCheckpoint {
  return {
    averagePrice: 100,
    budget: 6600,
    cashBalance: 6000,
    date: '2026-07-07',
    executedRecordCount: 1,
    shares: 5,
    sourceCreatedAt: '2026-07-07T00:00:00.000Z',
    sourceSnapshotId: 'snapshot-1',
    symbol: 'TQQQ',
    ...overrides,
  }
}

function createCandle(date: string, close: number): DailyCandle {
  return {
    close,
    date,
    high: close,
    low: close,
    open: close,
  }
}
