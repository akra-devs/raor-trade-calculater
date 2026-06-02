export interface DailyCandle {
  date: string
  open: number
  high: number
  low: number
  close: number
}

export interface IndicatorPoint {
  date: string
  value: number
}

export interface BollingerBandPoint {
  date: string
  middle: number
  upper: number
  lower: number
}

export const PRICE_INTERVALS = ['day', 'week', 'month', 'year'] as const

export type PriceInterval = (typeof PRICE_INTERVALS)[number]

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function normalizeDailyCandle(input: DailyCandle): DailyCandle | undefined {
  if (!isValidTradeDate(input.date)) {
    return undefined
  }

  const prices = [input.open, input.high, input.low, input.close]

  if (prices.some((price) => !isPositive(price))) {
    return undefined
  }

  const open = roundPrice(input.open)
  const close = roundPrice(input.close)
  const high = roundPrice(Math.max(input.high, open, close))
  const low = roundPrice(Math.min(input.low, open, close))

  return {
    date: input.date,
    open,
    high,
    low,
    close,
  }
}

export function sortDailyCandles(candles: DailyCandle[]): DailyCandle[] {
  return [...candles].sort((a, b) => a.date.localeCompare(b.date))
}

export function aggregateCandles(
  candles: DailyCandle[],
  interval: PriceInterval,
): DailyCandle[] {
  const sortedCandles = sortDailyCandles(candles)

  if (interval === 'day') {
    return sortedCandles
  }

  const grouped = new Map<string, DailyCandle[]>()

  for (const candle of sortedCandles) {
    const key = getIntervalKey(candle.date, interval)
    const group = grouped.get(key) ?? []

    group.push(candle)
    grouped.set(key, group)
  }

  return [...grouped.values()].map(toAggregatedCandle)
}

export function getRecentCloses(candles: DailyCandle[], count: number): number[] {
  return sortDailyCandles(candles)
    .slice(-count)
    .map((candle) => candle.close)
}

export function getRecentClosesUntil(
  candles: DailyCandle[],
  date: string,
  count: number,
): number[] {
  const sortedCandles = sortDailyCandles(candles)
  const selectedIndex = sortedCandles.findIndex((candle) => candle.date === date)

  if (selectedIndex < 0 || count <= 0) {
    return []
  }

  return sortedCandles
    .slice(Math.max(0, selectedIndex - count + 1), selectedIndex + 1)
    .map((candle) => candle.close)
}

export function calculateMovingAverage(
  candles: DailyCandle[],
  period: number,
): IndicatorPoint[] {
  const sortedCandles = sortDailyCandles(candles)

  if (period <= 0 || sortedCandles.length < period) {
    return []
  }

  const values: IndicatorPoint[] = []
  let rollingSum = 0

  for (let index = 0; index < sortedCandles.length; index += 1) {
    rollingSum += sortedCandles[index].close

    if (index >= period) {
      rollingSum -= sortedCandles[index - period].close
    }

    if (index < period - 1) {
      continue
    }

    values.push({
      date: sortedCandles[index].date,
      value: roundPrice(rollingSum / period),
    })
  }

  return values
}

export function calculateBollingerBands(
  candles: DailyCandle[],
  period: number,
  multiplier: number,
): BollingerBandPoint[] {
  const sortedCandles = sortDailyCandles(candles)

  if (period <= 0 || multiplier < 0 || sortedCandles.length < period) {
    return []
  }

  const values: BollingerBandPoint[] = []

  for (let index = period - 1; index < sortedCandles.length; index += 1) {
    const windowCandles = sortedCandles.slice(index - period + 1, index + 1)
    const closes = windowCandles.map((candle) => candle.close)
    const middle =
      closes.reduce((total, close) => total + close, 0) / closes.length
    const variance =
      closes.reduce((total, close) => total + (close - middle) ** 2, 0) /
      closes.length
    const deviation = Math.sqrt(variance) * multiplier

    values.push({
      date: sortedCandles[index].date,
      middle: roundPrice(middle),
      upper: roundPrice(middle + deviation),
      lower: roundPrice(Math.max(0, middle - deviation)),
    })
  }

  return values
}

export function calculateRsi(
  candles: DailyCandle[],
  period: number,
): IndicatorPoint[] {
  const sortedCandles = sortDailyCandles(candles)

  if (period <= 0 || sortedCandles.length <= period) {
    return []
  }

  const values: IndicatorPoint[] = []
  let averageGain = 0
  let averageLoss = 0

  for (let index = 1; index < sortedCandles.length; index += 1) {
    const change = sortedCandles[index].close - sortedCandles[index - 1].close
    const gain = Math.max(change, 0)
    const loss = Math.max(-change, 0)

    if (index <= period) {
      averageGain += gain
      averageLoss += loss

      if (index < period) {
        continue
      }

      averageGain /= period
      averageLoss /= period
    } else {
      averageGain = (averageGain * (period - 1) + gain) / period
      averageLoss = (averageLoss * (period - 1) + loss) / period
    }

    values.push({
      date: sortedCandles[index].date,
      value: roundIndicator(calculateRsiValue(averageGain, averageLoss)),
    })
  }

  return values
}

export function isValidTradeDate(date: string): boolean {
  if (!DATE_PATTERN.test(date)) {
    return false
  }

  const [year, month, day] = date.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  )
}

export function roundPrice(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.round((value + Number.EPSILON) * 100) / 100
}

function calculateRsiValue(averageGain: number, averageLoss: number): number {
  if (averageLoss === 0 && averageGain === 0) {
    return 50
  }

  if (averageLoss === 0) {
    return 100
  }

  return 100 - 100 / (1 + averageGain / averageLoss)
}

function roundIndicator(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.round((value + Number.EPSILON) * 100) / 100
}

function isPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function getIntervalKey(date: string, interval: PriceInterval): string {
  if (interval === 'month') {
    return date.slice(0, 7)
  }

  if (interval === 'year') {
    return date.slice(0, 4)
  }

  return getIsoWeekKey(date)
}

function getIsoWeekKey(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`)
  const day = parsed.getUTCDay() || 7

  parsed.setUTCDate(parsed.getUTCDate() + 4 - day)

  const yearStart = new Date(Date.UTC(parsed.getUTCFullYear(), 0, 1))
  const week = Math.ceil(
    ((parsed.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  )

  return `${parsed.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

function toAggregatedCandle(candles: DailyCandle[]): DailyCandle {
  const first = candles[0]
  const last = candles[candles.length - 1]

  return {
    date: last.date,
    open: first.open,
    high: roundPrice(Math.max(...candles.map((candle) => candle.high))),
    low: roundPrice(Math.min(...candles.map((candle) => candle.low))),
    close: last.close,
  }
}
