import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROFILE_NAME,
  STORAGE_INPUT_KEY,
  STORAGE_PROFILE_KEY,
  createProfileFromActive,
  createProfileStoreFromV1Sources,
  deleteProfile,
  getActiveProfile,
  initializeProfileStore,
  loadProfileStore,
} from './profiles'

const now = '2026-07-08T00:00:00.000Z'

const v1Form = {
  symbol: 'SOXL',
  splitCount: 40,
  gainPercent: '22',
  mode: 'normal',
  turn: '7',
  cashBalance: '30000',
  shares: '12',
  averageInputMode: 'averagePrice',
  averagePrice: '80',
  previousClose: '90',
  reverseDays: '0',
  recentCloses: ['86', '87', '88', '89', '90'],
}

const v1History = [
  {
    id: 'snapshot-1',
    createdAt: '2026-07-07T12:00:00.000Z',
    referenceDate: '2026-07-06',
    input: v1Form,
  },
]

const v1Executions = [
  {
    id: 'execution-1',
    createdAt: '2026-07-07T13:00:00.000Z',
    date: '2026-07-07',
    feeRate: 0.001,
    price: 50,
    quantity: 3,
    side: 'buy',
    symbol: 'SOXL',
  },
]

describe('profile store migration and normalization', () => {
  it('migrates v1 saved state into the default profile', () => {
    const { migratedFromV1, store } = initializeProfileStore({
      id: 'profile-default',
      now,
      v1Sources: {
        executions: v1Executions,
        form: v1Form,
        history: v1History,
      },
      v2StoreExists: false,
    })
    const profile = getActiveProfile(store)

    expect(migratedFromV1).toBe(true)
    expect(store.activeProfileId).toBe('profile-default')
    expect(profile.name).toBe(DEFAULT_PROFILE_NAME)
    expect(profile.form.symbol).toBe('SOXL')
    expect(profile.form.turn).toBe('7')
    expect(profile.history).toHaveLength(1)
    expect(profile.executions).toEqual([
      expect.objectContaining({
        grossAmount: 150,
        id: 'execution-1',
        netCashFlow: -150.15,
        symbol: 'SOXL',
      }),
    ])
  })

  it('uses existing v2 profile data instead of v1 sources', () => {
    const { migratedFromV1, store } = initializeProfileStore({
      now,
      v1Sources: {
        form: {
          ...v1Form,
          symbol: 'SOXL',
          turn: '99',
        },
      },
      v2Store: {
        activeProfileId: 'profile-v2',
        profiles: [
          {
            id: 'profile-v2',
            name: 'V2',
            createdAt: now,
            updatedAt: now,
            startDate: '2026-07-01',
            form: {
              ...v1Form,
              symbol: 'TQQQ',
              turn: '3',
            },
            symbolForms: {},
            history: [],
            executions: [],
            executionAnalysisStartDate: '2026-07-01',
            executionAnalysisEndDate: '2026-07-08',
          },
        ],
      },
      v2StoreExists: true,
    })
    const profile = getActiveProfile(store)

    expect(migratedFromV1).toBe(false)
    expect(profile.name).toBe('V2')
    expect(profile.form.symbol).toBe('TQQQ')
    expect(profile.form.turn).toBe('3')
    expect(profile.executionAnalysisStartDate).toBe('2026-07-01')
  })

  it('writes a v2 profile store during v1 migration without deleting v1 keys', () => {
    const storage = createMemoryStorage({
      [STORAGE_INPUT_KEY]: JSON.stringify(v1Form),
    })

    const store = loadProfileStore(storage)
    const migratedStore = JSON.parse(
      storage.getItem(STORAGE_PROFILE_KEY) ?? '',
    ) as unknown

    expect(getActiveProfile(store).form.symbol).toBe('SOXL')
    expect(storage.getItem(STORAGE_INPUT_KEY)).toBe(JSON.stringify(v1Form))
    expect(getActiveProfile(migratedStore as ReturnType<typeof loadProfileStore>).name).toBe(
      DEFAULT_PROFILE_NAME,
    )
  })

  it('does not read v1 keys when a v2 profile store exists', () => {
    const readKeys: string[] = []
    const storage = {
      getItem(key: string) {
        readKeys.push(key)

        if (key === STORAGE_PROFILE_KEY) {
          return JSON.stringify({
            activeProfileId: 'profile-v2',
            profiles: [
              {
                id: 'profile-v2',
                name: 'V2',
                createdAt: now,
                updatedAt: now,
                startDate: '',
                form: {
                  ...v1Form,
                  symbol: 'TQQQ',
                },
                symbolForms: {},
                history: [],
                executions: [],
                executionAnalysisStartDate: '',
                executionAnalysisEndDate: '',
              },
            ],
          })
        }

        throw new Error(`unexpected v1 read: ${key}`)
      },
      setItem() {
        return
      },
    }

    const store = loadProfileStore(storage)

    expect(readKeys).toEqual([STORAGE_PROFILE_KEY])
    expect(getActiveProfile(store).form.symbol).toBe('TQQQ')
  })
})

describe('profile CRUD', () => {
  it('creates a new profile by copying active profile state and replacing metadata', () => {
    const store = createProfileStoreFromV1Sources(
      {
        executions: v1Executions,
        form: v1Form,
        history: v1History,
      },
      { id: 'profile-a', now },
    )
    const sourceProfile = getActiveProfile(store)
    const withAnalysisPeriod = {
      ...store,
      profiles: [
        {
          ...sourceProfile,
          executionAnalysisStartDate: '2026-07-01',
          executionAnalysisEndDate: '2026-07-08',
        },
      ],
    }

    const nextStore = createProfileFromActive(withAnalysisPeriod, {
      id: 'profile-b',
      name: 'SOXL 40분할',
      now: '2026-07-08T01:00:00.000Z',
      startDate: '2026-07-01',
    })
    const newProfile = getActiveProfile(nextStore)

    expect(nextStore.profiles).toHaveLength(2)
    expect(newProfile.id).toBe('profile-b')
    expect(newProfile.name).toBe('SOXL 40분할')
    expect(newProfile.startDate).toBe('2026-07-01')
    expect(newProfile.createdAt).toBe('2026-07-08T01:00:00.000Z')
    expect(newProfile.form).toEqual(sourceProfile.form)
    expect(newProfile.history).toEqual(sourceProfile.history)
    expect(newProfile.executions).toEqual(sourceProfile.executions)
    expect(newProfile.executionAnalysisStartDate).toBe('2026-07-01')
    expect(newProfile.executionAnalysisEndDate).toBe('2026-07-08')
  })

  it('keeps the last profile and switches away when deleting the active profile', () => {
    const store = createProfileStoreFromV1Sources(
      { form: v1Form },
      { id: 'profile-a', now },
    )
    const twoProfileStore = createProfileFromActive(store, {
      id: 'profile-b',
      name: 'Second',
      now,
      startDate: '',
    })

    const afterDeletingActive = deleteProfile(twoProfileStore, 'profile-b')

    expect(afterDeletingActive.profiles).toHaveLength(1)
    expect(afterDeletingActive.activeProfileId).toBe('profile-a')

    const afterDeletingLast = deleteProfile(afterDeletingActive, 'profile-a')

    expect(afterDeletingLast.profiles).toHaveLength(1)
    expect(afterDeletingLast.activeProfileId).toBe('profile-a')
  })
})

function createMemoryStorage(initialValues: Record<string, string>) {
  const values = new Map(Object.entries(initialValues))

  return {
    getItem(key: string) {
      return values.get(key) ?? null
    },
    setItem(key: string, value: string) {
      values.set(key, value)
    },
  }
}
