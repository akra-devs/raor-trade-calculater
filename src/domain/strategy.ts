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
}

export interface GenerateOrdersResult {
  orders: Order[]
  warnings: StrategyWarning[]
  summary: CalculationSummary
}

const ORDER_LABEL: Record<OrderTag, string> = {
  INITIAL_BUY: '첫 매수',
  FRONT_HALF_BASE_BUY: '전반전 전일종가 매수',
  FRONT_HALF_STAR_BUY: '전반전 별지점 매수',
  BACK_FULL_STAR_BUY: '후반전 별지점 매수',
  STAR_SELL: '별지점 LOC 매도',
  TARGET_SELL: '목표가 매도',
  REVERSE_DAY_ONE_SELL: '리버스 첫날 MOC 매도',
  REVERSE_STAR_SELL: '리버스 LOC 매도',
  REVERSE_CASH_BUY: '리버스 현금 1/4 매수',
}

export function getStrategyConfig(
  symbol: StrategySymbol,
  splitCount: SplitCount,
  gainPercent = 15,
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
  const shares = normalizeShares(state.shares)
  const averagePrice = normalizeMoney(state.averagePrice)
  const investedAmount = shares > 0 && averagePrice > 0 ? shares * averagePrice : 0

  return roundToCent((cashBalance + investedAmount) / splitCount)
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
  referenceClose: number,
  gainPercent: number,
  splitCount: SplitCount,
  turn: number,
): {
  starPercent: number
  starSellPrice: number
  starBuyPrice: number
} | undefined {
  if (!isPositive(referenceClose)) {
    return undefined
  }

  const starPercent = calculateStarPercent(gainPercent, splitCount, turn)
  const starSellPrice = roundToCent(referenceClose * (1 + starPercent / 100))
  const starBuyPrice = roundToCent(Math.max(0.01, starSellPrice - 0.01))

  return {
    starPercent,
    starSellPrice,
    starBuyPrice,
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
  const starTurn = Math.min(Math.max(state.turn, 0), config.splitCount)
  const initialStarPercent = calculateStarPercent(
    config.gainPercent,
    config.splitCount,
    starTurn,
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
  const starTurn = Math.min(Math.max(state.turn, 0), config.splitCount)
  const starPrices = calculateStarPrices(
    previousClose,
    config.gainPercent,
    config.splitCount,
    starTurn,
  )
  const targetPrice = calculateTargetPrice(
    state.averagePrice,
    config.gainPercent,
  )

  if (isPositive(previousClose)) {
    summary.referenceClose = roundedPreviousClose
  } else {
    warnings.push({
      code: 'MISSING_PREVIOUS_CLOSE',
      message: '전일 종가가 없어 별지점 주문과 매수 주문을 만들 수 없습니다.',
    })
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

  if (state.shares > 0) {
    if (starPrices) {
      pushSellOrder(orders, warnings, {
        tag: 'STAR_SELL',
        type: 'LOC',
        quantity: Math.floor(state.shares / 4),
        price: starPrices.starSellPrice,
        note: '종가가 별 매도가 이상이면 매도 · 보유수량의 1/4',
      })
    }

    if (targetPrice) {
      pushSellOrder(orders, warnings, {
        tag: 'TARGET_SELL',
        type: 'LIMIT',
        quantity: Math.floor((state.shares * 3) / 4),
        price: targetPrice,
        note: '보유수량의 3/4',
      })
    }
  }

  if (!isPositive(previousClose)) {
    return
  }

  if (!isPositive(summary.oneBuyAmount)) {
    warnings.push({
      code: 'NO_BUYING_POWER',
      message: '1회매수금이 0달러라 매수 주문을 만들 수 없습니다.',
    })
    return
  }

  const isFirstBuy = state.turn <= 0 || state.shares <= 0

  if (isFirstBuy) {
    pushBuyOrder(orders, warnings, {
      tag: 'INITIAL_BUY',
      type: 'LOC',
      amount: summary.oneBuyAmount,
      price: roundedPreviousClose,
    })
    return
  }

  if (!starPrices) {
    return
  }

  if (state.turn < config.splitCount / 2) {
    const halfAmount = roundToCent(summary.oneBuyAmount / 2)

    pushBuyOrder(orders, warnings, {
      tag: 'FRONT_HALF_BASE_BUY',
      type: 'LOC',
      amount: halfAmount,
      price: roundedPreviousClose,
      note: '기준가=전일 종가 · 1회매수금의 1/2',
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
  if (state.reverseDays <= 0) {
    pushMocSellOrder(orders, warnings, {
      tag: 'REVERSE_DAY_ONE_SELL',
      quantity: Math.floor(state.shares / 4),
      note: '보유수량의 1/4',
    })
    return
  }

  const recentCloses = state.recentCloses.filter(isPositive).slice(-5)

  if (recentCloses.length < 5) {
    warnings.push({
      code: 'MISSING_RECENT_CLOSES',
      message: '리버스 둘째 날부터는 직전 5거래일 종가가 모두 필요합니다.',
    })
    return
  }

  const reverseAverageClose = roundToCent(
    recentCloses.reduce((total, close) => total + close, 0) / recentCloses.length,
  )
  const starPrices = calculateStarPrices(
    reverseAverageClose,
    config.gainPercent,
    config.splitCount,
    Math.min(Math.max(state.turn, 0), config.splitCount),
  )

  summary.referenceClose = reverseAverageClose
  summary.reverseAverageClose = reverseAverageClose

  if (!starPrices) {
    warnings.push({
      code: 'INVALID_PRICE',
      message: '리버스 별지점 기준 가격이 유효하지 않습니다.',
    })
    return
  }

  summary.starPercent = roundToCent(starPrices.starPercent)
  summary.starSellPrice = starPrices.starSellPrice
  summary.starBuyPrice = starPrices.starBuyPrice

  pushSellOrder(orders, warnings, {
    tag: 'REVERSE_STAR_SELL',
    type: 'LOC',
    quantity: Math.floor(state.shares / 4),
    price: starPrices.starSellPrice,
    note: '종가가 별 매도가 이상이면 매도 · 보유수량의 1/4',
  })
  pushBuyOrder(orders, warnings, {
    tag: 'REVERSE_CASH_BUY',
    type: 'LOC',
    amount: roundToCent(state.cashBalance / 4),
    price: starPrices.starBuyPrice,
    note: '종가가 별 매수가 이하이면 매수 · 잔금의 1/4',
  })
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
