export const SUPPORTED_SPLITS = [20, 30, 40] as const

export type StrategySymbol = 'TQQQ' | 'SOXL'
export type SplitCount = (typeof SUPPORTED_SPLITS)[number]
export type Mode = 'normal' | 'reverse'
export type Side = 'buy' | 'sell'
export type OrderType = 'LIMIT' | 'LOC' | 'MOC'

export type OrderTag =
  | 'INITIAL_BUY'
  | 'FRONT_HALF_BASE_BUY'
  | 'FRONT_HALF_STAR_BUY'
  | 'BACK_FULL_STAR_BUY'
  | 'STAR_SELL'
  | 'TARGET_SELL'
  | 'REVERSE_DAY_ONE_SELL'
  | 'REVERSE_STAR_SELL'
  | 'REVERSE_CASH_BUY'

export type WarningCode =
  | 'AUTO_REVERSE'
  | 'INVALID_PRICE'
  | 'MISSING_AVERAGE_PRICE'
  | 'MISSING_PREVIOUS_CLOSE'
  | 'MISSING_RECENT_CLOSES'
  | 'NO_BUYING_POWER'
  | 'ZERO_QUANTITY_ORDER'

export interface StrategyConfig {
  symbol: StrategySymbol
  splitCount: SplitCount
  gainPercent: number
}

export interface StrategyState {
  mode: Mode
  turn: number
  cashBalance: number
  shares: number
  averagePrice: number
  previousClose: number
  reverseDays: number
  recentCloses: number[]
}

export interface Order {
  id: string
  side: Side
  type: OrderType
  tag: OrderTag
  label: string
  quantity: number
  price?: number
  amount?: number
  note?: string
}

export interface StrategyWarning {
  code: WarningCode
  message: string
  tag?: OrderTag
}

export interface CalculationSummary {
  configuredMode: Mode
  effectiveMode: Mode
  wasAutoReversed: boolean
  gainPercent: number
  splitCount: SplitCount
  turn: number
  starPercent: number
  oneBuyAmount: number
  capitalBase: number
  targetPrice?: number
  starSellPrice?: number
  starBuyPrice?: number
  referenceClose?: number
  reverseAverageClose?: number
  reverseBuyBudget?: number
}

export interface GenerateOrdersResult {
  orders: Order[]
  warnings: StrategyWarning[]
  summary: CalculationSummary
}

export interface ExecutionPrice {
  close: number
  high?: number
}

export interface NextTurnCalculation {
  previousTurn: number
  nextTurn: number
  previousShares: number
  nextShares: number
  previousCashBalance: number
  nextCashBalance: number
  previousAveragePrice: number
  nextAveragePrice: number
  effectiveMode: Mode
  nextMode: Mode
  executedOrderTags: OrderTag[]
  close: number
  high: number
  usedHighForLimitSell: boolean
  isCycleComplete: boolean
  didExitReverse: boolean
}

const ORDER_LABEL: Record<OrderTag, string> = {
  INITIAL_BUY: '첫 매수',
  FRONT_HALF_BASE_BUY: '전반전 평단 매수',
  FRONT_HALF_STAR_BUY: '전반전 별지점 매수',
  BACK_FULL_STAR_BUY: '후반전 별지점 매수',
  STAR_SELL: '별지점 LOC 매도',
  TARGET_SELL: '목표가 매도',
  REVERSE_DAY_ONE_SELL: '리버스 첫날 MOC 매도',
  REVERSE_STAR_SELL: '리버스 LOC 매도',
  REVERSE_CASH_BUY: '리버스 현금 1/4 매수',
}

const DEFAULT_TARGET_PROFIT_PERCENT: Record<StrategySymbol, number> = {
  TQQQ: 15,
  SOXL: 20,
}
const INITIAL_BUY_MARKUP_PERCENT = 15

export function getDefaultTargetProfitPercent(symbol: StrategySymbol): number {
  return DEFAULT_TARGET_PROFIT_PERCENT[symbol]
}

export function getStrategyConfig(
  symbol: StrategySymbol,
  splitCount: SplitCount,
  gainPercent = getDefaultTargetProfitPercent(symbol),
): StrategyConfig {
  return {
    symbol,
    splitCount,
    gainPercent: normalizeGainPercent(gainPercent),
  }
}

export function roundToCent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function floorQuantity(amount: number, orderPrice: number): number {
  if (!isPositive(amount) || !isPositive(orderPrice)) {
    return 0
  }

  return Math.floor(amount / orderPrice)
}

export function calculateStarPercent(
  gainPercent: number,
  splitCount: SplitCount,
  turn: number,
): number {
  return gainPercent * (1 - (2 * turn) / splitCount)
}

export function calculateOneBuyAmount(
  state: StrategyState,
  splitCount: SplitCount,
): number {
  const cashBalance = normalizeMoney(state.cashBalance)
  const turn = Math.max(0, normalizeNumber(state.turn))
  const denominator =
    normalizeShares(state.shares) <= 0 && turn <= 0 ? splitCount : splitCount - turn

  if (!isPositive(cashBalance) || !isPositive(denominator)) {
    return 0
  }

  return roundToCent(cashBalance / denominator)
}

export function calculateTargetPrice(
  averagePrice: number,
  gainPercent: number,
): number | undefined {
  if (!isPositive(averagePrice)) {
    return undefined
  }

  return roundToCent(averagePrice * (1 + gainPercent / 100))
}

export function calculateStarPrices(
  averagePrice: number,
  gainPercent: number,
  splitCount: SplitCount,
  turn: number,
): {
  starPercent: number
  starSellPrice: number
  starBuyPrice: number
} | undefined {
  if (!isPositive(averagePrice)) {
    return undefined
  }

  const starPercent = calculateStarPercent(gainPercent, splitCount, turn)
  const starSellPrice = roundToCent(averagePrice * (1 + starPercent / 100))
  const starBuyPrice = roundToCent(Math.max(0.01, starSellPrice - 0.01))

  return {
    starPercent,
    starSellPrice,
    starBuyPrice,
  }
}

export function calculateReverseStarPoint(
  recentCloses: number[],
): number | undefined {
  const closes = recentCloses.map(normalizeMoney).slice(-5)

  if (closes.length < 5 || closes.some((close) => !isPositive(close))) {
    return undefined
  }

  return roundToCent(
    closes.reduce((total, close) => total + close, 0) / closes.length,
  )
}

export function calculateReverseSellQuantity(
  shares: number,
  splitCount: SplitCount,
): number {
  return Math.floor(normalizeShares(shares) / (splitCount / 2))
}

export function calculateNormalTurnAfterBuy(
  turn: number,
  buyUnits: 1 | 0.5 = 1,
): number {
  return normalizeNumber(turn) + buyUnits
}

export function calculateNormalTurnAfterQuarterSell(turn: number): number {
  return normalizeNumber(turn) * 0.75
}

export function calculateNormalTurnAfterLimitSellAndLocBuy(
  turn: number,
  buyUnits: 1 | 0.5,
): number {
  return normalizeNumber(turn) * 0.25 + buyUnits
}

export function calculateReverseTurnAfterSell(
  turn: number,
  splitCount: SplitCount,
): number {
  return normalizeNumber(turn) * (1 - 2 / splitCount)
}

export function calculateReverseTurnAfterBuy(
  turn: number,
  splitCount: SplitCount,
): number {
  const normalizedTurn = normalizeNumber(turn)

  return normalizedTurn + (splitCount - normalizedTurn) * 0.25
}

export function calculateReverseExitPrice(
  averagePrice: number,
  gainPercent: number,
): number | undefined {
  if (!isPositive(averagePrice)) {
    return undefined
  }

  return roundToCent(averagePrice * (1 - gainPercent / 100))
}

export function shouldExitReverseMode(
  close: number,
  averagePrice: number,
  gainPercent: number,
): boolean {
  const exitPrice = calculateReverseExitPrice(averagePrice, gainPercent)

  return typeof exitPrice === 'number' && close > exitPrice
}

export function calculateNextTurnFromExecution(
  config: StrategyConfig,
  rawState: StrategyState,
  orders: Order[],
  executionPrice: ExecutionPrice,
): NextTurnCalculation | undefined {
  const state = normalizeState(rawState)
  const close = normalizeMoney(executionPrice.close)

  if (!isPositive(close)) {
    return undefined
  }

  const high = Math.max(
    close,
    normalizeMoney(executionPrice.high ?? executionPrice.close),
  )
  const effectiveMode: Mode =
    state.mode === 'normal' && state.turn > config.splitCount - 1
      ? 'reverse'
      : state.mode
  const executedOrders = orders.filter((order) =>
    didOrderExecute(order, close, high),
  )
  const executedOrderTags = executedOrders.map((order) => order.tag)
  const usedHighForLimitSell = executedOrders.some(
    (order) => order.type === 'LIMIT',
  )
  const previousTurn = state.turn
  const nextPosition = calculateNextPositionFromExecutedOrders(
    state,
    executedOrders,
    close,
  )
  let nextTurn = previousTurn
  let nextMode: Mode
  let isCycleComplete = false
  let didExitReverse = false

  if (effectiveMode === 'normal') {
    const buyUnits = calculateNormalExecutedBuyUnits(executedOrderTags)
    const didQuarterSell = executedOrderTags.includes('STAR_SELL')
    const didTargetSell = executedOrderTags.includes('TARGET_SELL')

    if (didTargetSell) {
      isCycleComplete = didQuarterSell && buyUnits === 0
      nextTurn = isCycleComplete
        ? 0
        : calculateNormalTurnAfterLimitSellAndLocBuy(
            previousTurn,
            buyUnits === 1 ? 1 : 0.5,
          )

      if (buyUnits === 0 && !isCycleComplete) {
        nextTurn = previousTurn * 0.25
      }
    } else if (didQuarterSell) {
      nextTurn = calculateNormalTurnAfterQuarterSell(previousTurn)
    } else if (buyUnits > 0) {
      nextTurn = previousTurn + buyUnits
    }

    nextMode =
      !isCycleComplete && nextTurn > config.splitCount - 1 ? 'reverse' : 'normal'
  } else {
    if (
      executedOrderTags.includes('REVERSE_DAY_ONE_SELL') ||
      executedOrderTags.includes('REVERSE_STAR_SELL')
    ) {
      nextTurn = calculateReverseTurnAfterSell(previousTurn, config.splitCount)
    }

    if (executedOrderTags.includes('REVERSE_CASH_BUY')) {
      nextTurn = calculateReverseTurnAfterBuy(nextTurn, config.splitCount)
    }

    didExitReverse = shouldExitReverseMode(
      close,
      state.averagePrice,
      config.gainPercent,
    )
    nextMode = didExitReverse ? 'normal' : 'reverse'
  }

  return {
    previousTurn,
    nextTurn,
    previousShares: state.shares,
    nextShares: nextPosition.shares,
    previousCashBalance: state.cashBalance,
    nextCashBalance: nextPosition.cashBalance,
    previousAveragePrice: state.averagePrice,
    nextAveragePrice: nextPosition.averagePrice,
    effectiveMode,
    nextMode,
    executedOrderTags,
    close,
    high,
    usedHighForLimitSell,
    isCycleComplete,
    didExitReverse,
  }
}

export function generateOrders(
  config: StrategyConfig,
  rawState: StrategyState,
): GenerateOrdersResult {
  const state = normalizeState(rawState)
  const wasAutoReversed =
    state.mode === 'normal' && state.turn > config.splitCount - 1
  const effectiveMode: Mode =
    wasAutoReversed || state.mode === 'reverse' ? 'reverse' : 'normal'
  const warnings: StrategyWarning[] = []
  const orders: Order[] = []
  const oneBuyAmount = calculateOneBuyAmount(state, config.splitCount)
  const capitalBase = roundToCent(
    state.cashBalance + state.shares * state.averagePrice,
  )
  const initialStarPercent = calculateStarPercent(
    config.gainPercent,
    config.splitCount,
    Math.max(state.turn, 0),
  )
  const summary: CalculationSummary = {
    configuredMode: state.mode,
    effectiveMode,
    wasAutoReversed,
    gainPercent: config.gainPercent,
    splitCount: config.splitCount,
    turn: state.turn,
    starPercent: roundToCent(initialStarPercent),
    oneBuyAmount,
    capitalBase,
  }

  if (wasAutoReversed) {
    warnings.push({
      code: 'AUTO_REVERSE',
      message: `T값 ${formatNumber(state.turn)}이 ${config.splitCount - 1}을 초과해 리버스모드 주문으로 전환했습니다.`,
    })
  }

  if (effectiveMode === 'normal') {
    generateNormalOrders(config, state, summary, warnings, orders)
  } else {
    generateReverseOrders(config, state, summary, warnings, orders)
  }

  return {
    orders,
    warnings,
    summary,
  }
}

function generateNormalOrders(
  config: StrategyConfig,
  state: StrategyState,
  summary: CalculationSummary,
  warnings: StrategyWarning[],
  orders: Order[],
) {
  const previousClose = normalizeMoney(state.previousClose)
  const roundedPreviousClose = roundToCent(previousClose)
  const starPrices = calculateStarPrices(
    state.averagePrice,
    config.gainPercent,
    config.splitCount,
    Math.max(state.turn, 0),
  )
  const targetPrice = calculateTargetPrice(
    state.averagePrice,
    config.gainPercent,
  )

  if (isPositive(previousClose)) {
    summary.referenceClose = roundedPreviousClose
  }

  if (starPrices) {
    summary.starPercent = roundToCent(starPrices.starPercent)
    summary.starSellPrice = starPrices.starSellPrice
    summary.starBuyPrice = starPrices.starBuyPrice
  }

  if (targetPrice) {
    summary.targetPrice = targetPrice
  } else if (state.shares > 0) {
    warnings.push({
      code: 'MISSING_AVERAGE_PRICE',
      message: '평단가 또는 총 매수원금이 없어 목표가 매도를 만들 수 없습니다.',
    })
  }

  const isFirstBuy = state.turn <= 0 && state.shares <= 0

  if (isFirstBuy) {
    if (!isPositive(previousClose)) {
      warnings.push({
        code: 'MISSING_PREVIOUS_CLOSE',
        message: '첫 매수 LOC 상한가 계산에 필요한 전일 종가가 없습니다.',
      })
      return
    }

    if (!isPositive(summary.oneBuyAmount)) {
      warnings.push({
        code: 'NO_BUYING_POWER',
        message: '1회매수금이 0달러라 매수 주문을 만들 수 없습니다.',
      })
      return
    }

    pushBuyOrder(orders, warnings, {
      tag: 'INITIAL_BUY',
      type: 'LOC',
      amount: summary.oneBuyAmount,
      price: calculateInitialBuyPrice(roundedPreviousClose),
      note: `전일 종가보다 ${INITIAL_BUY_MARKUP_PERCENT}% 높은 LOC 상한가`,
    })
    return
  }

  if (!starPrices) {
    if (state.shares > 0 || state.turn > 0) {
      warnings.push({
        code: 'MISSING_AVERAGE_PRICE',
        message: '평단가 또는 총 매수원금이 없어 별지점 주문을 만들 수 없습니다.',
      })
    }
    return
  }

  if (state.shares > 0) {
    const quarterSellQuantity = Math.floor(state.shares / 4)

    if (starPrices) {
      pushSellOrder(orders, warnings, {
        tag: 'STAR_SELL',
        type: 'LOC',
        quantity: quarterSellQuantity,
        price: starPrices.starSellPrice,
        note: '종가가 별 매도가 이상이면 매도 · 보유수량의 1/4',
      })
    }

    if (targetPrice) {
      pushSellOrder(orders, warnings, {
        tag: 'TARGET_SELL',
        type: 'LIMIT',
        quantity: state.shares - quarterSellQuantity,
        price: targetPrice,
        note: '쿼터매도 대상이 아닌 나머지 보유수량',
      })
    }
  }

  if (!isPositive(summary.oneBuyAmount)) {
    warnings.push({
      code: 'NO_BUYING_POWER',
      message: '1회매수금이 0달러라 매수 주문을 만들 수 없습니다.',
    })
    return
  }

  if (state.turn < config.splitCount / 2) {
    const halfAmount = roundToCent(summary.oneBuyAmount / 2)

    pushBuyOrder(orders, warnings, {
      tag: 'FRONT_HALF_BASE_BUY',
      type: 'LOC',
      amount: halfAmount,
      price: state.averagePrice,
      note: '평단가 LOC 매수 · 1회매수금의 1/2',
    })
    pushBuyOrder(orders, warnings, {
      tag: 'FRONT_HALF_STAR_BUY',
      type: 'LOC',
      amount: halfAmount,
      price: starPrices.starBuyPrice,
      note: '종가가 별 매수가 이하이면 매수 · 1회매수금의 1/2',
    })
    return
  }

  pushBuyOrder(orders, warnings, {
    tag: 'BACK_FULL_STAR_BUY',
    type: 'LOC',
    amount: summary.oneBuyAmount,
    price: starPrices.starBuyPrice,
    note: '종가가 별 매수가 이하이면 매수 · 1회매수금 전액',
  })
}

function generateReverseOrders(
  config: StrategyConfig,
  state: StrategyState,
  summary: CalculationSummary,
  warnings: StrategyWarning[],
  orders: Order[],
) {
  summary.starPercent = 0

  if (state.reverseDays <= 0) {
    pushMocSellOrder(orders, warnings, {
      tag: 'REVERSE_DAY_ONE_SELL',
      quantity: calculateReverseSellQuantity(state.shares, config.splitCount),
      note: `보유수량 / ${config.splitCount / 2} 내림`,
    })
    return
  }

  const reverseAverageClose = calculateReverseStarPoint(state.recentCloses)

  if (typeof reverseAverageClose !== 'number') {
    warnings.push({
      code: 'MISSING_RECENT_CLOSES',
      message: '리버스 둘째 날부터는 직전 5거래일 종가가 모두 필요합니다.',
    })
    return
  }

  const reverseBuyPrice = roundToCent(Math.max(0.01, reverseAverageClose - 0.01))
  const reverseBuyBudget = roundToCent(state.cashBalance / 4)

  summary.referenceClose = reverseAverageClose
  summary.reverseAverageClose = reverseAverageClose
  summary.starSellPrice = reverseAverageClose
  summary.starBuyPrice = reverseBuyPrice
  summary.reverseBuyBudget = reverseBuyBudget

  pushSellOrder(orders, warnings, {
    tag: 'REVERSE_STAR_SELL',
    type: 'LOC',
    quantity: calculateReverseSellQuantity(state.shares, config.splitCount),
    price: reverseAverageClose,
    note: `리버스 별지점 이상이면 매도 · 보유수량 / ${config.splitCount / 2} 내림`,
  })
  pushBuyOrder(orders, warnings, {
    tag: 'REVERSE_CASH_BUY',
    type: 'LOC',
    amount: reverseBuyBudget,
    price: reverseBuyPrice,
    note: '리버스 별지점 - 0.01 이하이면 매수 · 잔금의 1/4',
  })
}

function calculateInitialBuyPrice(previousClose: number): number {
  return roundToCent(previousClose * (1 + INITIAL_BUY_MARKUP_PERCENT / 100))
}

function didOrderExecute(order: Order, close: number, high: number): boolean {
  if (order.type === 'MOC') {
    return true
  }

  if (typeof order.price !== 'number') {
    return false
  }

  if (order.type === 'LOC') {
    return order.side === 'buy' ? close <= order.price : close >= order.price
  }

  return order.side === 'sell' && high >= order.price
}

function calculateNextPositionFromExecutedOrders(
  state: StrategyState,
  executedOrders: Order[],
  close: number,
): {
  shares: number
  cashBalance: number
  averagePrice: number
} {
  let shares = normalizeShares(state.shares)
  let cashBalance = normalizeMoney(state.cashBalance)
  let costBasis =
    shares > 0 && isPositive(state.averagePrice) ? shares * state.averagePrice : 0

  for (const order of executedOrders) {
    const executionPrice = getExecutionPrice(order, close)

    if (!isPositive(executionPrice)) {
      continue
    }

    if (order.side === 'buy') {
      const quantity = normalizeShares(order.quantity)

      if (quantity <= 0) {
        continue
      }

      shares += quantity
      cashBalance -= quantity * executionPrice
      costBasis += quantity * executionPrice
      continue
    }

    const quantity = Math.min(normalizeShares(order.quantity), shares)

    if (quantity <= 0) {
      continue
    }

    const previousShares = shares
    shares -= quantity
    cashBalance += quantity * executionPrice
    costBasis =
      previousShares > 0 && shares > 0
        ? costBasis * (shares / previousShares)
        : 0
  }

  return {
    shares,
    cashBalance: roundToCent(Math.max(0, cashBalance)),
    averagePrice: shares > 0 ? roundToCent(costBasis / shares) : 0,
  }
}

function getExecutionPrice(order: Order, close: number): number {
  if (order.type === 'LIMIT' && typeof order.price === 'number') {
    return roundToCent(order.price)
  }

  return roundToCent(close)
}

function calculateNormalExecutedBuyUnits(executedOrderTags: OrderTag[]): number {
  return executedOrderTags.reduce((total, tag) => {
    if (tag === 'INITIAL_BUY' || tag === 'BACK_FULL_STAR_BUY') {
      return total + 1
    }

    if (tag === 'FRONT_HALF_BASE_BUY' || tag === 'FRONT_HALF_STAR_BUY') {
      return total + 0.5
    }

    return total
  }, 0)
}

function pushBuyOrder(
  orders: Order[],
  warnings: StrategyWarning[],
  input: {
    tag: OrderTag
    type: Extract<OrderType, 'LIMIT' | 'LOC'>
    amount: number
    price: number
    note?: string
  },
) {
  const price = roundToCent(input.price)
  const amount = roundToCent(input.amount)
  const quantity = floorQuantity(amount, price)

  if (quantity <= 0) {
    pushZeroQuantityWarning(warnings, input.tag)
    return
  }

  orders.push({
    id: `${orders.length + 1}-${input.tag}`,
    side: 'buy',
    type: input.type,
    tag: input.tag,
    label: ORDER_LABEL[input.tag],
    quantity,
    price,
    amount,
    note: input.note,
  })
}

function pushSellOrder(
  orders: Order[],
  warnings: StrategyWarning[],
  input: {
    tag: OrderTag
    type: Extract<OrderType, 'LIMIT' | 'LOC'>
    quantity: number
    price: number
    note?: string
  },
) {
  const quantity = normalizeShares(input.quantity)
  const price = roundToCent(input.price)

  if (quantity <= 0) {
    pushZeroQuantityWarning(warnings, input.tag)
    return
  }

  if (!isPositive(price)) {
    warnings.push({
      code: 'INVALID_PRICE',
      tag: input.tag,
      message: `${ORDER_LABEL[input.tag]} 가격이 유효하지 않아 주문에서 제외했습니다.`,
    })
    return
  }

  orders.push({
    id: `${orders.length + 1}-${input.tag}`,
    side: 'sell',
    type: input.type,
    tag: input.tag,
    label: ORDER_LABEL[input.tag],
    quantity,
    price,
    amount: roundToCent(quantity * price),
    note: input.note,
  })
}

function pushMocSellOrder(
  orders: Order[],
  warnings: StrategyWarning[],
  input: {
    tag: OrderTag
    quantity: number
    note?: string
  },
) {
  const quantity = normalizeShares(input.quantity)

  if (quantity <= 0) {
    pushZeroQuantityWarning(warnings, input.tag)
    return
  }

  orders.push({
    id: `${orders.length + 1}-${input.tag}`,
    side: 'sell',
    type: 'MOC',
    tag: input.tag,
    label: ORDER_LABEL[input.tag],
    quantity,
    note: input.note,
  })
}

function pushZeroQuantityWarning(
  warnings: StrategyWarning[],
  tag: OrderTag,
) {
  warnings.push({
    code: 'ZERO_QUANTITY_ORDER',
    tag,
    message: `${ORDER_LABEL[tag]} 수량이 0주라 주문에서 제외했습니다.`,
  })
}

function normalizeState(state: StrategyState): StrategyState {
  return {
    mode: state.mode,
    turn: normalizeNumber(state.turn),
    cashBalance: normalizeMoney(state.cashBalance),
    shares: normalizeShares(state.shares),
    averagePrice: normalizeMoney(state.averagePrice),
    previousClose: normalizeMoney(state.previousClose),
    reverseDays: Math.max(0, Math.floor(normalizeNumber(state.reverseDays))),
    recentCloses: state.recentCloses.map(normalizeMoney),
  }
}

function normalizeMoney(value: number): number {
  return Math.max(0, normalizeNumber(value))
}

function normalizeShares(value: number): number {
  return Math.max(0, Math.floor(normalizeNumber(value)))
}

function normalizeNumber(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function normalizeGainPercent(value: number): number {
  return Math.max(0, normalizeNumber(value))
}

function isPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('ko-KR', {
    maximumFractionDigits: 2,
  }).format(value)
}
