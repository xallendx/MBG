import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Uji POST /api/tasks/[id]/complete dengan database tiruan.
 *
 * Yang dikunci:
 * 1. Keamanan/baris kunci: hanya tugas milik user itu, dan baris dikunci dulu.
 * 2. Tugas yang belum siap ditolak.
 * 3. Log dibuat SEBELUM tugas dibaca ulang, supaya status balasan sudah benar.
 * 4. Hemat perjalanan database: satu query auth (bukan dua), dan pembacaan
 *    ulang digabung dengan update penanda notifikasi (bukan dua pernyataan).
 */

const mocks = vi.hoisted(() => ({
  requireUserWithSettings: vi.fn(),
  queryRaw: vi.fn(),
  taskFindFirst: vi.fn(),
  taskUpdate: vi.fn(),
  logCreate: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireUserWithSettings: mocks.requireUserWithSettings }))
vi.mock('@/lib/db', () => ({
  db: {
    $transaction: async (fn: (tx: unknown) => unknown) => fn({
      $queryRaw: mocks.queryRaw,
      task: { findFirst: mocks.taskFindFirst, update: mocks.taskUpdate },
      taskLog: { create: mocks.logCreate },
    }),
  },
}))

const { POST } = await import('../src/app/api/tasks/[id]/complete/route')

const ctx = { params: Promise.resolve({ id: 't1' }) }
const call = () => POST(new Request('http://localhost/api/tasks/t1/complete', { method: 'POST' }), ctx)

/** Tugas kustom: siap kalau belum ada log, cooldown setelah diselesaikan. */
const before = (over: Record<string, unknown> = {}) => ({
  id: 't1', userId: 'user-1', name: 'Follow X',
  scheduleType: 'kustom', scheduleConfig: '{"cooldownHours":5}',
  createdAt: new Date('2026-11-01T00:00:00Z'),
  logs: [] as { completedAt: Date }[],
  project: null,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireUserWithSettings.mockResolvedValue({ id: 'user-1', settings: { timezone: 'WIB' } })
  mocks.queryRaw.mockResolvedValue([{ id: 't1' }])
  mocks.taskFindFirst.mockResolvedValue(before())
  mocks.logCreate.mockResolvedValue({ id: 'log-1', completedAt: new Date() })
  mocks.taskUpdate.mockImplementation(async () => ({
    ...before(),
    logs: [{ completedAt: new Date() }],
    _count: { logs: 1 },
  }))
})

describe('POST /api/tasks/[id]/complete — akses dan status', () => {
  it('tanpa sesi valid → 401 dan tidak menyentuh database tugas', async () => {
    mocks.requireUserWithSettings.mockResolvedValue(null)
    const res = await call()
    expect(res.status).toBe(401)
    expect(mocks.queryRaw).not.toHaveBeenCalled()
    expect(mocks.logCreate).not.toHaveBeenCalled()
  })

  it('tugas bukan milik user ini → 404, tanpa log dibuat', async () => {
    mocks.queryRaw.mockResolvedValue([])
    const res = await call()
    expect(res.status).toBe(404)
    expect(mocks.logCreate).not.toHaveBeenCalled()
  })

  it('tugas yang masih cooldown ditolak 400', async () => {
    mocks.taskFindFirst.mockResolvedValue(before({ logs: [{ completedAt: new Date() }] }))
    const res = await call()
    expect(res.status).toBe(400)
    expect(mocks.logCreate).not.toHaveBeenCalled()
    expect(mocks.taskUpdate).not.toHaveBeenCalled()
  })

  it('baris dikunci dengan FOR UPDATE sebelum log dibaca', async () => {
    await call()
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1)
    const sql = (mocks.queryRaw.mock.calls[0][0] as string[]).join('?')
    expect(sql).toContain('FOR UPDATE')
    expect(sql).toContain('userId')
  })
})

describe('POST /api/tasks/[id]/complete — hasil dan urutan penulisan', () => {
  it('mengembalikan logId dan status cooldown beserta sisa jeda', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.logId).toBe('log-1')
    expect(body.task.status).toBe('cooldown')
    expect(body.task.logCount).toBe(1)
    expect(body.task.cooldownMs).toBeGreaterThan(4 * 3600_000)
    expect(body.task.cooldownRemaining).toMatch(/j/)
  })

  it('log dibuat sebelum tugas dibaca ulang (status tidak basi)', async () => {
    const urutan: string[] = []
    mocks.logCreate.mockImplementation(async () => { urutan.push('log'); return { id: 'log-1' } })
    mocks.taskUpdate.mockImplementation(async () => {
      urutan.push('update+read')
      return { ...before(), logs: [{ completedAt: new Date() }], _count: { logs: 1 } }
    })
    await call()
    expect(urutan).toEqual(['log', 'update+read'])
  })

  it('penanda notifikasi di-reset pada penyelesaian', async () => {
    await call()
    expect(mocks.taskUpdate.mock.calls[0][0].data).toEqual({ notifiedWarnAt: null, notifiedReadyAt: null })
  })

  it('tugas sekali menjadi selesai, bukan cooldown', async () => {
    mocks.taskFindFirst.mockResolvedValue(before({ scheduleType: 'sekali', scheduleConfig: '{}' }))
    mocks.taskUpdate.mockResolvedValue({ ...before({ scheduleType: 'sekali', scheduleConfig: '{}' }), logs: [{ completedAt: new Date() }], _count: { logs: 1 } })
    const body = await (await call()).json()
    expect(body.task.status).toBe('selesai')
    expect(body.task.cooldownMs).toBe(0)
    expect(body.task.nextReadyAt).toBeNull()
  })
})

describe('POST /api/tasks/[id]/complete — hemat perjalanan database', () => {
  it('auth + zona waktu cukup satu panggilan', async () => {
    await call()
    expect(mocks.requireUserWithSettings).toHaveBeenCalledTimes(1)
  })

  it('pembacaan ulang digabung ke update: findFirst hanya untuk cek status awal', async () => {
    await call()
    expect(mocks.taskFindFirst).toHaveBeenCalledTimes(1)
    expect(mocks.taskUpdate).toHaveBeenCalledTimes(1)
    const arg = mocks.taskUpdate.mock.calls[0][0]
    expect(arg.include.logs).toEqual({ orderBy: { completedAt: 'desc' }, take: 1 })
    expect(arg.include._count).toEqual({ select: { logs: true } })
  })

  it('total pernyataan tulis: satu log + satu update', async () => {
    await call()
    expect(mocks.logCreate).toHaveBeenCalledTimes(1)
    expect(mocks.taskUpdate).toHaveBeenCalledTimes(1)
  })
})
