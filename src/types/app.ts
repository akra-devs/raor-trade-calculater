import type { DailyCandle } from '../domain/dailyPrices'
import type { ProfitLossResult } from '../domain/profitLoss'
import type {
  GenerateOrdersResult,
  Mode,
  NextTurnCalculation,
  SplitCount,
  StrategySymbol,
} from '../domain/strategy'

export type AverageInputMode = 'costBasis' | 'averagePrice'
export type CashInputMode = 'cashBalance' | 'budgetSpent'

export interface FormState {
  symbol: StrategySymbol
  splitCount: SplitCount
  gainPercent: string
  mode: Mode
  turn: string
  cashInputMode: CashInputMode
  cashBalance: string
  initialBudget: string
  totalBuyAmount: string
  shares: string
  averageInputMode: AverageInputMode
  costBasis: string
  averagePrice: string
  previousClose: string
  reverseDays: string
  recentCloses: string[]
}

export interface OrderSnapshot {
  id: string
  createdAt: string
  referenceDate?: string
  input: FormState
  profitLoss?: ProfitLossResult
  result: GenerateOrdersResult
}

export interface NextTurnPreview {
  referenceDate?: string
  executionCandle?: DailyCandle
  calculation?: NextTurnCalculation
  isReferenceDateInferred: boolean
  message: string
}

export interface MarketDataFile {
  calendar?: string
  provider?: string
  symbol?: string
  fetchedAt?: string
  marketStatus?: unknown
  missingTradingDays?: string[]
  skippedClosedDays?: string[]
  candles?: unknown
}

export interface MarketStatus {
  calendar?: string
  date: string
  isTradingDay: boolean
  marketClose?: string
  marketOpen?: string
  nextTradingDay?: string
  previousTradingDay?: string
  status?: string
  timezone?: string
}

export interface ResultModalPayload {
  eyebrow: string
  title: string
  result: GenerateOrdersResult
}

export interface NoticeModalPayload {
  details?: string[]
  message: string
  title: string
}
