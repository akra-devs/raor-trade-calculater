import type { StrategySymbol } from './strategy'

export type ExecutionSide = 'buy' | 'sell'

export interface ExecutionRecord {
  averagePriceAfter?: number
  id: string
  createdAt: string
  date: string
  feeAmount: number
  feeRate: number
  grossAmount: number
  netCashFlow: number
  note?: string
  price: number
  quantity: number
  side: ExecutionSide
  sharesAfter?: number
  sourceOrderId?: string
  sourceSnapshotId?: string
  symbol: StrategySymbol
}

export interface ExecutionSummary {
  averagePrice?: number
  buyAmount: number
  buyQuantity: number
  feeAmount: number
  netCashFlow: number
  netQuantity: number
  positionQuantity: number
  sellAmount: number
  sellQuantity: number
}

export function calculateExecutionAmounts(
  side: ExecutionSide,
  price: number,
  quantity: number,
  feeRate: number,
): Pick<ExecutionRecord, 'feeAmount' | 'grossAmount' | 'netCashFlow'> {
  const grossAmount = roundMoney(price * quantity)
  const feeAmount = roundMoney(grossAmount * feeRate)
  const netCashFlow =
    side === 'buy'
      ? -roundMoney(grossAmount + feeAmount)
      : roundMoney(grossAmount - feeAmount)

  return {
    feeAmount,
    grossAmount,
    netCashFlow,
  }
}

export function calculateExecutionSummary(
  records: ExecutionRecord[],
): ExecutionSummary {
  const summary: ExecutionSummary = {
    buyAmount: 0,
    buyQuantity: 0,
    feeAmount: 0,
    netCashFlow: 0,
    netQuantity: 0,
    positionQuantity: 0,
    sellAmount: 0,
    sellQuantity: 0,
  }
  let costBasis = 0
  let positionQuantity = 0

  for (const record of [...records].reverse()) {
    if (record.side === 'buy') {
      summary.buyAmount += record.grossAmount
      summary.buyQuantity += record.quantity
      summary.netQuantity += record.quantity
      positionQuantity += record.quantity
      costBasis += record.grossAmount + record.feeAmount
    } else {
      summary.sellAmount += record.grossAmount
      summary.sellQuantity += record.quantity
      summary.netQuantity -= record.quantity

      const matchedSellQuantity = Math.min(record.quantity, positionQuantity)

      if (matchedSellQuantity > 0 && positionQuantity > 0) {
        costBasis *= (positionQuantity - matchedSellQuantity) / positionQuantity
        positionQuantity -= matchedSellQuantity
      }
    }

    summary.feeAmount += record.feeAmount
    summary.netCashFlow += record.netCashFlow
  }

  const latestPositionRecord = records.find(
    (record) =>
      typeof record.sharesAfter === 'number' &&
      record.sharesAfter >= 0,
  )

  if (latestPositionRecord) {
    summary.positionQuantity = roundQuantity(latestPositionRecord.sharesAfter ?? 0)
  } else {
    summary.positionQuantity = roundQuantity(positionQuantity)
  }

  if (
    latestPositionRecord &&
    summary.positionQuantity > 0 &&
    typeof latestPositionRecord.averagePriceAfter === 'number' &&
    latestPositionRecord.averagePriceAfter > 0
  ) {
    summary.averagePrice = roundMoney(latestPositionRecord.averagePriceAfter)
  } else if (positionQuantity > 0 && costBasis > 0) {
    summary.averagePrice = roundMoney(costBasis / positionQuantity)
  }

  return summary
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
