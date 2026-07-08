import type { StrategySymbol } from './strategy'

export type ExecutionAnalysisSide = 'buy' | 'sell'

export interface ExecutionAnalysisRecord {
  averagePriceAfter?: number
  createdAt?: string
  date: string
  feeAmount: number
  grossAmount: number
  price: number
  quantity: number
  sharesAfter?: number
  side: ExecutionAnalysisSide
  symbol: StrategySymbol
}

export interface ExecutionAnalysisInput {
  endDate?: string
  records: readonly ExecutionAnalysisRecord[]
  startDate?: string
  symbol: StrategySymbol
}

export interface ExecutionAnalysisResult {
  averagePrice?: number
  effectiveEndDate?: string
  effectiveStartDate?: string
  isInvalidPeriod: boolean
  matchedRecordCount: number
  positionQuantity: number
  sellAmount: number
  sellAveragePrice?: number
  sellFeeAmount: number
  sellQuantity: number
  sellRecordCount: number
  symbolRecordCount: number
}

export function calculateExecutionAnalysis({
  endDate,
  records,
  startDate,
  symbol,
}: ExecutionAnalysisInput): ExecutionAnalysisResult {
  const normalizedStartDate = normalizeDate(startDate)
  const normalizedEndDate = normalizeDate(endDate)
  const symbolRecords = records.filter((record) => record.symbol === symbol)
  const dateRange = resolveDateRange(
    symbolRecords,
    normalizedStartDate,
    normalizedEndDate,
  )

  if (dateRange.isInvalidPeriod) {
    return createEmptyResult(symbolRecords.length, true)
  }

  const periodRecords = symbolRecords.filter((record) =>
    isRecordInPeriod(record, normalizedStartDate, normalizedEndDate),
  )
  const sellRecords = periodRecords.filter((record) => record.side === 'sell')
  const sellAmount = roundMoney(
    sellRecords.reduce((total, record) => total + positiveNumber(record.grossAmount), 0),
  )
  const sellQuantity = roundQuantity(
    sellRecords.reduce((total, record) => total + positiveNumber(record.quantity), 0),
  )
  const sellFeeAmount = roundMoney(
    sellRecords.reduce((total, record) => total + positiveNumber(record.feeAmount), 0),
  )
  const position = calculatePositionAtEnd(symbolRecords, normalizedEndDate)

  return {
    averagePrice: position.averagePrice,
    effectiveEndDate: dateRange.effectiveEndDate,
    effectiveStartDate: dateRange.effectiveStartDate,
    isInvalidPeriod: false,
    matchedRecordCount: periodRecords.length,
    positionQuantity: position.quantity,
    sellAmount,
    sellAveragePrice:
      sellQuantity > 0 && sellAmount > 0
        ? roundMoney(sellAmount / sellQuantity)
        : undefined,
    sellFeeAmount,
    sellQuantity,
    sellRecordCount: sellRecords.length,
    symbolRecordCount: symbolRecords.length,
  }
}

function createEmptyResult(
  symbolRecordCount: number,
  isInvalidPeriod: boolean,
): ExecutionAnalysisResult {
  return {
    isInvalidPeriod,
    matchedRecordCount: 0,
    positionQuantity: 0,
    sellAmount: 0,
    sellFeeAmount: 0,
    sellQuantity: 0,
    sellRecordCount: 0,
    symbolRecordCount,
  }
}

function resolveDateRange(
  records: readonly ExecutionAnalysisRecord[],
  startDate?: string,
  endDate?: string,
): {
  effectiveEndDate?: string
  effectiveStartDate?: string
  isInvalidPeriod: boolean
} {
  if (startDate && endDate && startDate > endDate) {
    return {
      isInvalidPeriod: true,
    }
  }

  const sortedRecords = sortRecordsChronologically(records)
  const firstDate = sortedRecords[0]?.date
  const lastDate = sortedRecords.at(-1)?.date

  return {
    effectiveEndDate: endDate ?? lastDate,
    effectiveStartDate: startDate ?? firstDate,
    isInvalidPeriod: false,
  }
}

function isRecordInPeriod(
  record: ExecutionAnalysisRecord,
  startDate?: string,
  endDate?: string,
): boolean {
  if (startDate && record.date < startDate) {
    return false
  }

  if (endDate && record.date > endDate) {
    return false
  }

  return true
}

function calculatePositionAtEnd(
  records: readonly ExecutionAnalysisRecord[],
  endDate?: string,
): {
  averagePrice?: number
  quantity: number
} {
  let costBasis = 0
  let quantity = 0
  let latestMetadata:
    | Pick<ExecutionAnalysisRecord, 'averagePriceAfter' | 'sharesAfter'>
    | undefined

  for (const record of sortRecordsChronologically(records)) {
    if (endDate && record.date > endDate) {
      continue
    }

    if (record.side === 'buy') {
      const buyQuantity = positiveNumber(record.quantity)

      quantity += buyQuantity
      costBasis += positiveNumber(record.grossAmount) + positiveNumber(record.feeAmount)
    } else {
      const sellQuantity = Math.min(positiveNumber(record.quantity), quantity)

      if (sellQuantity > 0 && quantity > 0) {
        costBasis *= (quantity - sellQuantity) / quantity
        quantity -= sellQuantity
      }
    }

    if (
      typeof record.sharesAfter === 'number' &&
      Number.isFinite(record.sharesAfter) &&
      record.sharesAfter >= 0
    ) {
      latestMetadata = {
        averagePriceAfter:
          typeof record.averagePriceAfter === 'number' &&
          Number.isFinite(record.averagePriceAfter) &&
          record.averagePriceAfter > 0
            ? record.averagePriceAfter
            : undefined,
        sharesAfter: record.sharesAfter,
      }
    }
  }

  if (latestMetadata) {
    const metadataQuantity = roundQuantity(latestMetadata.sharesAfter ?? 0)

    return {
      averagePrice:
        metadataQuantity > 0 && typeof latestMetadata.averagePriceAfter === 'number'
          ? roundMoney(latestMetadata.averagePriceAfter)
          : undefined,
      quantity: metadataQuantity,
    }
  }

  const roundedQuantity = roundQuantity(quantity)

  return {
    averagePrice:
      roundedQuantity > 0 && costBasis > 0
        ? roundMoney(costBasis / roundedQuantity)
        : undefined,
    quantity: roundedQuantity,
  }
}

function sortRecordsChronologically(
  records: readonly ExecutionAnalysisRecord[],
): ExecutionAnalysisRecord[] {
  return records
    .map((record, index) => ({ index, record }))
    .sort((left, right) => {
      const dateComparison = left.record.date.localeCompare(right.record.date)

      if (dateComparison !== 0) {
        return dateComparison
      }

      const createdComparison = (left.record.createdAt ?? '').localeCompare(
        right.record.createdAt ?? '',
      )

      return createdComparison || left.index - right.index
    })
    .map(({ record }) => record)
}

function normalizeDate(value?: string): string | undefined {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : undefined
}

function positiveNumber(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.round((value + Number.EPSILON) * 100) / 100
}

function roundQuantity(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.round((value + Number.EPSILON) * 10000) / 10000
}
