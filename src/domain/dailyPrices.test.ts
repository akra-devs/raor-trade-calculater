import { describe, expect, it } from 'vitest'
import {
  aggregateCandles,
  calculateBollingerBands,
  calculateMovingAverage,
  calculateRsi,
  getRecentCloses,
  getRecentClosesUntil,
  normalizeDailyCandle,
  sortDailyCandles,
} from './dailyPrices'

describe('daily price utilities', () => {
  it('normalizes prices and keeps high/low consistent with open and close', () => {
    expect(
      normalizeDailyCandle({
        date: '2026-06-01',
        open: 100.111,
        high: 99,
        low: 105,
        close: 102.222,
      }),
    ).toEqual({
      date: '2026-06-01',
      open: 100.11,
      high: 102.22,
      low: 100.11,
      close: 102.22,
    })
  })

  it('sorts candles and returns recent closes', () => {
    const candles = sortDailyCandles([
      {
        date: '2026-06-02',
        open: 110,
        high: 115,
        low: 109,
        close: 113,
      },
      {
        date: '2026-06-01',
        open: 100,
        high: 104,
        low: 99,
        close: 103,
      },
    ])

    expect(candles.map((candle) => candle.date)).toEqual([
      '2026-06-01',
      '2026-06-02',
    ])
    expect(getRecentCloses(candles, 1)).toEqual([113])
    expect(getRecentClosesUntil(candles, '2026-06-02', 2)).toEqual([103, 113])
    expect(getRecentClosesUntil(candles, '2026-06-03', 2)).toEqual([])
  })

  it('aggregates daily candles into weekly, monthly, and yearly candles', () => {
    const candles = [
      { date: '2026-01-02', open: 100, high: 110, low: 90, close: 105 },
      { date: '2026-01-05', open: 106, high: 112, low: 101, close: 110 },
      { date: '2026-01-06', open: 111, high: 115, low: 107, close: 108 },
      { date: '2026-02-02', open: 109, high: 120, low: 103, close: 118 },
      { date: '2027-01-04', open: 119, high: 125, low: 117, close: 124 },
    ]

    expect(aggregateCandles(candles, 'week')).toEqual([
      { date: '2026-01-02', open: 100, high: 110, low: 90, close: 105 },
      { date: '2026-01-06', open: 106, high: 115, low: 101, close: 108 },
      { date: '2026-02-02', open: 109, high: 120, low: 103, close: 118 },
      { date: '2027-01-04', open: 119, high: 125, low: 117, close: 124 },
    ])
    expect(aggregateCandles(candles, 'month')).toEqual([
      { date: '2026-01-06', open: 100, high: 115, low: 90, close: 108 },
      { date: '2026-02-02', open: 109, high: 120, low: 103, close: 118 },
      { date: '2027-01-04', open: 119, high: 125, low: 117, close: 124 },
    ])
    expect(aggregateCandles(candles, 'year')).toEqual([
      { date: '2026-02-02', open: 100, high: 120, low: 90, close: 118 },
      { date: '2027-01-04', open: 119, high: 125, low: 117, close: 124 },
    ])
  })

  it('calculates moving averages and Wilder RSI values', () => {
    const candles = Array.from({ length: 16 }, (_, index) => ({
      date: `2026-06-${String(index + 1).padStart(2, '0')}`,
      open: 100 + index,
      high: 100 + index,
      low: 100 + index,
      close: 100 + index,
    }))

    expect(calculateMovingAverage(candles, 5).at(-1)).toEqual({
      date: '2026-06-16',
      value: 113,
    })
    expect(calculateRsi(candles, 14)).toEqual([
      { date: '2026-06-15', value: 100 },
      { date: '2026-06-16', value: 100 },
    ])
  })

  it('calculates Bollinger Bands with the configured period and multiplier', () => {
    const candles = Array.from({ length: 20 }, (_, index) => ({
      date: `2026-08-${String(index + 1).padStart(2, '0')}`,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
    }))

    expect(calculateBollingerBands(candles, 20, 2)).toEqual([
      {
        date: '2026-08-20',
        middle: 100,
        upper: 100,
        lower: 100,
      },
    ])
  })

  it('returns RSI 50 for a flat price series', () => {
    const candles = Array.from({ length: 15 }, (_, index) => ({
      date: `2026-07-${String(index + 1).padStart(2, '0')}`,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
    }))

    expect(calculateRsi(candles, 14)).toEqual([
      { date: '2026-07-15', value: 50 },
    ])
  })
})
