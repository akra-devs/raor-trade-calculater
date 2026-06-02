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
  SUPPORTED_SPLITS,
  generateOrders,
  getStrategyConfig,
  type GenerateOrdersResult,
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
  input: FormState
  result: GenerateOrdersResult
}

interface MarketDataFile {
  provider?: string
  symbol?: string
  fetchedAt?: string
  candles?: unknown
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
const STORAGE_HISTORY_KEY = 'raor:v1:order-snapshots'
const PRICE_TABLE_PAGE_SIZE = 5

const priceIntervalLabel: Record<PriceInterval, string> = {
  day: '일봉',
  week: '주봉',
  month: '월봉',
  year: '년봉',
}

const DEFAULT_FORM: FormState = {
  symbol: 'TQQQ',
  splitCount: 20,
  gainPercent: '15',
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
  const [result, setResult] = useState<GenerateOrdersResult>(() =>
    calculateFromForm(loadFormState()),
  )
  const [isResultModalOpen, setIsResultModalOpen] = useState(false)
  const [history, setHistory] = useState<OrderSnapshot[]>(() => loadHistory())
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
        parseNumber(form.gainPercent),
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

    return activeDailyCandles.at(-1)?.date ?? ''
  }, [activeDailyCandles, selectedDate])
  const selectedDailyCandle = useMemo(
    () => activeDailyCandles.find((candle) => candle.date === effectiveSelectedDate),
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
      setPriceMessage(
        `${symbol} ${candles.length}개 일봉을 불러왔습니다. 출처: ${payload.provider ?? 'yfinance'}`,
      )
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
      input: form,
      result: nextResult,
    }
    const nextHistory = [snapshot, ...history].slice(0, 50)

    setResult(nextResult)
    setIsResultModalOpen(true)
    setHistory(nextHistory)
    saveFormState(form)
    saveHistory(nextHistory)
  }

  function handleRestore(snapshot: OrderSnapshot) {
    setForm(snapshot.input)
    setResult(snapshot.result)
    saveFormState(snapshot.input)
  }

  function handleReset() {
    setForm(DEFAULT_FORM)
    setResult(calculateFromForm(DEFAULT_FORM))
    setIsResultModalOpen(false)
  }

  function handleClearHistory() {
    setHistory([])
    saveHistory([])
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
    setResult(calculateFromForm(nextForm))
    saveFormState(nextForm)
    setPriceMessage(
      `${selectedCandle.date} 종가 ${formatCurrency(selectedCandle.close)}를 적용했습니다.`,
    )
  }

  function handleRefreshYfinanceJson() {
    void loadYfinanceJson(form.symbol)
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
          <span>기본 G 15%</span>
          <span>20 / 30 / 40분할</span>
        </div>
      </header>

      <div className="workspace">
        <section className="panel input-panel unified-input-panel" aria-labelledby="input-title">
          <div className="panel-heading">
            <h2 id="input-title">상태 및 데이터 입력</h2>
            <div className="history-actions">
              <span className="panel-stat">G {selectedConfig.gainPercent}%</span>
              <span className="panel-stat">
                기준일 {selectedDailyCandle?.date ?? '-'}
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
                <span>종목, 분할 수, G값, 모드와 T를 지정합니다.</span>
              </div>

              <div className="strategy-fields">
                <label className="field">
                  <span>종목</span>
                  <select
                    value={form.symbol}
                    onChange={(event) =>
                      updateField('symbol', event.target.value as StrategySymbol)
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
                  label="G값"
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
                <span>전일 종가와 매수 기준일을 맞춥니다.</span>
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

                <div className="market-control-band" aria-label="매수 기준일 입력">
                  <label className="field date-field">
                    <span>매수 기준일</span>
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
                          {candle.date} · 종가 {formatCurrency(candle.close)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="selected-candle-card" aria-label="선택 일자 가격">
                    <span>선택 일자</span>
                    <strong>
                      {selectedDailyCandle
                        ? `${selectedDailyCandle.date} · ${formatCurrency(selectedDailyCandle.close)}`
                        : '-'}
                    </strong>
                    <div>
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

      {isResultModalOpen ? (
        <ResultModal
          onClose={() => setIsResultModalOpen(false)}
          result={result}
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

            <div className="chart-selected-summary" aria-label="선택된 매수 기준일">
              <span>매수 기준일</span>
              <strong>
                {selectedDailyCandle
                  ? `${selectedDailyCandle.date} · ${formatCurrency(selectedDailyCandle.close)}`
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
            <span className="panel-stat">최근 {history.length}개</span>
            <button type="button" className="text-action" onClick={handleClearHistory}>
              비우기
            </button>
          </div>
        </div>

        {history.length === 0 ? (
          <div className="empty-state">저장된 기록 없음</div>
        ) : (
          <div className="history-list">
            {history.map((snapshot) => (
              <article className="history-item" key={snapshot.id}>
                <div>
                  <strong>
                    {snapshot.input.symbol} · {modeLabel(snapshot.result.summary.effectiveMode)}
                  </strong>
                  <span>{formatDateTime(snapshot.createdAt)}</span>
                </div>
                <div className="history-meta">
                  <span>{snapshot.result.orders.length}건</span>
                  <span>G {snapshot.input.gainPercent ?? DEFAULT_FORM.gainPercent}%</span>
                  <span>T {snapshot.input.turn}</span>
                  <span>{snapshot.input.splitCount}분할</span>
                </div>
                <button
                  type="button"
                  className="secondary-action compact"
                  onClick={() => handleRestore(snapshot)}
                >
                  불러오기
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}

function ResultModal({
  onClose,
  result,
}: {
  onClose: () => void
  result: GenerateOrdersResult
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
            <span>오늘 주문 계산 결과</span>
            <h2 id="result-modal-title">생성 주문</h2>
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
    ? '입력한 잔금을 그대로 적용합니다'
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

  return (
    <div className="summary-grid" aria-label="계산 요약">
      <SummaryItem label="모드" value={modeLabel(summary.effectiveMode)} />
      <SummaryItem label="별%" value={`${formatNumber(summary.starPercent)}%`} />
      <SummaryItem label="1회매수금" value={formatCurrency(summary.oneBuyAmount)} />
      <SummaryItem label="목표가" value={formatOptionalCurrency(summary.targetPrice)} />
      <SummaryItem
        label="별 매도가"
        value={formatOptionalCurrency(summary.starSellPrice)}
      />
      <SummaryItem
        label="별 매수가"
        value={formatOptionalCurrency(summary.starBuyPrice)}
      />
      <SummaryItem label="전일 종가" value={formatOptionalCurrency(summary.referenceClose)} />
      <SummaryItem label="원금 기준" value={formatCurrency(summary.capitalBase)} />
      {summary.reverseAverageClose ? (
        <SummaryItem
          label="5일 평균"
          value={formatCurrency(summary.reverseAverageClose)}
        />
      ) : null}
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
      parseNumber(form.gainPercent),
    ),
    formToState(form),
  )
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
  const recentCloses = Array.isArray(source.recentCloses)
    ? source.recentCloses
    : DEFAULT_FORM.recentCloses

  return {
    symbol: isStrategySymbol(source.symbol) ? source.symbol : DEFAULT_FORM.symbol,
    splitCount: isSplitCount(source.splitCount)
      ? source.splitCount
      : DEFAULT_FORM.splitCount,
    gainPercent: stringifyInput(source.gainPercent, DEFAULT_FORM.gainPercent),
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
  const result = isGenerateOrdersResult(value.result)
    ? value.result
    : calculateFromForm(input)

  return [
    {
      id: value.id,
      createdAt: value.createdAt,
      input,
      result,
    },
  ]
}

function isGenerateOrdersResult(value: unknown): value is GenerateOrdersResult {
  if (!isRecord(value)) {
    return false
  }

  return (
    Array.isArray(value.orders) &&
    Array.isArray(value.warnings) &&
    isCalculationSummary(value.summary)
  )
}

function isCalculationSummary(value: unknown): boolean {
  if (!isRecord(value)) {
    return false
  }

  return (
    isMode(value.configuredMode) &&
    isMode(value.effectiveMode) &&
    typeof value.wasAutoReversed === 'boolean' &&
    typeof value.gainPercent === 'number' &&
    typeof value.splitCount === 'number' &&
    typeof value.turn === 'number' &&
    typeof value.starPercent === 'number' &&
    typeof value.oneBuyAmount === 'number' &&
    typeof value.capitalBase === 'number'
  )
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

function getPreviousClose(candles: DailyCandle[], date: string): number | undefined {
  const index = candles.findIndex((candle) => candle.date === date)

  if (index <= 0) {
    return undefined
  }

  return candles[index - 1].close
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

function formatNumber(value: number): string {
  return numberFormatter.format(value)
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
