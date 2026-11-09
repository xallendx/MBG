import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Uji PUT /api/tasks/[id] dengan database tiruan.
 *
 * Yang dikunci: penanda notifikasi hanya di-reset kalau jadwalnya benar-benar
 * berubah. Form edit di browser selalu mengirim scheduleType + scheduleConfig,
 * jadi memakai "ada key-nya" membuat ganti nama mengirim ulang pengingat
 * "Task siap!" untuk kejadian yang sama.
 */

const mocks = vi.hoisted(() => ({
  requireUserId: vi.fn(),
  taskFindFirst: vi.fn(),
  taskUpdate: vi.fn(),
  projectFindFirst: vi.fn(),
}))

vi.mock('@/lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, requireUserId: mocks.requireUserId }
})
vi.mock('@/lib/db', () => ({
  db: {
    task: { findFirst: mocks.taskFindFirst, update: mocks.taskUpdate },
    project: { findFirst: mocks.projectFindFirst },
  },
}))

const { PUT } = await import('../src/app/api/tasks/[id]/route')

const existing = {
  id: 't1',
  userId: 'user-1',
  name: 'Klaim faucet',
  scheduleType: 'jam_tertentu',
  scheduleConfig: '{"times":["09:00"]}',
  notifiedWarnAt: new Date('2026-11-09T08:55:00Z'),
  notifiedReadyAt: new Date('2026-11-09T09:00:00Z'),
}

function req(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/tasks/t1', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const params = { params: Promise.resolve({ id: 't1' }) }
const lastUpdate = () => mocks.taskUpdate.mock.calls.at(-1)?.[0]?.data as Record<string, unknown>

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireUserId.mockResolvedValue('user-1')
  mocks.taskFindFirst.mockResolvedValue({ ...existing })
  mocks.taskUpdate.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...existing, ...args.data }))
})

describe('PUT /api/tasks/[id] — penanda notifikasi', () => {
  it('ganti nama dengan jadwal identik TIDAK mereset penanda notifikasi', async () => {
    const res = await PUT(req({
      name: 'Klaim faucet pagi',
      scheduleType: 'jam_tertentu',
      scheduleConfig: { times: ['09:00'] },
      priority: 'high',
    }), params)
    expect(res.status).toBe(200)
    const data = lastUpdate()
    expect(data.name).toBe('Klaim faucet pagi')
    expect('notifiedWarnAt' in data).toBe(false)
    expect('notifiedReadyAt' in data).toBe(false)
  })

  it('urutan key config berbeda juga tidak dianggap perubahan jadwal', async () => {
    mocks.taskFindFirst.mockResolvedValue({ ...existing, scheduleType: 'mingguan', scheduleConfig: '{"dayOfWeek":1,"cooldownHours":168}' })
    await PUT(req({ name: 'Galxe', scheduleType: 'mingguan', scheduleConfig: { cooldownHours: 168, dayOfWeek: 1 } }), params)
    expect('notifiedReadyAt' in lastUpdate()).toBe(false)
  })

  it('jam diubah → penanda di-reset supaya siklus baru mengirim pengingat', async () => {
    const res = await PUT(req({ scheduleType: 'jam_tertentu', scheduleConfig: { times: ['10:00'] } }), params)
    expect(res.status).toBe(200)
    const data = lastUpdate()
    expect(data.notifiedWarnAt).toBeNull()
    expect(data.notifiedReadyAt).toBeNull()
  })

  it('tipe jadwal diubah → penanda di-reset', async () => {
    await PUT(req({ scheduleType: 'kustom', scheduleConfig: { cooldownHours: 12 } }), params)
    expect(lastUpdate().notifiedReadyAt).toBeNull()
  })

  it('simpan catatan saja tidak menyentuh penanda notifikasi', async () => {
    await PUT(req({ notes: 'sudah klaim manual' }), params)
    const data = lastUpdate()
    expect(data.notes).toBe('sudah klaim manual')
    expect('notifiedReadyAt' in data).toBe(false)
  })

  it('jadwal tidak valid tetap ditolak', async () => {
    const res = await PUT(req({ scheduleType: 'jam_tertentu', scheduleConfig: { times: ['99:99'] } }), params)
    expect(res.status).toBe(400)
    expect(mocks.taskUpdate).not.toHaveBeenCalled()
  })
})
