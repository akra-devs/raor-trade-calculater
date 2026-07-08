import type { DailyCandle } from './dailyPrices'
import type { StrategySymbol } from './strategy'

export type PortfolioReturnStatus =
  | 'invalid-budget'
  | 'invalid-range'
  | 'missing-history'
  | 'missing-prices'
  | 'no-prices-in-range'
  | 'ready'

export interface PortfolioReturnCheckpoint {
  averagePrice: number
  budget: number
  cashBalance: number
  date: string
  executedRecordCount: number
  shares: number
  sourceCreatedAt: string
  sourceSnapshotId: string
  symbol: StrategySymbol
}

export interface PortfolioReturnPoint {
  averagePrice: number
  cashBalance: number
  close: number
  date: string
  executedRecordCount: number
  positionValue: number
  returnPercent: number
  shares: number
  sourceSnapshotId?: string
  totalAsset: number
  totalProfitLoss: number
}

export interface PortfolioReturnResult {
  budget: number
  checkpointCount: number
  endDate?: string
  firstExecutionDate?: string
  latestPoint?: PortfolioReturnPoint
  points: PortfolioReturnPoint[]
  startDate?: string
  status: PortfolioReturnStatus
  symbol: StrategySymbol
}

export interface PortfolioReturnInput {
  candles: DailyCandle[]
  checkpoints: PortfolioReturnCheckpoint[]
  endDate?: string
  symbol: StrategySymbol
}

interface PortfolioState {
  averagePrice: number
  cashBalance: number
  executedRecordCount: number
  shares: number
  sourceSnapshotId?: string
}

export function calculatePortfolioReturns({
  candles,
  checkpoints,
  endDate,
  symbol,
}: PortfolioReturnInput): PortfolioReturnResult {
  const sortedCheckpoints = sortCheckpointsChronologically(
    checkpoints.filter((checkpoint) => checkpoint.symbol === symbol),
  )

  if (sortedCheckpoints.length === 0) {
    return createResult('missing-history', symbol)
  }

  const budget = positiveNumber(sortedCheckpoints[0].budget)

  if (budget <= 0) {
    return createResult('invalid-budget', symbol, {
      budget,
      checkpointCount: sortedCheckpoints.length,
    })
  }

  const sortedCandles = [...candles].sort((left, right) =>
    left.date.localeCompare(right.date),
  )

  if (sortedCandles.length === 0) {
    return createResult('missing-prices', symbol, {
      budget,
      checkpointCount: sortedCheckpoints.length,
      firstExecutionDate: sortedCheckpoints[0].date,
    })
  }

  const firstExecutionDate = sortedCheckpoints[0].date
  const effectiveEndDate = normalizeDate(endDate) ?? sortedCandles.at(-1)?.date

  if (effectiveEndDate && effectiveEndDate < firstExecutionDate) {
    return createResult('invalid-range', symbol, {
      budget,
      checkpointCount: sortedCheckpoints.length,
      endDate: effectiveEndDate,
      firstExecutionDate,
    })
  }

  const valuationCandles = sortedCandles.filter(
    (candle) =>
      candle.date >= firstExecutionDate &&
      (!effectiveEndDate || candle.date <= effectiveEndDate),
  )

  if (valuationCandles.length === 0) {
    return createResult('no-prices-in-range', symbol, {
      budget,
      checkpointCount: sortedCheckpoints.length,
      endDate: effectiveEndDate,
      firstExecutionDate,
    })
  }

  const state: PortfolioState = {
    averagePrice: 0,
    cashBalance: budget,
    executedRecordCount: 0,
    shares: 0,
  }
  const points: PortfolioReturnPoint[] = []
  let checkpointIndex = 0

  for (const candle of valuationCandles) {
    let executedRecordCount = 0

    while (
      checkpointIndex < sortedCheckpoints.length &&
      sortedCheckpoints[checkpointIndex].date <= candle.date
    ) {
      const checkpoint = sortedCheckpoints[checkpointIndex]

      state.averagePrice = positiveNumber(checkpoint.averagePrice)
      state.cashBalance = finiteNumber(checkpoint.cashBalance)
      state.shares = positiveNumber(checkpoint.shares)
      state.sourceSnapshotId = checkpoint.sourceSnapshotId

      if (checkpoint.date === candle.date) {
        executedRecordCount += Math.max(
          0,
          Math.floor(finiteNumber(checkpoint.executedRecordCount)),
        )
      }

      state.executedRecordCount = executedRecordCount
      checkpointIndex += 1
    }

    const positionValue = state.shares * candle.close
    const totalAsset = state.cashBalance + positionValue
    const totalProfitLoss = totalAsset - budget

    points.push({
      averagePrice: roundMoney(state.averagePrice),
      cashBalance: roundMoney(state.cashBalance),
      close: roundMoney(candle.close),
      date: candle.date,
      executedRecordCount: state.executedRecordCount,
      positionValue: roundMoney(positionValue),
      returnPercent: roundPercent((totalProfitLoss / budget) * 100),
      shares: roundQuantity(state.shares),
      sourceSnapshotId: state.sourceSnapshotId,
      totalAsset: roundMoney(totalAsset),
      totalProfitLoss: roundMoney(totalProfitLoss),
    })
  }

  return {
    budget: roundMoney(budget),
    checkpointCount: sortedCheckpoints.length,
    endDate: valuationCandles.at(-1)?.date,
    firstExecutionDate,
    latestPoint: points.at(-1),
    points,
    startDate: valuationCandles[0].date,
    status: 'ready',
    symbol,
  }
}

function createResult(
  status: PortfolioReturnStatus,
  symbol: StrategySymbol,
  options: Partial<Omit<PortfolioReturnResult, 'points' | 'status' | 'symbol'>> = {},
): PortfolioReturnResult {
  return {
    budget: roundMoney(options.budget ?? 0),
    checkpointCount: options.checkpointCount ?? 0,
    endDate: options.endDate,
    firstExecutionDate: options.firstExecutionDate,
    latestPoint: undefined,
    points: [],
    startDate: options.startDate,
    status,
    symbol,
  }
}

function sortCheckpointsChronologically(
  checkpoints: PortfolioReturnCheckpoint[],
): PortfolioReturnCheckpoint[] {
  return checkpoints
    .map((checkpoint, index) => ({ checkpoint, index }))
    .sort((left, right) => {
      const dateComparison = left.checkpoint.date.localeCompare(
        right.checkpoint.date,
      )

      if (dateComparison !== 0) {
        return dateComparison
      }

      const createdComparison = left.checkpoint.sourceCreatedAt.localeCompare(
        right.checkpoint.sourceCreatedAt,
      )

      return createdComparison || left.index - right.index
    })
    .map(({ checkpoint }) => checkpoint)
}

function normalizeDate(value?: string): string | undefined {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : undefined
}

function finiteNumber(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function positiveNumber(value: number): number {
  return Math.max(0, finiteNumber(value))
}

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.round((value + Number.EPSILON) * 100) / 100
}

function roundPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.round((value + Number.EPSILON) * 10000) / 10000
}

function roundQuantity(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.round((value + Number.EPSILON) * 10000) / 10000
}
