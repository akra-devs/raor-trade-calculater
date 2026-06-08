import type { Order } from './strategy'

export const TRADE_COST_RATE = 0.0005

export interface ProfitLossInput {
  averagePrice: number
  budget: number
  buyAmount?: number
  cashBalance: number
  executionPrice?: {
    close: number
    date?: string
    high?: number
  }
  markDate?: string
  markPrice: number
  orders: Order[]
  shares: number
}

export interface ExecutedProfitLossOrder {
  fee: number
  label: string
  notional: number
  side: Order['side']
}

export interface ProfitLossResult {
  budget: number
  budgetReturnPercent: number
  buyAmount: number
  buyAmountReturnPercent?: number
  cashBalanceAfterOrders: number
  executedOrderCount: number
  executedOrders: ExecutedProfitLossOrder[]
  markDate?: string
  markPrice: number
  netEquity: number
  positionExitFee: number
  positionValue: number
  remainingShares: number
  totalFees: number
  totalProfitLoss: number
}

export function calculateProfitLoss(
  input: ProfitLossInput,
): ProfitLossResult | undefined {
  const budget = normalizePositiveMoney(input.budget)
  const markPrice = normalizePositiveMoney(input.markPrice)

  if (budget <= 0 || markPrice <= 0) {
    return undefined
  }

  const executedOrders = getExecutedOrders(
    input.orders,
    input.executionPrice,
  )
  let cashBalance = normalizeMoney(input.cashBalance)
  let shares = normalizeShares(input.shares)
  let costBasis =
    shares > 0 ? shares * normalizePositiveMoney(input.averagePrice) : 0
  let buyAmount =
    normalizePositiveMoney(input.buyAmount ?? 0) || normalizePositiveMoney(costBasis)
  const executedProfitLossOrders: ExecutedProfitLossOrder[] = []
  let orderFees = 0

  for (const order of executedOrders) {
    const executionPrice = getExecutionPrice(order, input.executionPrice?.close)

    if (executionPrice <= 0) {
      continue
    }

    if (order.side === 'buy') {
      const quantity = normalizeShares(order.quantity)

      if (quantity <= 0) {
        continue
      }

      const notional = quantity * executionPrice
      const fee = notional * TRADE_COST_RATE

      cashBalance -= notional + fee
      shares += quantity
      costBasis += notional + fee
      buyAmount += notional + fee
      orderFees += fee
      executedProfitLossOrders.push({
        fee: roundMoney(fee),
        label: order.label,
        notional: roundMoney(notional),
        side: order.side,
      })
      continue
    }

    const quantity = Math.min(normalizeShares(order.quantity), shares)

    if (quantity <= 0) {
      continue
    }

    const previousShares = shares
    const notional = quantity * executionPrice
    const fee = notional * TRADE_COST_RATE

    cashBalance += notional - fee
    shares -= quantity
    costBasis =
      previousShares > 0 && shares > 0
        ? costBasis * (shares / previousShares)
        : 0
    orderFees += fee
    executedProfitLossOrders.push({
      fee: roundMoney(fee),
      label: order.label,
      notional: roundMoney(notional),
      side: order.side,
    })
  }

  const positionGrossValue = shares * markPrice
  const positionExitFee = positionGrossValue * TRADE_COST_RATE
  const positionValue = Math.max(0, positionGrossValue - positionExitFee)
  const netEquity = cashBalance + positionValue
  const totalProfitLoss = netEquity - budget
  const totalFees = orderFees + positionExitFee

  return {
    budget: roundMoney(budget),
    budgetReturnPercent: roundPercent((totalProfitLoss / budget) * 100),
    buyAmount: roundMoney(buyAmount),
    buyAmountReturnPercent:
      buyAmount > 0 ? roundPercent((totalProfitLoss / buyAmount) * 100) : undefined,
    cashBalanceAfterOrders: roundMoney(cashBalance),
    executedOrderCount: executedProfitLossOrders.length,
    executedOrders: executedProfitLossOrders,
    markDate: input.executionPrice?.date ?? input.markDate,
    markPrice: roundMoney(markPrice),
    netEquity: roundMoney(netEquity),
    positionExitFee: roundMoney(positionExitFee),
    positionValue: roundMoney(positionValue),
    remainingShares: roundShares(shares),
    totalFees: roundMoney(totalFees),
    totalProfitLoss: roundMoney(totalProfitLoss),
  }
}

function getExecutedOrders(
  orders: Order[],
  executionPrice?: ProfitLossInput['executionPrice'],
): Order[] {
  if (!executionPrice) {
    return []
  }

  const close = normalizePositiveMoney(executionPrice.close)
  const high = Math.max(
    close,
    normalizePositiveMoney(executionPrice.high ?? executionPrice.close),
  )

  if (close <= 0) {
    return []
  }

  return orders.filter((order) => didOrderExecute(order, close, high))
}

function didOrderExecute(order: Order, close: number, high: number): boolean {
  if (order.type === 'MOC') {
    return true
  }

  if (typeof order.price !== 'number' || order.price <= 0) {
    return false
  }

  if (order.type === 'LOC') {
    return order.side === 'buy' ? close <= order.price : close >= order.price
  }

  return order.side === 'sell' && high >= order.price
}

function getExecutionPrice(order: Order, close?: number): number {
  if (order.type === 'LIMIT' && typeof order.price === 'number') {
    return normalizePositiveMoney(order.price)
  }

  return normalizePositiveMoney(close ?? 0)
}

function normalizeMoney(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function normalizePositiveMoney(value: number): number {
  return Math.max(0, normalizeMoney(value))
}

function normalizeShares(value: number): number {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0))
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function roundPercent(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000
}

function roundShares(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000
}
