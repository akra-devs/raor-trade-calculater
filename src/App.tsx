import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'
import { CandlestickChart } from './components/CandlestickChart'
import { ExecutionAnalysisSection } from './components/ExecutionAnalysisSection'
import {
  EXECUTION_PAGE_SIZE,
  ExecutionLedgerSection,
} from './components/ExecutionLedgerSection'
import { HistoryItem } from './components/HistoryItem'
import { HistoryPagination } from './components/HistoryPagination'
import { NoticeModal, ResultModal } from './components/ResultModal'
import { PortfolioReturnChart } from './components/PortfolioReturnChart'
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
  calculateExecutionAmounts,
  type ExecutionRecord,
} from './domain/executions'
import {
  TRADE_COST_RATE,
  calculateProfitLoss,
  type ProfitLossResult,
} from './domain/profitLoss'
import {
  calculatePortfolioReturns,
  type PortfolioReturnCheckpoint,
} from './domain/portfolioReturns'
import {
  DEFAULT_FORM,
  PROFILE_EXECUTION_RECORD_LIMIT,
  createDefaultFormForSymbol,
  createProfileFromActive,
  deleteProfile,
  getActiveProfile,
  loadProfileStore,
  normalizeDateInput,
  normalizeFormState,
  renameProfile,
  saveProfileStore,
  setActiveProfileId,
  symbolOptions,
  updateProfile,
  withProfileForm,
} from './domain/profiles'
import {
  SUPPORTED_SPLITS,
  calculateNextTurnFromExecution,
  generateOrders,
  getStrategyConfig,
  type GenerateOrdersResult,
  type NextTurnCalculation,
  type SplitCount,
  type StrategyState,
  type StrategySymbol,
} from './domain/strategy'
import {
  formatChange,
  formatCurrency,
  formatDateTime,
  formatNumber,
  formatOptionalCurrency,
} from './utils/formatters'
import type {
  AverageInputMode,
  CashInputMode,
  FormState,
  MarketDataFile,
  MarketStatus,
  NextTurnPreview,
  NoticeModalPayload,
  OrderSnapshot,
  Profile,
  ProfileStore,
  ResultModalPayload,
} from './types/app'

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

const PRICE_TABLE_PAGE_SIZE = 5
const HISTORY_PAGE_SIZE = 4
const EXECUTION_RECORD_LIMIT = PROFILE_EXECUTION_RECORD_LIMIT

type WorkspaceTab = 'analysis' | 'executions' | 'history' | 'prices' | 'returns'

const priceIntervalLabel: Record<PriceInterval, string> = {
  day: '일봉',
  week: '주봉',
  month: '월봉',
  year: '년봉',
}

const workspaceTabs: Array<{ id: WorkspaceTab; label: string }> = [
  { id: 'prices', label: '가격 데이터' },
  { id: 'returns', label: '수익률 그래프' },
  { id: 'history', label: '저장된 주문 기록' },
  { id: 'executions', label: '체결 목록' },
  { id: 'analysis', label: '체결 분석' },
]

function App() {
  const [profileStore, setProfileStore] = useState<ProfileStore>(() =>
    loadProfileStore(),
  )
  const activeProfile = useMemo(
    () => getActiveProfile(profileStore),
    [profileStore],
  )
  const form = activeProfile.form
  const symbolForms = activeProfile.symbolForms
  const history = activeProfile.history
  const executions = activeProfile.executions
  const executionAnalysisEndDate = activeProfile.executionAnalysisEndDate
  const executionAnalysisStartDate = activeProfile.executionAnalysisStartDate
  const [resultModal, setResultModal] = useState<ResultModalPayload | null>(null)
  const [noticeModal, setNoticeModal] = useState<NoticeModalPayload | null>(null)
  const [historyPage, setHistoryPage] = useState(1)
  const [executionPage, setExecutionPage] = useState(1)
  const [dailyCandles, setDailyCandles] = useState<
    Record<StrategySymbol, DailyCandle[]>
  >(() => ({ TQQQ: [], SOXL: [] }))
  const [marketStatuses, setMarketStatuses] = useState<
    Partial<Record<StrategySymbol, MarketStatus>>
  >({})
  const [priceMessage, setPriceMessage] = useState('')
  const [marketDataLoading, setMarketDataLoading] = useState(false)
  const [priceInterval, setPriceInterval] = useState<PriceInterval>('day')
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('prices')
  const [selectedDate, setSelectedDate] = useState('')
  const [showRecentCloses, setShowRecentCloses] = useState(false)
  const persistProfileStoreUpdate = useCallback(
    (updater: (current: ProfileStore) => ProfileStore) => {
      setProfileStore((current) => {
        const nextStore = updater(current)
        saveProfileStore(nextStore)

        return nextStore
      })
    },
    [],
  )
  const updateActiveProfileState = useCallback(
    (updater: (profile: Profile) => Profile) => {
      const profileId = activeProfile.id

      persistProfileStoreUpdate((current) =>
        updateProfile(current, profileId, updater),
      )
    },
    [activeProfile.id, persistProfileStoreUpdate],
  )
  const replaceActiveForm = useCallback(
    (nextForm: FormState) => {
      updateActiveProfileState((profile) => withProfileForm(profile, nextForm))
    },
    [updateActiveProfileState],
  )
  const updateActiveForm = useCallback(
    (updater: (current: FormState) => FormState) => {
      updateActiveProfileState((profile) =>
        withProfileForm(profile, updater(profile.form)),
      )
    },
    [updateActiveProfileState],
  )
  const replaceActiveHistory = useCallback(
    (nextHistory: OrderSnapshot[]) => {
      updateActiveProfileState((profile) => ({
        ...profile,
        history: nextHistory,
      }))
    },
    [updateActiveProfileState],
  )
  const replaceActiveExecutions = useCallback(
    (nextExecutions: ExecutionRecord[]) => {
      updateActiveProfileState((profile) => ({
        ...profile,
        executions: nextExecutions,
      }))
    },
    [updateActiveProfileState],
  )
  const setExecutionAnalysisStartDate = useCallback(
    (startDate: string) => {
      updateActiveProfileState((profile) => ({
        ...profile,
        executionAnalysisStartDate: startDate
          ? normalizeDateInput(startDate) ?? ''
          : '',
      }))
    },
    [updateActiveProfileState],
  )
  const setExecutionAnalysisEndDate = useCallback(
    (endDate: string) => {
      updateActiveProfileState((profile) => ({
        ...profile,
        executionAnalysisEndDate: endDate
          ? normalizeDateInput(endDate) ?? ''
          : '',
      }))
    },
    [updateActiveProfileState],
  )
  const resetExecutionAnalysisPeriod = useCallback(() => {
    updateActiveProfileState((profile) => ({
      ...profile,
      executionAnalysisStartDate: '',
      executionAnalysisEndDate: '',
    }))
  }, [updateActiveProfileState])
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
  const activeMarketStatus = marketStatuses[form.symbol]
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
  const portfolioValuationDate = selectedOrderDate ?? effectiveSelectedDate
  const dateOptions = useMemo(
    () => [...sortDailyCandles(activeDailyCandles)].reverse(),
    [activeDailyCandles],
  )
  const portfolioCheckpoints = useMemo<PortfolioReturnCheckpoint[]>(
    () =>
      history.flatMap((snapshot) => {
        const preview = getNextTurnPreview(
          snapshot,
          dailyCandles[snapshot.input.symbol] ?? [],
        )

        if (!preview.calculation || !preview.executionCandle) {
          return []
        }

        return [
          {
            averagePrice: preview.calculation.nextAveragePrice,
            budget: getProfitLossBudget(snapshot.input, snapshot.result),
            cashBalance: preview.calculation.nextCashBalance,
            date: preview.executionCandle.date,
            executedRecordCount: preview.calculation.executedOrderTags.length,
            shares: preview.calculation.nextShares,
            sourceCreatedAt: snapshot.createdAt,
            sourceSnapshotId: snapshot.id,
            symbol: snapshot.input.symbol,
          },
        ]
      }),
    [dailyCandles, history],
  )
  const portfolioCheckpointCount = portfolioCheckpoints.filter(
    (checkpoint) => checkpoint.symbol === form.symbol,
  ).length
  const portfolioReturnResult = useMemo(
    () =>
      calculatePortfolioReturns({
        candles: activeDailyCandles,
        checkpoints: portfolioCheckpoints,
        endDate: portfolioValuationDate,
        symbol: form.symbol,
      }),
    [activeDailyCandles, form.symbol, portfolioCheckpoints, portfolioValuationDate],
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
      setMarketStatuses((current) => ({
        ...current,
        [symbol]: normalizeMarketStatus(payload.marketStatus),
      }))
      setPriceMessage(formatMarketDataLoadMessage(symbol, payload, candles.length))
    } catch (error) {
      setDailyCandles((current) => ({
        ...current,
        [symbol]: [],
      }))
      setMarketStatuses((current) => ({
        ...current,
        [symbol]: undefined,
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

  useEffect(() => {
    if (executions.length === 0 || history.length === 0) {
      return
    }

    const metadataByKey = new Map<
      string,
      Pick<ExecutionRecord, 'averagePriceAfter' | 'sharesAfter'>
    >()

    for (const snapshot of history) {
      const preview = getNextTurnPreview(
        snapshot,
        dailyCandles[snapshot.input.symbol] ?? [],
      )

      for (const record of createExecutionRecordsFromPreview(snapshot, preview)) {
        const key = getExecutionSourceKey(record)

        if (
          key &&
          typeof record.sharesAfter === 'number' &&
          record.sharesAfter >= 0
        ) {
          metadataByKey.set(key, {
            averagePriceAfter:
              typeof record.averagePriceAfter === 'number' &&
              record.averagePriceAfter > 0
                ? record.averagePriceAfter
                : undefined,
            sharesAfter: record.sharesAfter,
          })
        }
      }
    }

    if (metadataByKey.size === 0) {
      return
    }

    let didUpdate = false
    const nextExecutions = executions.map((record) => {
      const key = getExecutionSourceKey(record)
      const metadata = key ? metadataByKey.get(key) : undefined

      if (!metadata) {
        return record
      }

      if (
        record.averagePriceAfter === metadata.averagePriceAfter &&
        record.sharesAfter === metadata.sharesAfter
      ) {
        return record
      }

      didUpdate = true

      return {
        ...record,
        averagePriceAfter: metadata.averagePriceAfter,
        sharesAfter: metadata.sharesAfter,
      }
    })

    if (!didUpdate) {
      return
    }

    const timer = window.setTimeout(() => {
      persistProfileStoreUpdate((current) =>
        updateProfile(current, activeProfile.id, (profile) => ({
          ...profile,
          executions: nextExecutions,
        })),
      )
    }, 0)

    return () => window.clearTimeout(timer)
  }, [activeProfile.id, dailyCandles, executions, history, persistProfileStoreUpdate])

  function updateField<Key extends keyof FormState>(
    key: Key,
    value: FormState[Key],
  ) {
    updateActiveForm((current) => ({
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

    updateActiveProfileState((profile) => ({
      ...profile,
      form: normalizedNextForm,
      symbolForms: nextSymbolForms,
    }))
    setSelectedDate(
      inferSelectedDateFromForm(
        normalizedNextForm,
        dailyCandles[normalizedNextForm.symbol] ?? [],
      ),
    )
    setPriceMessage(
      `${symbol} 전용 상태를 불러왔습니다. T, 잔금, 보유수량, 평단은 종목별로 분리됩니다.`,
    )
  }

  function updateRecentClose(index: number, value: string) {
    updateActiveForm((current) => {
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
    replaceActiveHistory(nextHistory)
    setHistoryPage(1)
  }

  function handleRestore(snapshot: OrderSnapshot) {
    const nextInput = snapshot.input

    replaceActiveForm(nextInput)
    setSelectedDate(snapshot.referenceDate ?? '')
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
    const executionRecords = createExecutionRecordsFromPreview(snapshot, preview)
    const newExecutionRecords = filterNewExecutionRecords(
      executionRecords,
      executions,
    )

    if (newExecutionRecords.length > 0) {
      const nextExecutions = [
        ...newExecutionRecords,
        ...executions,
      ].slice(0, EXECUTION_RECORD_LIMIT)

      replaceActiveExecutions(nextExecutions)
      setExecutionPage(1)
    }

    const executionRecordDetail =
      newExecutionRecords.length > 0
        ? `체결 목록 ${newExecutionRecords.length}건 추가`
        : executionRecords.length > 0
          ? '체결 목록은 이미 추가되어 중복 등록하지 않음'
          : '체결된 주문 없음'

    replaceActiveForm(nextInput)
    setSelectedDate(preview.executionCandle.date)
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
        `잔금 ${formatCurrency(preview.calculation.nextCashBalance)} · 추정 평단가 ${formatCurrency(preview.calculation.nextAveragePrice)}`,
        executionRecordDetail,
      ],
      message:
        '다음 거래일 가격으로 주문 체결을 추정해 계산기 입력 상태와 체결 목록에 반영했습니다. 실제 체결과 다르면 입력값이나 체결 기록을 직접 조정하세요.',
      title: '체결 추정이 반영되었습니다',
    })
  }

  function handleApplyAllHistoryExecutions() {
    let readySnapshotCount = 0
    let noExecutionSnapshotCount = 0
    const executionRecords: ExecutionRecord[] = []

    for (const snapshot of history) {
      const preview = getNextTurnPreview(
        snapshot,
        dailyCandles[snapshot.input.symbol] ?? [],
      )

      if (!preview.calculation || !preview.executionCandle) {
        continue
      }

      readySnapshotCount += 1

      const snapshotExecutionRecords = createExecutionRecordsFromPreview(
        snapshot,
        preview,
      )

      if (snapshotExecutionRecords.length === 0) {
        noExecutionSnapshotCount += 1
      }

      executionRecords.push(...snapshotExecutionRecords)
    }

    const newExecutionRecords = filterNewExecutionRecords(
      executionRecords,
      executions,
    )

    if (newExecutionRecords.length > 0) {
      const nextExecutions = [
        ...newExecutionRecords,
        ...executions,
      ].slice(0, EXECUTION_RECORD_LIMIT)

      replaceActiveExecutions(nextExecutions)
      setExecutionPage(1)
    }

    const duplicateCount = executionRecords.length - newExecutionRecords.length
    const unavailableCount = history.length - readySnapshotCount
    const details = [
      `저장 기록 ${history.length}개 중 ${readySnapshotCount}개 확인`,
      `체결 목록 ${newExecutionRecords.length}건 추가`,
    ]

    if (duplicateCount > 0) {
      details.push(`이미 반영된 체결 ${duplicateCount}건 제외`)
    }

    if (noExecutionSnapshotCount > 0) {
      details.push(`체결된 주문이 없는 기록 ${noExecutionSnapshotCount}개`)
    }

    if (unavailableCount > 0) {
      details.push(`다음 거래일 데이터가 부족한 기록 ${unavailableCount}개`)
    }

    setPriceMessage(
      newExecutionRecords.length > 0
        ? `저장된 주문 기록 기준 체결 목록 ${newExecutionRecords.length}건을 추가했습니다.`
        : '저장된 주문 기록에서 새로 추가할 체결 기록이 없습니다.',
    )
    setNoticeModal({
      details,
      message:
        '저장된 주문 기록 전체에서 다음 거래일 가격으로 체결된 주문만 체결 목록에 반영했습니다. 계산기 입력 상태는 변경하지 않았습니다.',
      title:
        newExecutionRecords.length > 0
          ? '전체 체결 추정이 반영되었습니다'
          : '추가할 체결 기록이 없습니다',
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

    replaceActiveForm(nextForm)
    setSelectedDate('')
    setResultModal(null)
    setNoticeModal(null)
  }

  function handleClearHistory() {
    replaceActiveHistory([])
    setHistoryPage(1)
  }

  function handleDeleteHistoryItem(snapshotId: string) {
    const nextHistory = history.filter((snapshot) => snapshot.id !== snapshotId)

    replaceActiveHistory(nextHistory)
    setHistoryPage((currentPage) =>
      Math.min(
        currentPage,
        Math.max(1, Math.ceil(nextHistory.length / HISTORY_PAGE_SIZE)),
      ),
    )
  }

  function handleDeleteExecution(recordId: string) {
    const nextExecutions = executions.filter((record) => record.id !== recordId)

    replaceActiveExecutions(nextExecutions)
    setExecutionPage((currentPage) =>
      Math.min(
        currentPage,
        Math.max(1, Math.ceil(nextExecutions.length / EXECUTION_PAGE_SIZE)),
      ),
    )
  }

  function handleClearExecutions() {
    replaceActiveExecutions([])
    setExecutionPage(1)
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
    replaceActiveForm(nextForm)
    setPriceMessage(
      `${selectedCandle.date} 종가 ${formatCurrency(
        selectedCandle.close,
      )}를 전일 종가로 적용했습니다. 주문일은 ${
        getOrderDateForReferenceDate(sortedCandles, selectedCandle.date) ??
        '다음 거래일'
      }입니다.`,
    )
  }

  function handleRefreshYfinanceJson() {
    void refreshYfinanceData()
  }

  function commitProfileStore(nextStore: ProfileStore) {
    setProfileStore(nextStore)
    saveProfileStore(nextStore)
  }

  function resetViewForProfile(profile: Profile) {
    setSelectedDate(
      inferSelectedDateFromForm(
        profile.form,
        dailyCandles[profile.form.symbol] ?? [],
      ),
    )
    setHistoryPage(1)
    setExecutionPage(1)
    setResultModal(null)
    setNoticeModal(null)
  }

  function handleSelectProfile(profileId: string) {
    if (profileId === activeProfile.id) {
      return
    }

    const nextStore = setActiveProfileId(profileStore, profileId)
    const nextProfile = getActiveProfile(nextStore)

    commitProfileStore(nextStore)
    resetViewForProfile(nextProfile)
    setPriceMessage(`${nextProfile.name} 프로필을 불러왔습니다.`)
  }

  function handleCreateProfile() {
    const suggestedName = `프로필 ${profileStore.profiles.length + 1}`
    const name = window.prompt('새 프로필 이름', suggestedName)

    if (name === null) {
      return
    }

    const startDateInput = window.prompt(
      '프로필 시작일 (YYYY-MM-DD, 비워두기 가능)',
      new Date().toISOString().slice(0, 10),
    )

    if (startDateInput === null) {
      return
    }

    const trimmedStartDate = startDateInput.trim()
    const startDate = trimmedStartDate
      ? normalizeDateInput(trimmedStartDate)
      : ''

    if (trimmedStartDate && !startDate) {
      setNoticeModal({
        message: '시작일은 YYYY-MM-DD 형식의 실제 날짜여야 합니다.',
        title: '프로필을 만들지 못했습니다',
      })
      return
    }

    const nextStore = createProfileFromActive(profileStore, {
      name,
      startDate,
    })
    const nextProfile = getActiveProfile(nextStore)

    commitProfileStore(nextStore)
    resetViewForProfile(nextProfile)
    setPriceMessage(`${nextProfile.name} 프로필을 만들었습니다.`)
  }

  function handleRenameProfile() {
    const name = window.prompt('프로필 이름', activeProfile.name)

    if (name === null) {
      return
    }

    const nextStore = renameProfile(profileStore, activeProfile.id, name)
    const nextProfile = getActiveProfile(nextStore)

    commitProfileStore(nextStore)
    setPriceMessage(`${nextProfile.name} 프로필 이름을 저장했습니다.`)
  }

  function handleDeleteProfile() {
    if (profileStore.profiles.length <= 1) {
      setNoticeModal({
        message: '마지막 1개 프로필은 삭제할 수 없습니다.',
        title: '프로필을 삭제하지 않았습니다',
      })
      return
    }

    if (!window.confirm(`${activeProfile.name} 프로필을 삭제할까요?`)) {
      return
    }

    const nextStore = deleteProfile(profileStore, activeProfile.id)
    const nextProfile = getActiveProfile(nextStore)

    commitProfileStore(nextStore)
    resetViewForProfile(nextProfile)
    setPriceMessage(`${activeProfile.name} 프로필을 삭제했습니다.`)
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
          <span className="eyebrow">v2 프로필 주문 계산</span>
          <h1>라오어 무한매수 주문 계산기</h1>
        </div>
        <div className="strategy-badges" aria-label="지원 전략">
          <span>기본 ETF TQQQ</span>
          <span>TQQQ 15% · SOXL 20%</span>
          <span>20 / 30 / 40분할</span>
        </div>
      </header>

      <ProfileSwitcher
        activeProfile={activeProfile}
        profiles={profileStore.profiles}
        onCreate={handleCreateProfile}
        onDelete={handleDeleteProfile}
        onRename={handleRenameProfile}
        onSelect={handleSelectProfile}
      />

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

      <WorkspaceTabs activeTab={workspaceTab} onChange={setWorkspaceTab} />

      {workspaceTab === 'prices' ? (
        <section className="panel price-panel" aria-labelledby="price-title">
          <div className="panel-heading">
            <h2 id="price-title">가격 데이터</h2>
            <div className="history-actions">
              <span className="panel-stat">{form.symbol}</span>
              <span className="panel-stat">원천 {activeDailyCandles.length}일</span>
              <span className="panel-stat">{priceIntervalLabel[priceInterval]} {visibleCandles.length}개</span>
              <MarketStatusBadge status={activeMarketStatus} />
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
      ) : null}

      {workspaceTab === 'returns' ? (
        <PortfolioReturnChart
          checkpointCount={portfolioCheckpointCount}
          result={portfolioReturnResult}
          symbol={form.symbol}
        />
      ) : null}

      {workspaceTab === 'history' ? (
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
                {historyPageRows.map((snapshot) => {
                  const candles = dailyCandles[snapshot.input.symbol] ?? []
                  const preview = getNextTurnPreview(snapshot, candles)
                  const profitLoss = getHistoryProfitLoss(snapshot, candles, preview)

                  return (
                    <HistoryItem
                      key={snapshot.id}
                      defaultGainPercent={DEFAULT_FORM.gainPercent}
                      onApplyNextTurn={handleApplyNextTurn}
                      onDelete={handleDeleteHistoryItem}
                      onRestore={handleRestore}
                      onShowOrders={handleShowHistoryOrders}
                      preview={preview}
                      profitLoss={profitLoss}
                      snapshot={snapshot}
                    />
                  )
                })}
              </div>
            </>
          )}
        </section>
      ) : null}

      {workspaceTab === 'executions' ? (
        <ExecutionLedgerSection
          currentPage={executionPage}
          historyCount={history.length}
          records={executions}
          onApplyAll={handleApplyAllHistoryExecutions}
          onClear={handleClearExecutions}
          onDelete={handleDeleteExecution}
          onPageChange={setExecutionPage}
        />
      ) : null}

      {workspaceTab === 'analysis' ? (
        <ExecutionAnalysisSection
          endDate={executionAnalysisEndDate}
          records={executions}
          startDate={executionAnalysisStartDate}
          symbol={form.symbol}
          onEndDateChange={setExecutionAnalysisEndDate}
          onResetPeriod={resetExecutionAnalysisPeriod}
          onStartDateChange={setExecutionAnalysisStartDate}
        />
      ) : null}
    </main>
  )
}

function WorkspaceTabs({
  activeTab,
  onChange,
}: {
  activeTab: WorkspaceTab
  onChange: (tab: WorkspaceTab) => void
}) {
  return (
    <nav className="workspace-tabs" aria-label="작업 영역 탭">
      {workspaceTabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          aria-current={activeTab === tab.id ? 'page' : undefined}
          className={activeTab === tab.id ? 'active' : ''}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  )
}

function ProfileSwitcher({
  activeProfile,
  onCreate,
  onDelete,
  onRename,
  onSelect,
  profiles,
}: {
  activeProfile: Profile
  onCreate: () => void
  onDelete: () => void
  onRename: () => void
  onSelect: (profileId: string) => void
  profiles: Profile[]
}) {
  return (
    <section className="profile-switcher" aria-label="프로필 관리">
      <div className="profile-current">
        <span>활성 프로필</span>
        <strong>{activeProfile.name}</strong>
      </div>

      <div className="profile-facts" aria-label="프로필 요약">
        <span>시작일 {activeProfile.startDate || '-'}</span>
        <span>{activeProfile.form.symbol}</span>
        <span>{activeProfile.form.splitCount}분할</span>
        <span>목표 {activeProfile.form.gainPercent || '-'}%</span>
      </div>

      <div className="profile-controls">
        <label className="field profile-select-field" htmlFor="profile-select">
          <span>프로필</span>
          <select
            id="profile-select"
            value={activeProfile.id}
            onChange={(event) => onSelect(event.target.value)}
          >
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="secondary-action" onClick={onCreate}>
          새 프로필
        </button>
        <button type="button" className="secondary-action" onClick={onRename}>
          이름변경
        </button>
        <button
          type="button"
          className="danger-action"
          disabled={profiles.length <= 1}
          onClick={onDelete}
        >
          삭제
        </button>
      </div>
    </section>
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

function MarketStatusBadge({ status }: { status?: MarketStatus }) {
  const tone = !status ? 'unknown' : status.isTradingDay ? 'open' : 'closed'

  return (
    <span className={`panel-stat market-status-stat ${tone}`}>
      {formatMarketStatusLabel(status)}
    </span>
  )
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
  const [isExpanded, setIsExpanded] = useState(false)
  const pageCount = Math.max(1, Math.ceil(latestFirst.length / PRICE_TABLE_PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageStart = (currentPage - 1) * PRICE_TABLE_PAGE_SIZE
  const pageRows = latestFirst.slice(pageStart, pageStart + PRICE_TABLE_PAGE_SIZE)
  const tablePanelId = `${intervalLabel}-price-list-panel`

  if (latestFirst.length === 0) {
    return <div className="empty-state">yfinance {intervalLabel} 데이터 없음</div>
  }

  return (
    <section className="price-list" aria-label={`${intervalLabel} 가격 리스트`}>
      <div className="price-list-heading">
        <div>
          <strong>{intervalLabel} 가격 리스트</strong>
          <span>
            {isExpanded
              ? `${pageStart + 1}-${Math.min(pageStart + PRICE_TABLE_PAGE_SIZE, latestFirst.length)} / ${latestFirst.length}`
              : `${latestFirst.length}개`}
          </span>
        </div>
        <div className="price-list-actions">
          <button
            type="button"
            aria-controls={tablePanelId}
            aria-expanded={isExpanded}
            className="secondary-action compact"
            onClick={() => setIsExpanded((current) => !current)}
          >
            {isExpanded ? '접기' : '펼치기'}
          </button>
          {isExpanded ? (
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
          ) : null}
        </div>
      </div>

      {isExpanded ? (
        <div id={tablePanelId} className="table-wrap price-table-wrap">
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
      ) : null}
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

function createExecutionRecordsFromPreview(
  snapshot: OrderSnapshot,
  preview: NextTurnPreview,
  options: { createdAt?: string; idPrefix?: string } = {},
): ExecutionRecord[] {
  if (!preview.calculation || !preview.executionCandle) {
    return []
  }

  const calculation = preview.calculation
  const executedTags = new Set(preview.calculation.executedOrderTags)
  const executionCandle = preview.executionCandle
  const createdAt = options.createdAt ?? new Date().toISOString()

  return snapshot.result.orders.flatMap((order) => {
    if (!executedTags.has(order.tag)) {
      return []
    }

    const executionPrice =
      order.type === 'LIMIT' && typeof order.price === 'number'
        ? order.price
        : executionCandle.close

    if (executionPrice <= 0 || order.quantity <= 0) {
      return []
    }

    const price = roundMoney(executionPrice)
    const quantity = roundQuantity(order.quantity)
    const amounts = calculateExecutionAmounts(
      order.side,
      price,
      quantity,
      TRADE_COST_RATE,
    )

    return [
      {
        averagePriceAfter: calculation.nextAveragePrice,
        id: options.idPrefix
          ? `${options.idPrefix}:${order.id}`
          : createSnapshotId(),
        createdAt,
        date: executionCandle.date,
        feeAmount: amounts.feeAmount,
        feeRate: TRADE_COST_RATE,
        grossAmount: amounts.grossAmount,
        netCashFlow: amounts.netCashFlow,
        note: `${order.label} · 저장 주문 기록 기반 체결 추정`,
        price,
        quantity,
        side: order.side,
        sharesAfter: calculation.nextShares,
        sourceOrderId: order.id,
        sourceSnapshotId: snapshot.id,
        symbol: snapshot.input.symbol,
      },
    ]
  })
}

function filterNewExecutionRecords(
  records: ExecutionRecord[],
  existingRecords: ExecutionRecord[],
): ExecutionRecord[] {
  const existingExecutionKeys = new Set(
    existingRecords.flatMap((record) => {
      const key = getExecutionSourceKey(record)

      return key ? [key] : []
    }),
  )

  return records.filter((record) => {
    const key = getExecutionSourceKey(record)

    return !key || !existingExecutionKeys.has(key)
  })
}

function getExecutionSourceKey(record: ExecutionRecord): string | undefined {
  if (!record.sourceSnapshotId || !record.sourceOrderId) {
    return undefined
  }

  return `${record.sourceSnapshotId}:${record.sourceOrderId}`
}

function normalizeMarketDataFileCandles(payload: MarketDataFile): DailyCandle[] {
  return normalizeMarketDataCandles(payload.candles)
}

function normalizeMarketStatus(value: unknown): MarketStatus | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const date = typeof value.date === 'string' ? value.date : ''

  if (!normalizeDateInput(date)) {
    return undefined
  }

  return {
    calendar: typeof value.calendar === 'string' ? value.calendar : undefined,
    date,
    isTradingDay: value.isTradingDay === true,
    marketClose:
      typeof value.marketClose === 'string' ? value.marketClose : undefined,
    marketOpen:
      typeof value.marketOpen === 'string' ? value.marketOpen : undefined,
    nextTradingDay:
      typeof value.nextTradingDay === 'string' ? value.nextTradingDay : undefined,
    previousTradingDay:
      typeof value.previousTradingDay === 'string'
        ? value.previousTradingDay
        : undefined,
    status: typeof value.status === 'string' ? value.status : undefined,
    timezone: typeof value.timezone === 'string' ? value.timezone : undefined,
  }
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

function formatMarketStatusLabel(status?: MarketStatus): string {
  if (!status) {
    return 'NYSE 상태 확인 전'
  }

  const calendar = status.calendar ?? 'NYSE'

  if (status.isTradingDay) {
    return `${calendar} ${status.date} 정상 거래일`
  }

  const nextTradingDay = status.nextTradingDay
    ? ` · 다음 ${status.nextTradingDay}`
    : ''

  return `${calendar} ${status.date} 휴장${nextTradingDay}`
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

function parseUnknownNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    return parseNumber(value)
  }

  return 0
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

function createSnapshotId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }

  return `${Date.now()}`
}

export default App
