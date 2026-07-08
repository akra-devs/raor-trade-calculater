import {
  calculateExecutionAmounts,
  type ExecutionRecord,
  type ExecutionSide,
} from './executions'
import type {
  ExecutedProfitLossOrder,
  ProfitLossResult,
} from './profitLoss'
import {
  SUPPORTED_SPLITS,
  generateOrders,
  getDefaultTargetProfitPercent,
  getStrategyConfig,
  type Mode,
  type SplitCount,
  type StrategyState,
  type StrategySymbol,
} from './strategy'
import type {
  AverageInputMode,
  CashInputMode,
  FormState,
  OrderSnapshot,
  Profile,
  ProfileStore,
} from '../types/app'

export const STORAGE_PROFILE_KEY = 'raor:v2:profiles'
export const STORAGE_INPUT_KEY = 'raor:v1:input'
export const STORAGE_SYMBOL_INPUTS_KEY = 'raor:v1:symbol-inputs'
export const STORAGE_HISTORY_KEY = 'raor:v1:order-snapshots'
export const STORAGE_EXECUTIONS_KEY = 'raor:v1:executions'
export const DEFAULT_PROFILE_NAME = '기본 프로필'
export const PROFILE_HISTORY_LIMIT = 50
export const PROFILE_EXECUTION_RECORD_LIMIT = 500

export const symbolOptions: StrategySymbol[] = ['TQQQ', 'SOXL']

export const DEFAULT_FORM: FormState = {
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

export interface V1ProfileSources {
  executions?: unknown
  form?: unknown
  history?: unknown
  symbolForms?: unknown
}

export interface InitializeProfileStoreOptions {
  id?: string
  now?: string
  v1Sources?: V1ProfileSources
  v2Store?: unknown
  v2StoreExists: boolean
}

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

interface StorageEntry {
  exists: boolean
  value?: unknown
}

export function createDefaultFormForSymbol(symbol: StrategySymbol): FormState {
  return {
    ...DEFAULT_FORM,
    symbol,
    gainPercent: String(getDefaultTargetProfitPercent(symbol)),
  }
}

export function loadProfileStore(storage = getBrowserStorage()): ProfileStore {
  if (!storage) {
    return createProfileStoreFromV1Sources({})
  }

  const v2Entry = readStorageEntry(storage, STORAGE_PROFILE_KEY)

  if (v2Entry.exists) {
    const store = normalizeProfileStore(v2Entry.value)
    saveProfileStore(store, storage)
    return store
  }

  const store = createProfileStoreFromV1Sources({
    form: readStorageEntry(storage, STORAGE_INPUT_KEY).value,
    symbolForms: readStorageEntry(storage, STORAGE_SYMBOL_INPUTS_KEY).value,
    history: readStorageEntry(storage, STORAGE_HISTORY_KEY).value,
    executions: readStorageEntry(storage, STORAGE_EXECUTIONS_KEY).value,
  })

  saveProfileStore(store, storage)

  return store
}

export function saveProfileStore(
  store: ProfileStore,
  storage = getBrowserStorage(),
) {
  if (!storage) {
    return
  }

  try {
    storage.setItem(STORAGE_PROFILE_KEY, JSON.stringify(normalizeProfileStore(store)))
  } catch {
    return
  }
}

export function initializeProfileStore({
  id,
  now,
  v1Sources,
  v2Store,
  v2StoreExists,
}: InitializeProfileStoreOptions): {
  migratedFromV1: boolean
  store: ProfileStore
} {
  if (v2StoreExists) {
    return {
      migratedFromV1: false,
      store: normalizeProfileStore(v2Store, { id, now }),
    }
  }

  return {
    migratedFromV1: true,
    store: createProfileStoreFromV1Sources(v1Sources ?? {}, { id, now }),
  }
}

export function createProfileStoreFromV1Sources(
  sources: V1ProfileSources,
  options: { id?: string; now?: string } = {},
): ProfileStore {
  const now = options.now ?? new Date().toISOString()
  const form = normalizeFormState(sources.form)
  const profile: Profile = {
    id: options.id ?? createProfileId(),
    name: DEFAULT_PROFILE_NAME,
    createdAt: now,
    updatedAt: now,
    startDate: '',
    form,
    symbolForms: normalizeSymbolFormStates(sources.symbolForms, form),
    history: normalizeHistory(sources.history),
    executions: normalizeExecutions(sources.executions),
    executionAnalysisStartDate: '',
    executionAnalysisEndDate: '',
  }

  return {
    activeProfileId: profile.id,
    profiles: [profile],
  }
}

export function normalizeProfileStore(
  value: unknown,
  options: { id?: string; now?: string } = {},
): ProfileStore {
  const now = options.now ?? new Date().toISOString()
  const source = isRecord(value) ? value : {}
  const seenIds = new Set<string>()
  const profiles = Array.isArray(source.profiles)
    ? source.profiles.flatMap((profile, index) => {
        const normalized = normalizeProfile(profile, {
          fallbackName:
            index === 0 ? DEFAULT_PROFILE_NAME : `프로필 ${index + 1}`,
          now,
        })

        if (!normalized) {
          return []
        }

        const id = seenIds.has(normalized.id) ? createProfileId() : normalized.id
        seenIds.add(id)

        return [
          {
            ...normalized,
            id,
          },
        ]
      })
    : []

  if (profiles.length === 0) {
    profiles.push(
      createProfileStoreFromV1Sources({}, { id: options.id, now }).profiles[0],
    )
  }

  const activeProfileId =
    typeof source.activeProfileId === 'string' &&
    profiles.some((profile) => profile.id === source.activeProfileId)
      ? source.activeProfileId
      : profiles[0].id

  return {
    activeProfileId,
    profiles,
  }
}

export function getActiveProfile(store: ProfileStore): Profile {
  const normalized = normalizeProfileStore(store)

  return (
    normalized.profiles.find(
      (profile) => profile.id === normalized.activeProfileId,
    ) ?? normalized.profiles[0]
  )
}

export function setActiveProfileId(
  store: ProfileStore,
  profileId: string,
): ProfileStore {
  const normalized = normalizeProfileStore(store)

  if (!normalized.profiles.some((profile) => profile.id === profileId)) {
    return normalized
  }

  return {
    ...normalized,
    activeProfileId: profileId,
  }
}

export function createProfileFromActive(
  store: ProfileStore,
  options: { id?: string; name: string; now?: string; startDate?: string },
): ProfileStore {
  const normalized = normalizeProfileStore(store)
  const activeProfile = getActiveProfile(normalized)
  const now = options.now ?? new Date().toISOString()
  let id = options.id ?? createProfileId()

  while (normalized.profiles.some((profile) => profile.id === id)) {
    id = createProfileId()
  }

  const nextProfile = normalizeProfile(
    {
      ...cloneJson(activeProfile),
      id,
      name: normalizeProfileName(options.name, `프로필 ${normalized.profiles.length + 1}`),
      createdAt: now,
      updatedAt: now,
      startDate: normalizeDateInput(options.startDate ?? '') ?? '',
    },
    { now },
  )

  if (!nextProfile) {
    return normalized
  }

  return {
    activeProfileId: id,
    profiles: [...normalized.profiles, nextProfile],
  }
}

export function renameProfile(
  store: ProfileStore,
  profileId: string,
  name: string,
  options: { now?: string } = {},
): ProfileStore {
  const nextName = name.trim()

  if (!nextName) {
    return normalizeProfileStore(store)
  }

  return updateProfile(store, profileId, (profile) => ({
    ...profile,
    name: nextName,
  }), options)
}

export function deleteProfile(
  store: ProfileStore,
  profileId: string,
): ProfileStore {
  const normalized = normalizeProfileStore(store)

  if (normalized.profiles.length <= 1) {
    return normalized
  }

  const profiles = normalized.profiles.filter(
    (profile) => profile.id !== profileId,
  )

  if (profiles.length === normalized.profiles.length) {
    return normalized
  }

  return {
    activeProfileId:
      normalized.activeProfileId === profileId
        ? profiles[0].id
        : normalized.activeProfileId,
    profiles,
  }
}

export function updateActiveProfile(
  store: ProfileStore,
  updater: (profile: Profile) => Profile,
  options: { now?: string } = {},
): ProfileStore {
  const normalized = normalizeProfileStore(store)

  return updateProfile(normalized, normalized.activeProfileId, updater, options)
}

export function updateProfile(
  store: ProfileStore,
  profileId: string,
  updater: (profile: Profile) => Profile,
  options: { now?: string } = {},
): ProfileStore {
  const normalized = normalizeProfileStore(store)
  const now = options.now ?? new Date().toISOString()
  let didUpdate = false

  const profiles = normalized.profiles.map((profile) => {
    if (profile.id !== profileId) {
      return profile
    }

    didUpdate = true

    return (
      normalizeProfile(
        {
          ...updater(cloneJson(profile)),
          id: profile.id,
          updatedAt: now,
        },
        { now },
      ) ?? profile
    )
  })

  if (!didUpdate) {
    return normalized
  }

  return {
    ...normalized,
    profiles,
  }
}

export function withProfileForm(profile: Profile, form: FormState): Profile {
  const nextForm = normalizeFormState(form)

  return {
    ...profile,
    form: nextForm,
    symbolForms: {
      ...profile.symbolForms,
      [nextForm.symbol]: nextForm,
    },
  }
}

export function normalizeFormState(value: unknown): FormState {
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

export function normalizeSymbolFormStates(
  value: unknown,
  activeForm: FormState,
): Record<StrategySymbol, FormState> {
  const forms = Object.fromEntries(
    symbolOptions.map((symbol) => [symbol, createDefaultFormForSymbol(symbol)]),
  ) as Record<StrategySymbol, FormState>

  if (isRecord(value)) {
    for (const symbol of symbolOptions) {
      if (isRecord(value[symbol])) {
        forms[symbol] = normalizeFormState({
          ...value[symbol],
          symbol,
        })
      }
    }
  }

  forms[activeForm.symbol] = normalizeFormState(activeForm)

  return forms
}

export function normalizeDateInput(value: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return undefined
  }

  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return undefined
  }

  return value
}

function normalizeProfile(
  value: unknown,
  options: { fallbackName?: string; now: string },
): Profile | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const form = normalizeFormState(value.form)

  return {
    id: typeof value.id === 'string' && value.id ? value.id : createProfileId(),
    name: normalizeProfileName(value.name, options.fallbackName ?? DEFAULT_PROFILE_NAME),
    createdAt:
      typeof value.createdAt === 'string' && value.createdAt
        ? value.createdAt
        : options.now,
    updatedAt:
      typeof value.updatedAt === 'string' && value.updatedAt
        ? value.updatedAt
        : options.now,
    startDate:
      typeof value.startDate === 'string'
        ? normalizeDateInput(value.startDate) ?? ''
        : '',
    form,
    symbolForms: normalizeSymbolFormStates(value.symbolForms, form),
    history: normalizeHistory(value.history),
    executions: normalizeExecutions(value.executions),
    executionAnalysisStartDate:
      typeof value.executionAnalysisStartDate === 'string'
        ? normalizeDateInput(value.executionAnalysisStartDate) ?? ''
        : '',
    executionAnalysisEndDate:
      typeof value.executionAnalysisEndDate === 'string'
        ? normalizeDateInput(value.executionAnalysisEndDate) ?? ''
        : '',
  }
}

function normalizeHistory(value: unknown): OrderSnapshot[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap(normalizeOrderSnapshot).slice(0, PROFILE_HISTORY_LIMIT)
}

function normalizeExecutions(value: unknown): ExecutionRecord[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .flatMap(normalizeExecutionRecord)
    .slice(0, PROFILE_EXECUTION_RECORD_LIMIT)
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

  return [
    {
      id: value.id,
      createdAt: value.createdAt,
      referenceDate:
        typeof value.referenceDate === 'string' ? value.referenceDate : undefined,
      input,
      profitLoss: normalizeProfitLossResult(value.profitLoss),
      result,
    },
  ]
}

function normalizeExecutionRecord(value: unknown): ExecutionRecord[] {
  if (!isRecord(value)) {
    return []
  }

  const date = normalizeDateInput(stringifyInput(value.date, ''))
  const symbol = isStrategySymbol(value.symbol) ? value.symbol : undefined
  const side = normalizeExecutionSide(value.side)
  const price = parseUnknownNumber(value.price)
  const quantity = parseUnknownNumber(value.quantity)

  if (!date || !symbol || !side || price <= 0 || quantity <= 0) {
    return []
  }

  const feeRate = Math.max(0, parseUnknownNumber(value.feeRate))
  const amounts = calculateExecutionAmounts(side, price, quantity, feeRate)
  const averagePriceAfter = parseOptionalUnknownNumber(value.averagePriceAfter)
  const sharesAfter = parseOptionalUnknownNumber(value.sharesAfter)

  return [
    {
      averagePriceAfter:
        typeof averagePriceAfter === 'number' && averagePriceAfter > 0
          ? roundMoney(averagePriceAfter)
          : undefined,
      id: typeof value.id === 'string' ? value.id : createProfileId(),
      createdAt:
        typeof value.createdAt === 'string'
          ? value.createdAt
          : new Date().toISOString(),
      date,
      feeAmount: amounts.feeAmount,
      feeRate,
      grossAmount: amounts.grossAmount,
      netCashFlow: amounts.netCashFlow,
      note: typeof value.note === 'string' && value.note.trim()
        ? value.note.trim()
        : undefined,
      price: roundMoney(price),
      quantity: roundQuantity(quantity),
      side,
      sharesAfter:
        typeof sharesAfter === 'number' && sharesAfter >= 0
          ? roundQuantity(sharesAfter)
          : undefined,
      sourceOrderId:
        typeof value.sourceOrderId === 'string'
          ? value.sourceOrderId
          : undefined,
      sourceSnapshotId:
        typeof value.sourceSnapshotId === 'string'
          ? value.sourceSnapshotId
          : undefined,
      symbol,
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

function calculateFromForm(form: FormState) {
  return generateOrders(
    getStrategyConfig(
      form.symbol,
      form.splitCount,
      parseOptionalNumber(form.gainPercent),
    ),
    formToState(form),
  )
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

function readStorageEntry(storage: StorageLike, key: string): StorageEntry {
  let raw: string | null

  try {
    raw = storage.getItem(key)
  } catch {
    return { exists: false }
  }

  if (raw === null) {
    return { exists: false }
  }

  try {
    return {
      exists: true,
      value: JSON.parse(raw),
    }
  } catch {
    return {
      exists: true,
    }
  }
}

function getBrowserStorage(): StorageLike | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  return window.localStorage
}

function normalizeProfileName(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
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

function normalizeExecutionSide(value: unknown): ExecutionSide | undefined {
  return value === 'buy' || value === 'sell' ? value : undefined
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

function createProfileId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function cloneJson<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value
}
