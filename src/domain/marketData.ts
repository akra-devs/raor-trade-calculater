import type { StrategySymbol } from './strategy'

export interface DailyClose {
  date: string
  close: number
}

export interface MarketDataProvider {
  getDailyCloses(symbol: StrategySymbol): Promise<DailyClose[]>
}

export class ManualMarketDataProvider implements MarketDataProvider {
  private readonly closesBySymbol: Partial<Record<StrategySymbol, DailyClose[]>>

  constructor(closesBySymbol: Partial<Record<StrategySymbol, DailyClose[]>> = {}) {
    this.closesBySymbol = closesBySymbol
  }

  async getDailyCloses(symbol: StrategySymbol): Promise<DailyClose[]> {
    return this.closesBySymbol[symbol] ?? []
  }
}
