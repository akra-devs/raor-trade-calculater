import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'
import { CandlestickChart } from './components/CandlestickChart'
import {
  PRICE_INTERVALS,
  aggregateCandles,
  getRecentClosesUntil,
  normalizeDailyCandle,
  sortDailyCandles,
  type DailyCandle,
  type PriceInterval,
} from './domain/dailyPrices'
import {
  TRADE_COST_RATE,
  calculateProfitLoss,
  type ExecutedProfitLossOrder,
  type ProfitLossResult,
} from './domain/profitLoss'
import {
  SUPPORTED_SPLITS,
  calculateNextTurnFromExecution,
  generateOrders,
  getDefaultTargetProfitPercent,
  getStrategyConfig,
  type GenerateOrdersResult,
  type NextTurnCalculation,
  type Mode,
  type SplitCount,
  type StrategyState,
  type StrategySymbol,
} from './domain/strategy'

type AverageInputMode = 'costBasis' | 'averagePrice'
type CashInputMode = 'cashBalance' | 'budgetSpent'

interface FormState {
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

interface OrderSnapshot {
  id: string
  createdAt: string
  referenceDate?: string
  input: FormState
  profitLoss?: ProfitLossResult
  result: GenerateOrdersResult
}

interface NextTurnPreview {
  referenceDate?: string
  executionCandle?: DailyCandle
  calculation?: NextTurnCalculation
  isReferenceDateInferred: boolean
  message: string
}

interface MarketDataFile {
  calendar?: string
  provider?: string
  symbol?: string
  fetchedAt?: string
  missingTradingDays?: string[]
  skippedClosedDays?: string[]
  candles?: unknown
}

interface ResultModalPayload {
  eyebrow: string
  title: string
  result: GenerateOrdersResult
}

interface NoticeModalPayload {
  details?: string[]
  message: string
  title: string
}

interface NumberFieldProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  min?: string
  readOnly?: boolean
  step?: string
  suffix?: string
}

const STORAGE_INPUT_KEY = 'raor:v1:input'
const STORAGE_SYMBOL_INPUTS_KEY = 'raor:v1:symbol-inputs'
const STORAGE_HISTORY_KEY = 'raor:v1:order-snapshots'
const PRICE_TABLE_PAGE_SIZE = 5
const HISTORY_PAGE_SIZE = 7

const priceIntervalLabel: Record<PriceInterval, string> = {
  day: '일봉',
  week: '주봉',
  month: '월봉',
  year: '년봉',
}

const DEFAULT_FORM: FormState = {
  symbol: 'TQQQ',
  splitCount: 20,
  gainPercent: String(getDefaultTargetProfitPercent('TQQQ')),
  mode: 'normal',
  turn: '0',
  cashInputMode: 'cashBalance',
  cashBalance: '40000',
  initialBudget: '40000',
  totalBuyAmount: '',
  shares: '0',
  averageInputMode: 'costBasis',
  costBasis: '',
  averagePrice: '0',
  previousClose: '100',
  reverseDays: '0',
  recentCloses: ['', '', '', '', ''],
}

const symbolOptions: StrategySymbol[] = ['TQQQ', 'SOXL']

function createDefaultFormForSymbol(symbol: StrategySymbol): FormState {
  return {
    ...DEFAULT_FORM,
    symbol,
    gainPercent: String(getDefaultTargetProfitPercent(symbol)),
  }
}

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})

const numberFormatter = new Intl.NumberFormat('ko-KR', {
  maximumFractionDigits: 2,
})

function App() {
  const [form, setForm] = useState<FormState>(() => loadFormState())
  const [symbolForms, setSymbolForms] = useState<Record<StrategySymbol, FormState>>(
    () => loadSymbolFormStates(form),
  )
  const [resultModal, setResultModal] = useState<ResultModalPayload | null>(null)
  const [noticeModal, setNoticeModal] = useState<NoticeModalPayload | null>(null)
  const [history, setHistory] = useState<OrderSnapshot[]>(() => loadHistory())
  const [historyPage, setHistoryPage] = useState(1)
  const [dailyCandles, setDailyCandles] = useState<
    Record<StrategySymbol, DailyCandle[]>
  >(() => ({ TQQQ: [], SOXL: [] }))
  const [priceMessage, setPriceMessage] = useState('')
  const [marketDataLoading, setMarketDataLoading] = useState(false)
  const [priceInterval, setPriceInterval] = useState<PriceInterval>('day')
  const [selectedDate, setSelectedDate] = useState('')
  const [showRecentCloses, setShowRecentCloses] = useState(false)
  const selectedConfig = useMemo(
    () =>
      getStrategyConfig(
        form.symbol,
        form.splitCount,
        parseOptionalNumber(form.gainPercent),
      ),
    [form.gainPercent, form.splitCount, form.symbol],
  )
  const activeDailyCandles = useMemo(
    () => dailyCandles[form.symbol] ?? [],
    [dailyCandles, form.symbol],
  )
  const visibleCandles = useMemo(
    () => aggregateCandles(activeDailyCandles, priceInterval),
    [activeDailyCandles, priceInterval],
  )
  const effectiveSelectedDate = useMemo(() => {
    if (selectedDate && activeDailyCandles.some((candle) => candle.date === selectedDate)) {
      return selectedDate
    }

    const inferredDate = inferSelectedDateFromForm(form, activeDailyCandles)

    if (inferredDate) {
      return inferredDate
    }

    return activeDailyCandles.at(-1)?.date ?? ''
  }, [activeDailyCandles, form, selectedDate])
  const selectedDailyCandle = useMemo(
    () => activeDailyCandles.find((candle) => candle.date === effectiveSelectedDate),
    [activeDailyCandles, effectiveSelectedDate],
  )
  const selectedOrderDate = useMemo(
    () => getOrderDateForReferenceDate(activeDailyCandles, effectiveSelectedDate),
    [activeDailyCandles, effectiveSelectedDate],
  )
  const dateOptions = useMemo(
    () => [...sortDailyCandles(activeDailyCandles)].reverse(),
    [activeDailyCandles],
  )
  const derivedAveragePrice = useMemo(
    () => calculateAveragePriceFromCostBasis(form.shares, form.costBasis),
    [form.costBasis, form.shares],
  )
  const derivedCashBalance = useMemo(
    () => calculateCashBalanceFromBudget(form.initialBudget, form.totalBuyAmount),
    [form.initialBudget, form.totalBuyAmount],
  )
  const historyPageCount = Math.max(1, Math.ceil(history.length / HISTORY_PAGE_SIZE))
  const currentHistoryPage = Math.min(historyPage, historyPageCount)
  const historyPageStart = (currentHistoryPage - 1) * HISTORY_PAGE_SIZE
  const historyPageRows = history.slice(
    historyPageStart,
    historyPageStart + HISTORY_PAGE_SIZE,
  )

  const loadYfinanceJson = useCallback(async (symbol: StrategySymbol) => {
    setMarketDataLoading(true)
    setPriceMessage(`${symbol} yfinance 일봉 데이터를 불러오는 중입니다.`)

    try {
      const response = await fetch(`/market-data/${symbol}.json`, {
        cache: 'no-store',
      })

      if (!response.ok) {
        throw new Error(
          `public/market-data/${symbol}.json 파일이 없습니다. npm run fetch:market-data를 먼저 실행하세요.`,
        )
      }

      const payload = (await response.json()) as MarketDataFile
      const candles = normalizeMarketDataFileCandles(payload)

      if (candles.length === 0) {
        throw new Error(`${symbol}.json에 유효한 일봉 데이터가 없습니다.`)
      }

      setDailyCandles((current) => ({
        ...current,
        [symbol]: candles,
      }))
      setPriceMessage(formatMarketDataLoadMessage(symbol, payload, candles.length))
    } catch (error) {
      setDailyCandles((current) => ({
        ...current,
        [symbol]: [],
      }))
      setPriceMessage(error instanceof Error ? error.message : 'yfinance 데이터를 불러오지 못했습니다.')
    } finally {
      setMarketDataLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadYfinanceJson(form.symbol)
    }, 0)

    return () => window.clearTimeout(timer)
  }, [form.symbol, loadYfinanceJson])

  function updateField<Key extends keyof FormState>(
    key: Key,
    value: FormState[Key],
  ) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }))
  }

  function handleSymbolChange(symbol: StrategySymbol) {
    if (symbol === form.symbol) {
      return
    }

    const currentSymbolForms = {
      ...symbolForms,
      [form.symbol]: form,
    }
    const nextForm = currentSymbolForms[symbol] ?? createDefaultFormForSymbol(symbol)
    const normalizedNextForm = normalizeFormState({
      ...nextForm,
      symbol,
    })
    const nextSymbolForms = {
      ...currentSymbolForms,
      [symbol]: normalizedNextForm,
    }

    setForm(normalizedNextForm)
    setSymbolForms(nextSymbolForms)
    setSelectedDate(
      inferSelectedDateFromForm(
        normalizedNextForm,
        dailyCandles[normalizedNextForm.symbol] ?? [],
      ),
    )
    saveFormState(normalizedNextForm)
    saveSymbolFormStates(nextSymbolForms)
    setPriceMessage(
      `${symbol} 전용 상태를 불러왔습니다. T, 잔금, 보유수량, 평단은 종목별로 분리됩니다.`,
    )
  }

  function updateRecentClose(index: number, value: string) {
    setForm((current) => {
      const recentCloses = [...current.recentCloses]
      recentCloses[index] = value

      return {
        ...current,
        recentCloses,
      }
    })
  }

  function handleCalculate() {
    const nextResult = calculateFromForm(form)
    const snapshot: OrderSnapshot = {
      id: createSnapshotId(),
      createdAt: new Date().toISOString(),
      referenceDate: getFormReferenceDate(form, selectedDailyCandle),
      input: form,
      profitLoss: calculateSnapshotProfitLoss({
        input: form,
        result: nextResult,
        valuationCandle: selectedDailyCandle,
      }),
      result: nextResult,
    }
    const nextHistory = [snapshot, ...history].slice(0, 50)

    setResultModal({
      eyebrow: '오늘 주문 계산 결과',
      result: nextResult,
      title: '생성 주문',
    })
    setHistory(nextHistory)
    setHistoryPage(1)
    persistFormState(form)
    saveHistory(nextHistory)
  }

  function handleRestore(snapshot: OrderSnapshot) {
    const nextInput = snapshot.input

    setForm(nextInput)
    setSelectedDate(snapshot.referenceDate ?? '')
    persistFormState(nextInput)
    setPriceMessage(`${snapshot.input.symbol} 저장 기록의 입력값을 불러왔습니다.`)
    setNoticeModal({
      details: [
        `기록 시각 ${formatDateTime(snapshot.createdAt)}`,
        `종목 ${snapshot.input.symbol} · T ${snapshot.input.turn} · ${snapshot.input.splitCount}분할`,
        `전일 종가 ${formatOptionalCurrency(parseOptionalNumber(snapshot.input.previousClose))}`,
      ],
      message:
        '저장된 기록의 입력값을 계산기 폼에 다시 넣었습니다. 체결 추정이나 다음 상태 변경은 하지 않았습니다.',
      title: '입력값을 불러왔습니다',
    })
  }

  function handleApplyNextTurn(
    snapshot: OrderSnapshot,
    preview: NextTurnPreview,
  ) {
    if (!preview.calculation || !preview.executionCandle) {
      return
    }

    const sortedCandles = sortDailyCandles(dailyCandles[snapshot.input.symbol] ?? [])
    const nextInput = applyCandleToForm(
      {
        ...snapshot.input,
        cashInputMode: 'cashBalance',
        cashBalance: stringifyRoundedInput(preview.calculation.nextCashBalance),
        mode: preview.calculation.nextMode,
        shares: String(preview.calculation.nextShares),
        turn: stringifyRoundedInput(preview.calculation.nextTurn),
        averageInputMode: 'averagePrice',
        averagePrice: stringifyRoundedInput(preview.calculation.nextAveragePrice),
        costBasis: stringifyRoundedInput(
          preview.calculation.nextShares *
            preview.calculation.nextAveragePrice,
        ),
        reverseDays: String(
          calculateNextReverseDays(snapshot.input, preview.calculation),
        ),
      },
      sortedCandles,
      preview.executionCandle,
    )

    setForm(nextInput)
    setSelectedDate(preview.executionCandle.date)
    persistFormState(nextInput)
    setPriceMessage(
      `${snapshot.input.symbol} ${preview.executionCandle.date} 종가 기준 T ${formatNumber(
        preview.calculation.previousTurn,
      )} → ${formatNumber(preview.calculation.nextTurn)}, 보유 ${formatNumber(
        preview.calculation.previousShares,
      )}주 → ${formatNumber(preview.calculation.nextShares)}주 적용. 예외 체결은 입력값을 수정한 뒤 다시 계산하세요.`,
    )
    setNoticeModal({
      details: [
        `${preview.executionCandle.date} 종가 ${formatCurrency(preview.executionCandle.close)} 기준`,
        `T ${formatNumber(preview.calculation.previousTurn)} → ${formatNumber(preview.calculation.nextTurn)}`,
        `보유 ${formatNumber(preview.calculation.previousShares)}주 → ${formatNumber(preview.calculation.nextShares)}주`,
        `잔금 ${formatCurrency(preview.calculation.nextCashBalance)} · 평단 ${formatCurrency(preview.calculation.nextAveragePrice)}`,
      ],
      message:
        '다음 거래일 가격으로 주문 체결을 추정해 계산기 입력 상태에 반영했습니다. 실제 체결과 다르면 입력값을 직접 조정하세요.',
      title: '체결 추정이 반영되었습니다',
    })
  }

  function handleShowHistoryOrders(snapshot: OrderSnapshot) {
    setResultModal({
      eyebrow: `${snapshot.input.symbol} 저장 기록`,
      result: snapshot.result,
      title: '주문 상세 계획',
    })
  }

  function handleReset() {
    const nextForm = createDefaultFormForSymbol(form.symbol)

    setForm(nextForm)
    setSelectedDate('')
    setResultModal(null)
    setNoticeModal(null)
    persistFormState(nextForm)
  }

  function handleClearHistory() {
    setHistory([])
    setHistoryPage(1)
    saveHistory([])
  }

  function handleDeleteHistoryItem(snapshotId: string) {
    const nextHistory = history.filter((snapshot) => snapshot.id !== snapshotId)

    setHistory(nextHistory)
    setHistoryPage((currentPage) =>
      Math.min(
        currentPage,
        Math.max(1, Math.ceil(nextHistory.length / HISTORY_PAGE_SIZE)),
      ),
    )
    saveHistory(nextHistory)
  }

  function handleSelectDate(date: string) {
    const sortedCandles = sortDailyCandles(activeDailyCandles)
    const selectedCandle = sortedCandles.find((candle) => candle.date === date)

    if (!selectedCandle) {
      setPriceMessage('계산기에 적용할 선택 일자가 없습니다.')
      return
    }

    const nextForm = applyCandleToForm(form, sortedCandles, selectedCandle)

    setSelectedDate(selectedCandle.date)
    setForm(nextForm)
    persistFormState(nextForm)
    setPriceMessage(
      `${selectedCandle.date} 종가 ${formatCurrency(
        selectedCandle.close,
      )}를 전일 종가로 적용했습니다. 주문일은 ${
        getOrderDateForReferenceDate(sortedCandles, selectedCandle.date) ??
        '다음 거래일'
      }입니다.`,
    )
  }

  function persistFormState(nextForm: FormState) {
    const nextSymbolForms = {
      ...symbolForms,
      [nextForm.symbol]: nextForm,
    }

    setSymbolForms(nextSymbolForms)
    saveFormState(nextForm)
    saveSymbolFormStates(nextSymbolForms)
  }

  function handleRefreshYfinanceJson() {
    void refreshYfinanceData()
  }

  async function refreshYfinanceData() {
    setMarketDataLoading(true)
    setPriceMessage('yfinance 최신 일봉 JSON을 생성하는 중입니다.')

    try {
      const response = await fetch('/api/fetch-market-data', {
        method: 'POST',
      })

      if (!response.ok) {
        const payload = await safeReadJson(response)
        const detail = formatFetchMarketDataError(payload)

        throw new Error(
          detail || '개발 서버에서 yfinance fetch를 실행하지 못했습니다.',
        )
      }

      await loadYfinanceJson(form.symbol)
    } catch (error) {
      await loadYfinanceJson(form.symbol)
      setPriceMessage(
        error instanceof Error
          ? `${error.message} 정적 JSON만 다시 읽었습니다.`
          : 'yfinance 최신 데이터를 만들지 못해 정적 JSON만 다시 읽었습니다.',
      )
    } finally {
      setMarketDataLoading(false)
    }
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <span className="eyebrow">v1 오늘 주문 계산</span>
          <h1>라오어 무한매수 주문 계산기</h1>
        </div>
        <div className="strategy-badges" aria-label="지원 전략">
          <span>기본 ETF TQQQ</span>
          <span>TQQQ 15% · SOXL 20%</span>
          <span>20 / 30 / 40분할</span>
        </div>
      </header>

      <div className="workspace">
        <section className="panel input-panel unified-input-panel" aria-labelledby="input-title">
          <div className="panel-heading">
            <h2 id="input-title">상태 및 데이터 입력</h2>
            <div className="history-actions">
              <span className="panel-stat">목표 {selectedConfig.gainPercent}%</span>
              <span className="panel-stat">
                전일 {selectedDailyCandle?.date ?? '-'}
              </span>
              <span className="panel-stat">
                주문일 {selectedOrderDate ?? '-'}
              </span>
            </div>
          </div>

          <div className="input-stack">
            <section
              className="input-block strategy-input-block"
              aria-labelledby="strategy-input-title"
            >
              <div className="input-block-heading">
                <strong id="strategy-input-title">전략 설정</strong>
                <span>종목, 분할 수, 목표수익률, 모드와 T를 지정합니다.</span>
              </div>

              <div className="strategy-fields">
                <label className="field">
                  <span>종목</span>
                  <select
                    value={form.symbol}
                    onChange={(event) =>
                      handleSymbolChange(event.target.value as StrategySymbol)
                    }
                  >
                    {symbolOptions.map((symbol) => (
                      <option key={symbol} value={symbol}>
                        {symbol}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>분할 수</span>
                  <select
                    value={form.splitCount}
                    onChange={(event) =>
                      updateField('splitCount', Number(event.target.value) as SplitCount)
                    }
                  >
                    {SUPPORTED_SPLITS.map((splitCount) => (
                      <option key={splitCount} value={splitCount}>
                        {splitCount}
                      </option>
                    ))}
                  </select>
                </label>

                <NumberField
                  id="gain-percent"
                  label="목표수익률"
                  value={form.gainPercent}
                  min="0"
                  step="0.1"
                  suffix="%"
                  onChange={(value) => updateField('gainPercent', value)}
                />

                <div className="field mode-field">
                  <span>모드</span>
                  <div className="segmented" role="group" aria-label="모드">
                    <button
                      type="button"
                      className={form.mode === 'normal' ? 'active' : ''}
                      onClick={() => updateField('mode', 'normal')}
                    >
                      일반
                    </button>
                    <button
                      type="button"
                      className={form.mode === 'reverse' ? 'active' : ''}
                      onClick={() => updateField('mode', 'reverse')}
                    >
                      리버스
                    </button>
                  </div>
                </div>

                <NumberField
                  id="turn"
                  label="T"
                  value={form.turn}
                  min="0"
                  step="0.1"
                  onChange={(value) => updateField('turn', value)}
                />
              </div>
            </section>

            <section
              className="input-block account-input-block"
              aria-labelledby="account-input-title"
            >
              <div className="input-block-heading">
                <strong id="account-input-title">잔금 및 보유</strong>
                <span>주문 계산에 쓰는 잔금, 보유수량, 평단 기준을 정리합니다.</span>
              </div>

              <div className="account-fields">
                <CashBalanceInputField
                  cashBalance={form.cashBalance}
                  derivedCashBalance={derivedCashBalance}
                  initialBudget={form.initialBudget}
                  mode={form.cashInputMode}
                  onCashBalanceChange={(value) => updateField('cashBalance', value)}
                  onInitialBudgetChange={(value) => updateField('initialBudget', value)}
                  onModeChange={(value) => updateField('cashInputMode', value)}
                  onTotalBuyAmountChange={(value) => updateField('totalBuyAmount', value)}
                  totalBuyAmount={form.totalBuyAmount}
                />
                <NumberField
                  id="shares"
                  label="보유수량"
                  value={form.shares}
                  min="0"
                  step="1"
                  suffix="주"
                  onChange={(value) => updateField('shares', value)}
                />
                <AverageInputField
                  averagePrice={form.averagePrice}
                  costBasis={form.costBasis}
                  derivedAveragePrice={derivedAveragePrice}
                  mode={form.averageInputMode}
                  onAveragePriceChange={(value) => updateField('averagePrice', value)}
                  onCostBasisChange={(value) => updateField('costBasis', value)}
                  onModeChange={(value) => updateField('averageInputMode', value)}
                />
              </div>
            </section>

            <section
              className="input-block price-input-block"
              aria-labelledby="price-input-title"
            >
              <div className="input-block-heading">
                <strong id="price-input-title">가격 기준</strong>
                <span>전일 종가와 실제 주문일을 맞춥니다.</span>
              </div>

              <div className="price-fields">
                <NumberField
                  id="previous-close"
                  label="전일 종가"
                  value={form.previousClose}
                  min="0"
                  step="0.01"
                  suffix="$"
                  onChange={(value) => updateField('previousClose', value)}
                />
                <NumberField
                  id="reverse-days"
                  label="리버스 일수"
                  value={form.reverseDays}
                  min="0"
                  step="1"
                  onChange={(value) => updateField('reverseDays', value)}
                />

                <div className="market-control-band" aria-label="전일 기준일 입력">
                  <label className="field date-field">
                    <span>전일 기준일</span>
                    <select
                      value={selectedDailyCandle?.date ?? ''}
                      disabled={dateOptions.length === 0}
                      onChange={(event) => handleSelectDate(event.target.value)}
                    >
                      {dateOptions.length === 0 ? (
                        <option value="">yfinance 데이터 없음</option>
                      ) : null}
                      {dateOptions.map((candle) => (
                        <option key={candle.date} value={candle.date}>
                          {candle.date} · 종가 {formatCurrency(candle.close)} · 주문일{' '}
                          {getOrderDateForReferenceDate(activeDailyCandles, candle.date) ??
                            '다음 거래일'}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="selected-candle-card" aria-label="선택 전일 기준과 주문일">
                    <span>전일 기준</span>
                    <strong>
                      {selectedDailyCandle
                        ? `${selectedDailyCandle.date} · 종가 ${formatCurrency(selectedDailyCandle.close)}`
                        : '-'}
                    </strong>
                    <div>
                    <span>주문일 {selectedOrderDate ?? '-'}</span>
                      <span>시가 {formatOptionalCurrency(selectedDailyCandle?.open)}</span>
                      <span>고가 {formatOptionalCurrency(selectedDailyCandle?.high)}</span>
                      <span>저가 {formatOptionalCurrency(selectedDailyCandle?.low)}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="close-grid-panel">
                <div className="close-grid-toggle">
                  <div>
                    <strong>직전 5거래일 종가</strong>
                    <span>리버스 둘째 날 이후 계산에 사용됩니다.</span>
                  </div>
                  <button
                    type="button"
                    className="text-action"
                    onClick={() => setShowRecentCloses((value) => !value)}
                  >
                    {showRecentCloses ? '접기' : '더보기'}
                  </button>
                </div>

                {showRecentCloses ? (
                  <div className="close-grid" aria-label="직전 5거래일 종가">
                    {form.recentCloses.map((close, index) => (
                      <NumberField
                        key={`recent-close-${index}`}
                        id={`recent-close-${index}`}
                        label={`${index + 1}일`}
                        value={close}
                        min="0"
                        step="0.01"
                        suffix="$"
                        onChange={(value) => updateRecentClose(index, value)}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            </section>
          </div>

          <div className="actions">
            <button type="button" className="primary-action" onClick={handleCalculate}>
              계산
            </button>
            <button type="button" className="secondary-action" onClick={handleReset}>
              초기화
            </button>
          </div>
        </section>
      </div>

      {resultModal ? (
        <ResultModal
          eyebrow={resultModal.eyebrow}
          onClose={() => setResultModal(null)}
          result={resultModal.result}
          title={resultModal.title}
        />
      ) : null}

      {noticeModal ? (
        <NoticeModal
          details={noticeModal.details}
          message={noticeModal.message}
          onClose={() => setNoticeModal(null)}
          title={noticeModal.title}
        />
      ) : null}

      <section className="panel price-panel" aria-labelledby="price-title">
        <div className="panel-heading">
          <h2 id="price-title">가격 데이터</h2>
          <div className="history-actions">
            <span className="panel-stat">{form.symbol}</span>
            <span className="panel-stat">원천 {activeDailyCandles.length}일</span>
            <span className="panel-stat">{priceIntervalLabel[priceInterval]} {visibleCandles.length}개</span>
          </div>
        </div>

        <div className="price-workspace">
          <div className="chart-toolbar" aria-label="차트 제어">
            <div className="field interval-field">
              <span>차트 주기</span>
              <div className="interval-control" role="group" aria-label="차트 주기">
                {PRICE_INTERVALS.map((interval) => (
                  <button
                    key={interval}
                    type="button"
                    className={priceInterval === interval ? 'active' : ''}
                    onClick={() => setPriceInterval(interval)}
                  >
                    {priceIntervalLabel[interval]}
                  </button>
                ))}
              </div>
            </div>

            <div className="chart-selected-summary" aria-label="선택된 전일 기준일">
              <span>전일 기준일</span>
              <strong>
                {selectedDailyCandle
                  ? `${selectedDailyCandle.date} · 주문일 ${selectedOrderDate ?? '-'}`
                  : '-'}
              </strong>
            </div>

            <div className="chart-data-actions">
              <button
                type="button"
                className="secondary-action"
                disabled={marketDataLoading}
                onClick={handleRefreshYfinanceJson}
              >
                yfinance 다시 불러오기
              </button>
              {priceMessage ? <span className="price-message">{priceMessage}</span> : null}
            </div>
          </div>

          <CandlestickChart
            candles={visibleCandles}
            intervalLabel={priceIntervalLabel[priceInterval]}
            onSelectDate={handleSelectDate}
            selectedDate={effectiveSelectedDate}
            symbol={form.symbol}
          />
        </div>

        <DailyPriceTable
          candles={visibleCandles}
          intervalLabel={priceIntervalLabel[priceInterval]}
          key={`${form.symbol}-${priceInterval}`}
          onSelectDate={handleSelectDate}
          selectedDate={effectiveSelectedDate}
        />
      </section>

      <section className="panel history-panel" aria-labelledby="history-title">
        <div className="panel-heading">
          <h2 id="history-title">저장된 주문 기록</h2>
          <div className="history-actions">
            <span className="panel-stat">
              최근 {history.length}개 · {currentHistoryPage} / {historyPageCount}
            </span>
            <button type="button" className="text-action" onClick={handleClearHistory}>
              비우기
            </button>
          </div>
        </div>

        {history.length === 0 ? (
          <div className="empty-state">저장된 기록 없음</div>
        ) : (
          <>
            <HistoryPagination
              currentPage={currentHistoryPage}
              pageCount={historyPageCount}
              pageEnd={Math.min(historyPageStart + HISTORY_PAGE_SIZE, history.length)}
              pageStart={historyPageStart + 1}
              totalCount={history.length}
              onPageChange={setHistoryPage}
            />
            <div className="history-list">
              {historyPageRows.map((snapshot) => (
                <HistoryItem
                  key={snapshot.id}
                  candles={dailyCandles[snapshot.input.symbol] ?? []}
                  onApplyNextTurn={handleApplyNextTurn}
                  onDelete={handleDeleteHistoryItem}
                  onRestore={handleRestore}
                  onShowOrders={handleShowHistoryOrders}
                  snapshot={snapshot}
                />
              ))}
            </div>
          </>
        )}
      </section>
    </main>
  )
}

function HistoryPagination({
  currentPage,
  onPageChange,
  pageCount,
  pageEnd,
  pageStart,
  totalCount,
}: {
  currentPage: number
  onPageChange: (page: number) => void
  pageCount: number
  pageEnd: number
  pageStart: number
  totalCount: number
}) {
  return (
    <div className="history-pagination" aria-label="저장된 주문 기록 페이지">
      <span>
        {pageStart}-{pageEnd} / {totalCount}
      </span>
      <div className="pagination-controls">
        <button
          type="button"
          className="text-action"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
        >
          이전
        </button>
        <span>
          {currentPage} / {pageCount}
        </span>
        <button
          type="button"
          className="text-action"
          disabled={currentPage >= pageCount}
          onClick={() => onPageChange(Math.min(pageCount, currentPage + 1))}
        >
          다음
        </button>
      </div>
    </div>
  )
}

function HistoryItem({
  candles,
  onApplyNextTurn,
  onDelete,
  onRestore,
  onShowOrders,
  snapshot,
}: {
  candles: DailyCandle[]
  onApplyNextTurn: (snapshot: OrderSnapshot, preview: NextTurnPreview) => void
  onDelete: (snapshotId: string) => void
  onRestore: (snapshot: OrderSnapshot) => void
  onShowOrders: (snapshot: OrderSnapshot) => void
  snapshot: OrderSnapshot
}) {
  const preview = getNextTurnPreview(snapshot, candles)
  const profitLoss = getHistoryProfitLoss(snapshot, candles, preview)

  return (
    <article className="history-item">
      <div>
        <strong>
          {snapshot.input.symbol} · {modeLabel(snapshot.result.summary.effectiveMode)}
        </strong>
        <span>{formatDateTime(snapshot.createdAt)}</span>
      </div>
      <div className="history-meta">
        <span>{snapshot.result.orders.length}건</span>
        <span>목표 {snapshot.input.gainPercent ?? DEFAULT_FORM.gainPercent}%</span>
        <span>T {snapshot.input.turn}</span>
        <span>{snapshot.input.splitCount}분할</span>
      </div>
      <HistoryProfitLoss profitLoss={profitLoss} />
      <HistoryNextTurnPreview
        onApply={() => onApplyNextTurn(snapshot, preview)}
        preview={preview}
        snapshot={snapshot}
      />
      <div className="history-item-actions">
        <button
          type="button"
          className="secondary-action compact restore-action"
          onClick={() => onRestore(snapshot)}
        >
          입력값 불러오기
        </button>
        <button
          type="button"
          className="secondary-action compact detail-action"
          onClick={() => onShowOrders(snapshot)}
        >
          주문 상세
        </button>
        <button
          type="button"
          className="icon-action danger-action delete-action"
          aria-label={`${snapshot.input.symbol} ${formatDateTime(snapshot.createdAt)} 주문 기록 삭제`}
          title="삭제"
          onClick={() => onDelete(snapshot.id)}
        >
          <svg
            aria-hidden="true"
            className="trash-icon"
            fill="none"
            height="18"
            viewBox="0 0 24 24"
            width="18"
          >
            <path
              d="M3 6h18"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
            <path
              d="M8 6V4h8v2"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
            <path
              d="M19 6l-1 14H6L5 6"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
            <path
              d="M10 11v5M14 11v5"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
          </svg>
        </button>
      </div>
    </article>
  )
}

function HistoryProfitLoss({
  profitLoss,
}: {
  profitLoss?: ProfitLossResult
}) {
  if (!profitLoss) {
    return (
      <div className="history-pnl-card muted">
        <span>누적손익</span>
        <strong>-</strong>
        <small>예산과 기준가를 확인하세요</small>
      </div>
    )
  }

  const tone =
    profitLoss.totalProfitLoss > 0
      ? 'positive'
      : profitLoss.totalProfitLoss < 0
        ? 'negative'
        : 'neutral'

  return (
    <div className={`history-pnl-card ${tone}`}>
      <span>누적손익</span>
      <strong>{formatSignedCurrency(profitLoss.totalProfitLoss)}</strong>
      <small>예산대비 {formatSignedPercent(profitLoss.budgetReturnPercent)}</small>
      {typeof profitLoss.buyAmountReturnPercent === 'number' ? (
        <small>매수금액대비 {formatSignedPercent(profitLoss.buyAmountReturnPercent)}</small>
      ) : null}
      <small>
        {profitLoss.markDate ?? '기준가'} · {formatNumber(TRADE_COST_RATE * 100)}%
        비용 {formatCurrency(profitLoss.totalFees)} · 체결추정{' '}
        {profitLoss.executedOrderCount}건
      </small>
    </div>
  )
}

function HistoryNextTurnPreview({
  onApply,
  preview,
  snapshot,
}: {
  onApply: () => void
  preview: NextTurnPreview
  snapshot: OrderSnapshot
}) {
  if (!preview.calculation || !preview.executionCandle) {
    return (
      <div className="history-next-turn muted">
        <span>다음 T</span>
        <strong>-</strong>
        <small>{preview.message}</small>
      </div>
    )
  }

  const executedLabels = preview.calculation.executedOrderTags.map(
    (tag) =>
      snapshot.result.orders.find((order) => order.tag === tag)?.label ?? tag,
  )
  const executionSummary =
    executedLabels.length > 0 ? executedLabels.join(', ') : '체결 없음'

  return (
    <div className="history-next-turn">
      <div>
        <span>
          {preview.referenceDate ?? '-'} → {preview.executionCandle.date}
        </span>
        <strong>
          T {formatNumber(preview.calculation.previousTurn)} →{' '}
          {formatNumber(preview.calculation.nextTurn)} · 보유{' '}
          {formatNumber(preview.calculation.previousShares)} →{' '}
          {formatNumber(preview.calculation.nextShares)}주
        </strong>
        <small>
          종가 {formatCurrency(preview.executionCandle.close)}
          {preview.calculation.usedHighForLimitSell
            ? ` · 지정가 고가 ${formatCurrency(preview.executionCandle.high)} 추정`
            : ''}
          {preview.isReferenceDateInferred ? ' · 기준일 추정' : ''}
        </small>
        <small>
          잔금 {formatCurrency(preview.calculation.nextCashBalance)} · 평단{' '}
          {formatCurrency(preview.calculation.nextAveragePrice)}
        </small>
        <small>{executionSummary}</small>
      </div>
      <button type="button" className="secondary-action compact" onClick={onApply}>
        체결 추정 반영
      </button>
    </div>
  )
}

function ResultModal({
  eyebrow,
  onClose,
  result,
  title,
}: {
  eyebrow: string
  onClose: () => void
  result: GenerateOrdersResult
  title: string
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  return (
    <div
      className="result-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <section
        aria-labelledby="result-modal-title"
        aria-modal="true"
        className="result-modal"
        role="dialog"
      >
        <div className="result-modal-head">
          <div>
            <span>{eyebrow}</span>
            <h2 id="result-modal-title">{title}</h2>
          </div>
          <div className="result-modal-actions">
            <span className="panel-stat">{result.orders.length}건</span>
            <button type="button" className="secondary-action compact" onClick={onClose}>
              닫기
            </button>
          </div>
        </div>

        <div className="result-modal-body">
          <Summary result={result} />
          <Warnings result={result} />
          <OrdersTable result={result} />
        </div>
      </section>
    </div>
  )
}

function NoticeModal({
  details,
  message,
  onClose,
  title,
}: {
  details?: string[]
  message: string
  onClose: () => void
  title: string
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  return (
    <div
      className="result-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <section
        aria-labelledby="notice-modal-title"
        aria-modal="true"
        className="result-modal notice-modal"
        role="dialog"
      >
        <div className="result-modal-head notice-modal-head">
          <div>
            <span>저장된 주문 기록</span>
            <h2 id="notice-modal-title">{title}</h2>
          </div>
          <button type="button" className="secondary-action compact" onClick={onClose}>
            닫기
          </button>
        </div>
        <div className="notice-modal-body">
          <p>{message}</p>
          {details && details.length > 0 ? (
            <div className="notice-detail-list">
              {details.map((detail) => (
                <span key={detail}>{detail}</span>
              ))}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}

function NumberField({
  id,
  label,
  value,
  onChange,
  min = '0',
  readOnly = false,
  step = '0.01',
  suffix,
}: NumberFieldProps) {
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <div className="input-with-suffix">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          readOnly={readOnly}
          step={step}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        {suffix ? <em>{suffix}</em> : null}
      </div>
    </label>
  )
}

function CashBalanceInputField({
  cashBalance,
  derivedCashBalance,
  initialBudget,
  mode,
  onCashBalanceChange,
  onInitialBudgetChange,
  onModeChange,
  onTotalBuyAmountChange,
  totalBuyAmount,
}: {
  cashBalance: string
  derivedCashBalance?: string
  initialBudget: string
  mode: CashInputMode
  onCashBalanceChange: (value: string) => void
  onInitialBudgetChange: (value: string) => void
  onModeChange: (value: CashInputMode) => void
  onTotalBuyAmountChange: (value: string) => void
  totalBuyAmount: string
}) {
  const isDirectMode = mode === 'cashBalance'
  const appliedCashBalance = isDirectMode ? cashBalance : derivedCashBalance
  const initialBudgetValue = parseOptionalNumber(initialBudget)
  const totalBuyAmountValue = parseOptionalNumber(totalBuyAmount)
  const rawRemainingCash =
    typeof initialBudgetValue === 'number'
      ? initialBudgetValue - (totalBuyAmountValue ?? 0)
      : undefined
  const helperText = isDirectMode
    ? '잔금은 주문 계산에, 예산은 손익률 기준에 사용합니다'
    : typeof rawRemainingCash === 'number' && rawRemainingCash < 0
      ? `총매수금액이 예산을 ${formatCurrency(Math.abs(rawRemainingCash))} 초과했습니다`
      : '최초예산에서 총매수금액을 차감합니다'

  return (
    <div className="switch-card-field cash-switch-field">
      <div className="switch-card-head">
        <span>잔금 기준</span>
        <div className="switch-mode-control" role="group" aria-label="잔금 입력 방식">
          <button
            type="button"
            aria-pressed={isDirectMode}
            className={isDirectMode ? 'active' : ''}
            onClick={() => onModeChange('cashBalance')}
          >
            잔금
          </button>
          <button
            type="button"
            aria-pressed={!isDirectMode}
            className={!isDirectMode ? 'active' : ''}
            onClick={() => onModeChange('budgetSpent')}
          >
            예산
          </button>
        </div>
      </div>

      {isDirectMode ? (
        <div className="formula-input-grid direct-cash-grid">
          <label className="switch-input-shell" htmlFor="cash-balance">
            <span>잔금</span>
            <input
              id="cash-balance"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="예: 32000"
              value={cashBalance}
              onChange={(event) => onCashBalanceChange(event.target.value)}
            />
            <em>$</em>
          </label>
          <label className="switch-input-shell" htmlFor="direct-initial-budget">
            <span>손익 기준 예산</span>
            <input
              id="direct-initial-budget"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="예: 40000"
              value={initialBudget}
              onChange={(event) => onInitialBudgetChange(event.target.value)}
            />
            <em>$</em>
          </label>
        </div>
      ) : (
        <div className="formula-input-grid">
          <label className="switch-input-shell" htmlFor="initial-budget">
            <span>최초예산</span>
            <input
              id="initial-budget"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="예: 40000"
              value={initialBudget}
              onChange={(event) => onInitialBudgetChange(event.target.value)}
            />
            <em>$</em>
          </label>
          <span className="formula-divider" aria-hidden="true">
            -
          </span>
          <label className="switch-input-shell" htmlFor="total-buy-amount">
            <span>총매수금액</span>
            <input
              id="total-buy-amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="예: 8000"
              value={totalBuyAmount}
              onChange={(event) => onTotalBuyAmountChange(event.target.value)}
            />
            <em>$</em>
          </label>
        </div>
      )}

      <div className="switch-card-foot">
        <span>{helperText}</span>
        <strong>적용 잔금 {formatOptionalCurrency(parseOptionalNumber(appliedCashBalance))}</strong>
      </div>
    </div>
  )
}

function AverageInputField({
  averagePrice,
  costBasis,
  derivedAveragePrice,
  mode,
  onAveragePriceChange,
  onCostBasisChange,
  onModeChange,
}: {
  averagePrice: string
  costBasis: string
  derivedAveragePrice?: string
  mode: AverageInputMode
  onAveragePriceChange: (value: string) => void
  onCostBasisChange: (value: string) => void
  onModeChange: (value: AverageInputMode) => void
}) {
  const isCostBasisMode = mode === 'costBasis'
  const value = isCostBasisMode ? costBasis : averagePrice
  const appliedAveragePrice = isCostBasisMode ? derivedAveragePrice : averagePrice
  const inputId = isCostBasisMode ? 'cost-basis' : 'average-price'
  const inputLabel = isCostBasisMode ? '총 매수원금' : '평단'
  const helperText = isCostBasisMode
    ? appliedAveragePrice
      ? `보유수량 기준 ${formatOptionalCurrency(parseOptionalNumber(appliedAveragePrice))}`
      : '보유수량을 입력하면 평단이 계산됩니다'
    : '입력한 평단을 그대로 적용합니다'

  return (
    <div className="switch-card-field average-switch-field">
      <div className="switch-card-head">
        <span>매입 기준</span>
        <div className="switch-mode-control" role="group" aria-label="평단 입력 방식">
          <button
            type="button"
            aria-pressed={isCostBasisMode}
            className={isCostBasisMode ? 'active' : ''}
            onClick={() => onModeChange('costBasis')}
          >
            원금
          </button>
          <button
            type="button"
            aria-pressed={!isCostBasisMode}
            className={!isCostBasisMode ? 'active' : ''}
            onClick={() => onModeChange('averagePrice')}
          >
            평단
          </button>
        </div>
      </div>
      <label className="switch-input-shell" htmlFor={inputId}>
        <span>{inputLabel}</span>
        <input
          id={inputId}
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          placeholder={isCostBasisMode ? '예: 12000' : '예: 83.5'}
          value={value}
          onChange={(event) =>
            isCostBasisMode
              ? onCostBasisChange(event.target.value)
              : onAveragePriceChange(event.target.value)
          }
        />
        <em>$</em>
      </label>
      <div className="switch-card-foot">
        <span>{helperText}</span>
        <strong>적용 평단 {formatOptionalCurrency(parseOptionalNumber(appliedAveragePrice))}</strong>
      </div>
    </div>
  )
}

function Summary({ result }: { result: GenerateOrdersResult }) {
  const { summary } = result
  const buyBudget =
    summary.effectiveMode === 'reverse'
      ? summary.reverseBuyBudget
      : summary.oneBuyAmount
  const buyBudgetLabel =
    summary.effectiveMode === 'reverse' ? '리버스 매수금' : '1회매수금'
  const referenceLabel =
    summary.effectiveMode === 'reverse' ? '5일 평균' : '전일 종가'

  return (
    <div className="summary-grid" aria-label="계산 요약">
      <SummaryItem label="모드" value={modeLabel(summary.effectiveMode)} />
      {summary.effectiveMode === 'normal' ? (
        <SummaryItem label="별%" value={`${formatNumber(summary.starPercent)}%`} />
      ) : null}
      <SummaryItem
        label={buyBudgetLabel}
        value={
          typeof buyBudget === 'number' ? formatCurrency(buyBudget) : '-'
        }
      />
      <SummaryItem label="목표가" value={formatOptionalCurrency(summary.targetPrice)} />
      <SummaryItem
        label="별 매도가"
        value={formatOptionalCurrency(summary.starSellPrice)}
      />
      <SummaryItem
        label="별 매수가"
        value={formatOptionalCurrency(summary.starBuyPrice)}
      />
      <SummaryItem label={referenceLabel} value={formatOptionalCurrency(summary.referenceClose)} />
      <SummaryItem label="원금 기준" value={formatCurrency(summary.capitalBase)} />
    </div>
  )
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function Warnings({ result }: { result: GenerateOrdersResult }) {
  if (result.warnings.length === 0) {
    return null
  }

  return (
    <div className="warning-list" role="status" aria-label="경고">
      {result.warnings.map((warning, index) => (
        <div key={`${warning.code}-${warning.tag ?? index}`}>{warning.message}</div>
      ))}
    </div>
  )
}

function OrdersTable({ result }: { result: GenerateOrdersResult }) {
  if (result.orders.length === 0) {
    return <div className="empty-state">생성 주문 없음</div>
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">구분</th>
            <th scope="col">주문</th>
            <th scope="col">유형</th>
            <th scope="col">수량</th>
            <th scope="col">주문 기준</th>
            <th scope="col">배정금</th>
            <th scope="col">예상 주문금액</th>
          </tr>
        </thead>
        <tbody>
          {result.orders.map((order) => (
            <tr key={order.id}>
              <td>
                <span className={`side-badge ${order.side}`}>
                  {order.side === 'buy' ? '매수' : '매도'}
                </span>
              </td>
              <td>
                <strong>{order.label}</strong>
                {order.note ? <small>{order.note}</small> : null}
              </td>
              <td>{order.type}</td>
              <td>{formatNumber(order.quantity)}주</td>
              <OrderPriceCell order={order} />
              <td>{order.side === 'buy' ? formatOptionalCurrency(order.amount) : '-'}</td>
              <td>{formatOptionalCurrency(calculateOrderNotional(order))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function OrderPriceCell({ order }: { order: GenerateOrdersResult['orders'][number] }) {
  const condition = getOrderCondition(order)

  return (
    <td>
      <div className={`order-condition ${condition.direction}`}>
        <span aria-hidden="true">{condition.marker}</span>
        <strong>{condition.label}</strong>
      </div>
    </td>
  )
}

function getOrderCondition(order: GenerateOrdersResult['orders'][number]) {
  if (order.type === 'MOC' || typeof order.price !== 'number') {
    return {
      direction: 'neutral',
      label: '장마감 시장가',
      marker: 'MOC',
    }
  }

  if (order.type === 'LOC' && order.side === 'buy') {
    return {
      direction: 'down',
      label: `종가 ≤ ${formatCurrency(order.price)}`,
      marker: '↓',
    }
  }

  if (order.type === 'LOC') {
    return {
      direction: 'up',
      label: `종가 ≥ ${formatCurrency(order.price)}`,
      marker: '↑',
    }
  }

  return {
    direction: 'neutral',
    label: `지정가 ${formatCurrency(order.price)}`,
    marker: 'LIMIT',
  }
}

function calculateOrderNotional(order: GenerateOrdersResult['orders'][number]) {
  if (typeof order.price !== 'number') {
    return undefined
  }

  return order.quantity * order.price
}

function DailyPriceTable({
  candles,
  intervalLabel,
  onSelectDate,
  selectedDate,
}: {
  candles: DailyCandle[]
  intervalLabel: string
  onSelectDate: (date: string) => void
  selectedDate: string
}) {
  const sortedCandles = sortDailyCandles(candles)
  const latestFirst = [...sortedCandles].reverse()
  const [page, setPage] = useState(1)
  const pageCount = Math.max(1, Math.ceil(latestFirst.length / PRICE_TABLE_PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageStart = (currentPage - 1) * PRICE_TABLE_PAGE_SIZE
  const pageRows = latestFirst.slice(pageStart, pageStart + PRICE_TABLE_PAGE_SIZE)

  if (latestFirst.length === 0) {
    return <div className="empty-state">yfinance {intervalLabel} 데이터 없음</div>
  }

  return (
    <section className="price-list" aria-label={`${intervalLabel} 가격 리스트`}>
      <div className="price-list-heading">
        <div>
          <strong>{intervalLabel} 가격 리스트</strong>
          <span>
            {pageStart + 1}-{Math.min(pageStart + PRICE_TABLE_PAGE_SIZE, latestFirst.length)} /{' '}
            {latestFirst.length}
          </span>
        </div>
        <div className="pagination-controls" aria-label="가격 리스트 페이지">
          <button
            type="button"
            className="text-action"
            disabled={currentPage <= 1}
            onClick={() => setPage(Math.max(1, currentPage - 1))}
          >
            이전
          </button>
          <span>
            {currentPage} / {pageCount}
          </span>
          <button
            type="button"
            className="text-action"
            disabled={currentPage >= pageCount}
            onClick={() => setPage(Math.min(pageCount, currentPage + 1))}
          >
            다음
          </button>
        </div>
      </div>

      <div className="table-wrap price-table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">일자</th>
              <th scope="col">시가</th>
              <th scope="col">고가</th>
              <th scope="col">저가</th>
              <th scope="col">종가</th>
              <th scope="col">등락</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((candle) => {
              const previousClose = getPreviousClose(sortedCandles, candle.date)
              const change = previousClose
                ? ((candle.close - previousClose) / previousClose) * 100
                : undefined

              return (
                <tr
                  key={candle.date}
                  className={selectedDate === candle.date ? 'selected-row' : ''}
                  onClick={() => onSelectDate(candle.date)}
                >
                  <td>
                    <strong>{candle.date}</strong>
                    {selectedDate === candle.date ? <small>선택됨</small> : null}
                  </td>
                  <td>{formatCurrency(candle.open)}</td>
                  <td>{formatCurrency(candle.high)}</td>
                  <td>{formatCurrency(candle.low)}</td>
                  <td>
                    <strong>{formatCurrency(candle.close)}</strong>
                  </td>
                  <td>{formatChange(change)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function calculateFromForm(form: FormState): GenerateOrdersResult {
  return generateOrders(
    getStrategyConfig(
      form.symbol,
      form.splitCount,
      parseOptionalNumber(form.gainPercent),
    ),
    formToState(form),
  )
}

function getNextTurnPreview(
  snapshot: OrderSnapshot,
  candles: DailyCandle[],
): NextTurnPreview {
  const sortedCandles = sortDailyCandles(candles)

  if (sortedCandles.length === 0) {
    return {
      isReferenceDateInferred: false,
      message: `${snapshot.input.symbol} 가격 데이터가 없습니다.`,
    }
  }

  const reference = resolveSnapshotReferenceDate(snapshot, sortedCandles)

  if (!reference.date) {
    return {
      isReferenceDateInferred: false,
      message: '기준일을 찾을 수 없습니다.',
    }
  }

  const referenceIndex = sortedCandles.findIndex(
    (candle) => candle.date === reference.date,
  )
  const executionCandle =
    referenceIndex >= 0 ? sortedCandles[referenceIndex + 1] : undefined

  if (!executionCandle) {
    return {
      referenceDate: reference.date,
      isReferenceDateInferred: reference.isInferred,
      message: '다음 거래일 가격 데이터가 아직 없습니다.',
    }
  }

  const calculation = calculateNextTurnFromExecution(
    getStrategyConfig(
      snapshot.input.symbol,
      snapshot.input.splitCount,
      parseOptionalNumber(snapshot.input.gainPercent),
    ),
    formToState(snapshot.input),
    snapshot.result.orders,
    {
      close: executionCandle.close,
      high: executionCandle.high,
    },
  )

  if (!calculation) {
    return {
      referenceDate: reference.date,
      executionCandle,
      isReferenceDateInferred: reference.isInferred,
      message: '다음 거래일 종가가 유효하지 않습니다.',
    }
  }

  return {
    referenceDate: reference.date,
    executionCandle,
    calculation,
    isReferenceDateInferred: reference.isInferred,
    message: '',
  }
}

function getHistoryProfitLoss(
  snapshot: OrderSnapshot,
  candles: DailyCandle[],
  preview: NextTurnPreview,
): ProfitLossResult | undefined {
  const sortedCandles = sortDailyCandles(candles)
  const reference = resolveSnapshotReferenceDate(snapshot, sortedCandles)
  const valuationCandle = reference.date
    ? sortedCandles.find((candle) => candle.date === reference.date)
    : undefined
  const executionCandle =
    preview.calculation && preview.executionCandle
      ? preview.executionCandle
      : undefined

  return (
    calculateSnapshotProfitLoss({
      executionCandle,
      input: snapshot.input,
      result: snapshot.result,
      valuationCandle,
    }) ?? snapshot.profitLoss
  )
}

function calculateSnapshotProfitLoss({
  executionCandle,
  input,
  result,
  valuationCandle,
}: {
  executionCandle?: DailyCandle
  input: FormState
  result: GenerateOrdersResult
  valuationCandle?: DailyCandle
}): ProfitLossResult | undefined {
  const markPrice =
    executionCandle?.close ??
    valuationCandle?.close ??
    result.summary.referenceClose ??
    parseNumber(input.previousClose)
  const budget = getProfitLossBudget(input, result)

  return calculateProfitLoss({
    averagePrice: parseNumber(getEffectiveAveragePrice(input)),
    budget,
    buyAmount: getProfitLossBuyAmount(input),
    cashBalance: parseNumber(getEffectiveCashBalance(input)),
    executionPrice: executionCandle
      ? {
          close: executionCandle.close,
          date: executionCandle.date,
          high: executionCandle.high,
        }
      : undefined,
    markDate: valuationCandle?.date,
    markPrice,
    orders: result.orders,
    shares: parseNumber(input.shares),
  })
}

function getProfitLossBudget(
  input: FormState,
  result: GenerateOrdersResult,
): number {
  const initialBudget = parseOptionalNumber(input.initialBudget)

  if (typeof initialBudget === 'number' && initialBudget > 0) {
    return initialBudget
  }

  return result.summary.capitalBase
}

function getProfitLossBuyAmount(input: FormState): number {
  const totalBuyAmount = parseOptionalNumber(input.totalBuyAmount)

  if (typeof totalBuyAmount === 'number' && totalBuyAmount > 0) {
    return totalBuyAmount
  }

  const costBasis = parseOptionalNumber(input.costBasis)

  if (typeof costBasis === 'number' && costBasis > 0) {
    return costBasis
  }

  const shares = parseNumber(input.shares)
  const averagePrice = parseNumber(getEffectiveAveragePrice(input))

  if (shares > 0 && averagePrice > 0) {
    return shares * averagePrice
  }

  return 0
}

function resolveSnapshotReferenceDate(
  snapshot: OrderSnapshot,
  candles: DailyCandle[],
): { date?: string; isInferred: boolean } {
  const previousClose = parseNumber(snapshot.input.previousClose)

  if (snapshot.referenceDate) {
    const referencedCandle = candles.find(
      (candle) => candle.date === snapshot.referenceDate,
    )

    if (
      referencedCandle &&
      isSamePrice(referencedCandle.close, previousClose)
    ) {
      return {
        date: referencedCandle.date,
        isInferred: false,
      }
    }
  }

  const inferredCandle = [...candles]
    .reverse()
    .find((candle) => isSamePrice(candle.close, previousClose))

  return {
    date: inferredCandle?.date,
    isInferred: Boolean(inferredCandle),
  }
}

function getFormReferenceDate(
  form: FormState,
  selectedDailyCandle?: DailyCandle,
): string | undefined {
  if (
    selectedDailyCandle &&
    isSamePrice(parseNumber(form.previousClose), selectedDailyCandle.close)
  ) {
    return selectedDailyCandle.date
  }

  return undefined
}

function applyCandleToForm(
  form: FormState,
  sortedCandles: DailyCandle[],
  selectedCandle: DailyCandle,
): FormState {
  const recentCloses = getRecentClosesUntil(
    sortedCandles,
    selectedCandle.date,
    5,
  ).map(String)

  return {
    ...form,
    previousClose: String(selectedCandle.close),
    recentCloses: Array.from(
      { length: 5 },
      (_, index) => recentCloses[index] ?? '',
    ),
  }
}

function inferSelectedDateFromForm(
  form: FormState,
  candles: DailyCandle[],
): string {
  const previousClose = parseNumber(form.previousClose)

  return (
    [...sortDailyCandles(candles)]
      .reverse()
      .find((candle) => isSamePrice(candle.close, previousClose))?.date ?? ''
  )
}

function getEffectiveAveragePrice(form: FormState): string {
  if (form.averageInputMode === 'averagePrice') {
    return form.averagePrice
  }

  return calculateAveragePriceFromCostBasis(form.shares, form.costBasis) ?? '0'
}

function getEffectiveCashBalance(form: FormState): string {
  if (form.cashInputMode === 'cashBalance') {
    return form.cashBalance
  }

  return calculateCashBalanceFromBudget(
    form.initialBudget,
    form.totalBuyAmount,
  ) ?? '0'
}

function calculateCashBalanceFromBudget(
  initialBudgetInput: string,
  totalBuyAmountInput: string,
): string | undefined {
  const initialBudget = parseOptionalNumber(initialBudgetInput)

  if (typeof initialBudget !== 'number' || initialBudget <= 0) {
    return undefined
  }

  const totalBuyAmount = Math.max(0, parseNumber(totalBuyAmountInput))

  return stringifyRoundedInput(Math.max(0, initialBudget - totalBuyAmount))
}

function calculateAveragePriceFromCostBasis(
  sharesInput: string,
  costBasisInput: string,
): string | undefined {
  const shares = parseNumber(sharesInput)
  const costBasis = parseNumber(costBasisInput)

  if (shares <= 0 || costBasis <= 0) {
    return undefined
  }

  return stringifyRoundedInput(costBasis / shares)
}

function formToState(form: FormState): StrategyState {
  return {
    mode: form.mode,
    turn: parseNumber(form.turn),
    cashBalance: parseNumber(getEffectiveCashBalance(form)),
    shares: parseNumber(form.shares),
    averagePrice: parseNumber(getEffectiveAveragePrice(form)),
    previousClose: parseNumber(form.previousClose),
    reverseDays: parseNumber(form.reverseDays),
    recentCloses: form.recentCloses.map(parseNumber),
  }
}

function loadFormState(): FormState {
  const saved = readStorage(STORAGE_INPUT_KEY)
  return normalizeFormState(saved)
}

function saveFormState(form: FormState) {
  writeStorage(STORAGE_INPUT_KEY, form)
}

function loadSymbolFormStates(
  activeForm: FormState,
): Record<StrategySymbol, FormState> {
  const saved = readStorage(STORAGE_SYMBOL_INPUTS_KEY)
  const forms = Object.fromEntries(
    symbolOptions.map((symbol) => [symbol, createDefaultFormForSymbol(symbol)]),
  ) as Record<StrategySymbol, FormState>

  if (isRecord(saved)) {
    for (const symbol of symbolOptions) {
      if (isRecord(saved[symbol])) {
        forms[symbol] = normalizeFormState({
          ...saved[symbol],
          symbol,
        })
      }
    }
  }

  forms[activeForm.symbol] = normalizeFormState(activeForm)

  return forms
}

function saveSymbolFormStates(forms: Record<StrategySymbol, FormState>) {
  writeStorage(STORAGE_SYMBOL_INPUTS_KEY, forms)
}

function loadHistory(): OrderSnapshot[] {
  const saved = readStorage(STORAGE_HISTORY_KEY)

  if (!Array.isArray(saved)) {
    return []
  }

  return saved.flatMap(normalizeOrderSnapshot).slice(0, 50)
}

function saveHistory(history: OrderSnapshot[]) {
  writeStorage(STORAGE_HISTORY_KEY, history)
}

function normalizeFormState(value: unknown): FormState {
  const source = isRecord(value) ? value : {}
  const symbol = isStrategySymbol(source.symbol) ? source.symbol : DEFAULT_FORM.symbol
  const splitCount = isSplitCount(source.splitCount)
    ? source.splitCount
    : DEFAULT_FORM.splitCount
  const recentCloses = Array.isArray(source.recentCloses)
    ? source.recentCloses
    : DEFAULT_FORM.recentCloses

  return {
    symbol,
    splitCount,
    gainPercent: stringifyInput(
      source.gainPercent,
      String(getDefaultTargetProfitPercent(symbol)),
    ),
    mode: isMode(source.mode) ? source.mode : DEFAULT_FORM.mode,
    turn: stringifyInput(source.turn, DEFAULT_FORM.turn),
    cashInputMode: normalizeCashInputMode(source),
    cashBalance: stringifyInput(source.cashBalance, DEFAULT_FORM.cashBalance),
    initialBudget: stringifyInput(source.initialBudget, DEFAULT_FORM.initialBudget),
    totalBuyAmount: stringifyInput(source.totalBuyAmount, DEFAULT_FORM.totalBuyAmount),
    shares: stringifyInput(source.shares, DEFAULT_FORM.shares),
    averageInputMode: normalizeAverageInputMode(source),
    costBasis: stringifyInput(source.costBasis, DEFAULT_FORM.costBasis),
    averagePrice: stringifyInput(source.averagePrice, DEFAULT_FORM.averagePrice),
    previousClose: stringifyInput(source.previousClose, DEFAULT_FORM.previousClose),
    reverseDays: stringifyInput(source.reverseDays, DEFAULT_FORM.reverseDays),
    recentCloses: Array.from({ length: 5 }, (_, index) =>
      stringifyInput(recentCloses[index], DEFAULT_FORM.recentCloses[index] ?? ''),
    ),
  }
}

function normalizeOrderSnapshot(value: unknown): OrderSnapshot[] {
  if (!isRecord(value)) {
    return []
  }

  if (typeof value.id !== 'string' || typeof value.createdAt !== 'string') {
    return []
  }

  if (!isRecord(value.input)) {
    return []
  }

  const input = normalizeFormState(value.input)
  const result = calculateFromForm(input)
  const profitLoss =
    normalizeProfitLossResult(value.profitLoss) ??
    calculateSnapshotProfitLoss({
      input,
      result,
    })

  return [
    {
      id: value.id,
      createdAt: value.createdAt,
      referenceDate:
        typeof value.referenceDate === 'string' ? value.referenceDate : undefined,
      input,
      profitLoss,
      result,
    },
  ]
}

function normalizeProfitLossResult(value: unknown): ProfitLossResult | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const budget = parseUnknownNumber(value.budget)
  const budgetReturnPercent = parseUnknownNumber(value.budgetReturnPercent)
  const buyAmount = parseUnknownNumber(value.buyAmount)
  const buyAmountReturnPercent = parseOptionalUnknownNumber(
    value.buyAmountReturnPercent,
  )
  const cashBalanceAfterOrders = parseUnknownNumber(value.cashBalanceAfterOrders)
  const executedOrderCount = parseUnknownNumber(value.executedOrderCount)
  const markPrice = parseUnknownNumber(value.markPrice)
  const netEquity = parseUnknownNumber(value.netEquity)
  const positionExitFee = parseUnknownNumber(value.positionExitFee)
  const positionValue = parseUnknownNumber(value.positionValue)
  const remainingShares = parseUnknownNumber(value.remainingShares)
  const totalFees = parseUnknownNumber(value.totalFees)
  const totalProfitLoss = parseUnknownNumber(value.totalProfitLoss)

  if (budget <= 0 || markPrice <= 0) {
    return undefined
  }

  return {
    budget,
    budgetReturnPercent,
    buyAmount: Math.max(0, buyAmount),
    buyAmountReturnPercent:
      typeof buyAmountReturnPercent === 'number'
        ? buyAmountReturnPercent
        : buyAmount > 0
          ? (totalProfitLoss / buyAmount) * 100
          : undefined,
    cashBalanceAfterOrders,
    executedOrderCount: Math.max(0, Math.floor(executedOrderCount)),
    executedOrders: Array.isArray(value.executedOrders)
      ? value.executedOrders.flatMap(normalizeExecutedProfitLossOrder)
      : [],
    markDate: typeof value.markDate === 'string' ? value.markDate : undefined,
    markPrice,
    netEquity,
    positionExitFee,
    positionValue,
    remainingShares,
    totalFees,
    totalProfitLoss,
  }
}

function normalizeExecutedProfitLossOrder(
  value: unknown,
): ExecutedProfitLossOrder[] {
  if (!isRecord(value)) {
    return []
  }

  const side: ExecutedProfitLossOrder['side'] | undefined =
    value.side === 'buy' || value.side === 'sell' ? value.side : undefined
  const label = typeof value.label === 'string' ? value.label : ''

  if (!side || !label) {
    return []
  }

  return [
    {
      fee: parseUnknownNumber(value.fee),
      label,
      notional: parseUnknownNumber(value.notional),
      side,
    },
  ]
}

function normalizeMarketDataFileCandles(payload: MarketDataFile): DailyCandle[] {
  return normalizeMarketDataCandles(payload.candles)
}

function normalizeMarketDataCandles(value: unknown): DailyCandle[] {
  if (!Array.isArray(value)) {
    return []
  }

  return sortDailyCandles(
    value.flatMap((item) => {
      if (!isRecord(item)) {
        return []
      }

      const candle = normalizeDailyCandle({
        date: stringifyInput(item.date, ''),
        open: parseUnknownNumber(item.open),
        high: parseUnknownNumber(item.high),
        low: parseUnknownNumber(item.low),
        close: parseUnknownNumber(item.close),
      })

      return candle ? [candle] : []
    }),
  )
}

function formatMarketDataLoadMessage(
  symbol: StrategySymbol,
  payload: MarketDataFile,
  candleCount: number,
): string {
  const calendarLabel = payload.calendar ? ` · ${payload.calendar} 캘린더 검증` : ''
  const sourceLabel = payload.provider ?? 'yfinance'
  const missingTradingDays = Array.isArray(payload.missingTradingDays)
    ? payload.missingTradingDays.filter((date) => typeof date === 'string')
    : []

  if (missingTradingDays.length > 0) {
    return `${symbol} ${candleCount}개 일봉을 불러왔습니다. 정상 거래일 데이터 누락: ${missingTradingDays.join(', ')}`
  }

  return `${symbol} ${candleCount}개 일봉을 불러왔습니다. 출처: ${sourceLabel}${calendarLabel}`
}

function readStorage(key: string): unknown {
  try {
    const value = window.localStorage.getItem(key)
    return value ? JSON.parse(value) : undefined
  } catch {
    return undefined
  }
}

function writeStorage(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    return
  }
}

async function safeReadJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

function formatFetchMarketDataError(value: unknown): string {
  if (!isRecord(value)) {
    return ''
  }

  const stderr =
    typeof value.stderr === 'string' ? value.stderr.trim() : ''
  const stdout =
    typeof value.stdout === 'string' ? value.stdout.trim() : ''

  return stderr || stdout
}

function stringifyInput(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  return fallback
}

function parseNumber(value: string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseOptionalNumber(value?: string): number | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function stringifyRoundedInput(value: number): string {
  if (!Number.isFinite(value)) {
    return ''
  }

  return String(Math.round((value + Number.EPSILON) * 100) / 100)
}

function parseUnknownNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    return parseNumber(value)
  }

  return 0
}

function parseOptionalUnknownNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  return undefined
}

function isSamePrice(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.005
}

function getPreviousClose(candles: DailyCandle[], date: string): number | undefined {
  const index = candles.findIndex((candle) => candle.date === date)

  if (index <= 0) {
    return undefined
  }

  return candles[index - 1].close
}

function getNextTradingCandle(
  candles: DailyCandle[],
  date: string,
): DailyCandle | undefined {
  const sortedCandles = sortDailyCandles(candles)
  const index = sortedCandles.findIndex((candle) => candle.date === date)

  if (index < 0) {
    return undefined
  }

  return sortedCandles[index + 1]
}

function getOrderDateForReferenceDate(
  candles: DailyCandle[],
  date: string,
): string | undefined {
  const nextCandle = getNextTradingCandle(candles, date)

  return nextCandle?.date ?? inferNextWeekdayDate(date)
}

function inferNextWeekdayDate(date: string): string | undefined {
  const [year, month, day] = date.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))

  if (Number.isNaN(parsed.getTime())) {
    return undefined
  }

  do {
    parsed.setUTCDate(parsed.getUTCDate() + 1)
  } while (parsed.getUTCDay() === 0 || parsed.getUTCDay() === 6)

  return [
    parsed.getUTCFullYear(),
    String(parsed.getUTCMonth() + 1).padStart(2, '0'),
    String(parsed.getUTCDate()).padStart(2, '0'),
  ].join('-')
}

function calculateNextReverseDays(
  input: FormState,
  calculation: NextTurnCalculation,
): number {
  if (calculation.nextMode !== 'reverse') {
    return 0
  }

  if (calculation.effectiveMode === 'reverse') {
    return Math.max(0, Math.floor(parseNumber(input.reverseDays))) + 1
  }

  return 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isStrategySymbol(value: unknown): value is StrategySymbol {
  return value === 'TQQQ' || value === 'SOXL'
}

function isSplitCount(value: unknown): value is SplitCount {
  return SUPPORTED_SPLITS.includes(value as SplitCount)
}

function isMode(value: unknown): value is Mode {
  return value === 'normal' || value === 'reverse'
}

function isAverageInputMode(value: unknown): value is AverageInputMode {
  return value === 'costBasis' || value === 'averagePrice'
}

function isCashInputMode(value: unknown): value is CashInputMode {
  return value === 'cashBalance' || value === 'budgetSpent'
}

function normalizeCashInputMode(source: Record<string, unknown>): CashInputMode {
  if (isCashInputMode(source.cashInputMode)) {
    return source.cashInputMode
  }

  if (
    parseUnknownNumber(source.initialBudget) > 0 ||
    parseUnknownNumber(source.totalBuyAmount) > 0
  ) {
    return 'budgetSpent'
  }

  return 'cashBalance'
}

function normalizeAverageInputMode(source: Record<string, unknown>): AverageInputMode {
  if (isAverageInputMode(source.averageInputMode)) {
    return source.averageInputMode
  }

  if (parseUnknownNumber(source.costBasis) > 0) {
    return 'costBasis'
  }

  return 'averagePrice'
}

function createSnapshotId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }

  return `${Date.now()}`
}

function formatCurrency(value: number): string {
  return currencyFormatter.format(value)
}

function formatOptionalCurrency(value?: number): string {
  return typeof value === 'number' ? formatCurrency(value) : '-'
}

function formatSignedCurrency(value: number): string {
  if (value === 0) {
    return formatCurrency(0)
  }

  const sign = value > 0 ? '+' : '-'
  return `${sign}${formatCurrency(Math.abs(value))}`
}

function formatNumber(value: number): string {
  return numberFormatter.format(value)
}

function formatSignedPercent(value: number): string {
  if (value === 0) {
    return '0%'
  }

  const sign = value > 0 ? '+' : '-'
  return `${sign}${formatNumber(Math.abs(value))}%`
}

function formatChange(value?: number): string {
  if (typeof value !== 'number') {
    return '-'
  }

  const sign = value > 0 ? '+' : ''
  return `${sign}${formatNumber(value)}%`
}

function formatDateTime(value: string): string {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

function modeLabel(mode: Mode): string {
  return mode === 'normal' ? '일반' : '리버스'
}

export default App
