import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'

/**
 * Uji POST /api/tasks dengan database tiruan.
 *
 * Yang dikunci: retry dengan clientRequestId yang sama tidak menggandakan tugas,
 * pemulihan P2002 terjadi di luar transaksi dan tetap terikat kepemilikan user,
 * isi berbeda dengan kunci sama ditolak (bukan menimpa), dan klien lama tanpa
 * kunci tetap berjalan seperti sebelumnya. Tidak ada migration/skema baru.
 */

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  transaction: vi.fn(),
  taskFindFirst: vi.fn(),
  taskCreate: vi.fn(),
  taskFindFirstTx: vi.fn(),
  projectFindFirstTx: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }))
vi.mock('@/lib/db', () => ({
  db: {
    $transaction: mocks.transaction,
    task: { findFirst: mocks.taskFindFirst },
  },
}))

const { POST } = await import('../src/app/api/tasks/route')
const { taskRequestId } = await import('../src/lib/task-create-request')

const KEY = '11111111-1111-4111-8111-111111111111'
const USER = 'user-1'

function req(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`id`)', {
    code: 'P2002',
    clientVersion: '6.19.3',
    meta: { target: ['id'] },
  })
}

const baseBody = {
  name: 'Klaim faucet',
  scheduleType: 'jam_tertentu',
  scheduleConfig: { times: ['09:00', '21:00'] },
  projectId: 'proj-a',
  priority: 'high',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireUser.mockResolvedValue(USER)
  mocks.projectFindFirstTx.mockResolvedValue({ id: 'proj-a', userId: USER })
  mocks.taskFindFirstTx.mockResolvedValue({ position: 4 })
  mocks.taskCreate.mockImplementation(async ({ data }) => ({
    ...data,
    createdAt: new Date('2026-11-08T00:00:00Z'),
    updatedAt: new Date('2026-11-08T00:00:00Z'),
    project: data.projectId ? { id: data.projectId, name: 'Proyek A', color: '#000080', userId: USER } : null,
  }))
  mocks.taskFindFirst.mockResolvedValue(null)
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({
    task: { findFirst: mocks.taskFindFirstTx, create: mocks.taskCreate },
    project: { findFirst: mocks.projectFindFirstTx },
  }))
})

describe('POST /api/tasks — kompatibilitas & validasi', () => {
  it('klien lama tanpa clientRequestId tetap dibuat dengan id otomatis', async () => {
    const res = await POST(req({ name: 'Tugas lama' }))
    expect(res.status).toBe(201)
    const data = mocks.taskCreate.mock.calls[0][0].data
    expect(data.id).toBeUndefined()
    expect(data.userId).toBe(USER)
    expect(data.position).toBe(5)
  })

  it('clientRequestId bukan UUID ditolak sebelum menulis', async () => {
    const res = await POST(req({ ...baseBody, clientRequestId: 'bukan-uuid' }))
    expect(res.status).toBe(400)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('jadwal tidak valid ditolak sebelum menulis', async () => {
    const res = await POST(req({ name: 'A', scheduleType: 'jam_tertentu', scheduleConfig: { times: ['99:99'] }, clientRequestId: KEY }))
    expect(res.status).toBe(400)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('project milik user lain ditolak dan tidak membuat task', async () => {
    mocks.projectFindFirstTx.mockResolvedValue(null)
    const res = await POST(req({ ...baseBody, clientRequestId: KEY }))
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ code: 'PROJECT_NOT_FOUND' })
    expect(mocks.taskCreate).not.toHaveBeenCalled()
    expect(mocks.projectFindFirstTx).toHaveBeenCalledWith({ where: { id: 'proj-a', userId: USER } })
  })

  it('tanpa sesi tidak menyentuh database', async () => {
    mocks.requireUser.mockResolvedValue(null)
    const res = await POST(req({ ...baseBody, clientRequestId: KEY }))
    expect(res.status).toBe(401)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})

describe('POST /api/tasks — idempotensi', () => {
  it('request baru memakai id deterministik terikat user dan posisi terakhir + 1', async () => {
    const res = await POST(req({ ...baseBody, clientRequestId: KEY }))
    expect(res.status).toBe(201)
    const data = mocks.taskCreate.mock.calls[0][0].data
    expect(data.id).toBe(taskRequestId(USER, KEY))
    expect(data.position).toBe(5)
    expect(data.scheduleConfig).toBe(JSON.stringify(baseBody.scheduleConfig))
    await expect(res.json()).resolves.toMatchObject({ id: taskRequestId(USER, KEY), name: 'Klaim faucet' })
  })

  it('retry setelah respons hilang mengembalikan task yang sama (200), bukan duplikat', async () => {
    const id = taskRequestId(USER, KEY)
    const existing = {
      id, userId: USER, name: baseBody.name, description: null, link: null, notes: null,
      scheduleType: baseBody.scheduleType, scheduleConfig: JSON.stringify(baseBody.scheduleConfig),
      projectId: 'proj-a', pinned: false, priority: 'high', position: 5,
      project: { id: 'proj-a', name: 'Proyek A', color: '#000080', userId: USER },
    }
    mocks.taskCreate.mockRejectedValueOnce(p2002())
    mocks.taskFindFirst.mockResolvedValue(existing)

    const res = await POST(req({ ...baseBody, clientRequestId: KEY }))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ id })
    // Pemulihan memakai db.task di luar transaksi yang sudah abort.
    expect(mocks.taskFindFirst).toHaveBeenCalledWith({ where: { id, userId: USER }, include: { project: true } })
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
  })

  it('kunci sama dengan isi berbeda ditolak 409 dan tidak menimpa task lama', async () => {
    mocks.taskCreate.mockRejectedValueOnce(p2002())
    mocks.taskFindFirst.mockResolvedValue({
      id: taskRequestId(USER, KEY), userId: USER, name: 'Nama lama', description: null, link: null, notes: null,
      scheduleType: baseBody.scheduleType, scheduleConfig: JSON.stringify(baseBody.scheduleConfig),
      projectId: 'proj-a', pinned: false, priority: 'high', project: null,
    })
    const res = await POST(req({ ...baseBody, name: 'Nama baru', clientRequestId: KEY }))
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ code: 'REQUEST_PAYLOAD_CONFLICT' })
    expect(mocks.taskCreate).toHaveBeenCalledTimes(1)
  })

  it('id bentrok milik user lain tidak bocor dan tidak dianggap sukses', async () => {
    mocks.taskCreate.mockRejectedValueOnce(p2002())
    // Query pemulihan terikat userId; task user lain tidak pernah dikembalikan.
    mocks.taskFindFirst.mockResolvedValue(null)
    const res = await POST(req({ ...baseBody, clientRequestId: KEY }))
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ code: 'REQUEST_ID_CONFLICT' })
    expect(mocks.taskFindFirst).toHaveBeenCalledWith({ where: { id: taskRequestId(USER, KEY), userId: USER }, include: { project: true } })
  })

  it('dua request bersamaan dengan kunci sama hanya menghasilkan satu task', async () => {
    const store = new Map<string, Record<string, unknown>>()
    mocks.taskCreate.mockImplementation(async ({ data }) => {
      if (data.id && store.has(data.id)) throw p2002()
      const row = { ...data, project: null }
      if (data.id) store.set(data.id, row)
      return row
    })
    mocks.taskFindFirst.mockImplementation(async ({ where }) => {
      const row = store.get(where.id)
      return row && row.userId === where.userId ? row : null
    })

    const [a, b] = await Promise.all([
      POST(req({ ...baseBody, clientRequestId: KEY })),
      POST(req({ ...baseBody, clientRequestId: KEY })),
    ])
    expect([a.status, b.status].sort()).toEqual([200, 201])
    expect(store.size).toBe(1)
    const ja = await a.json()
    const jb = await b.json()
    expect(ja.id).toBe(jb.id)
  })

  it('P2002 tanpa clientRequestId tidak mencoba pemulihan idempoten', async () => {
    mocks.taskCreate.mockRejectedValueOnce(p2002())
    const res = await POST(req({ name: 'Tugas lama' }))
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ code: 'DUPLICATE' })
    expect(mocks.taskFindFirst).not.toHaveBeenCalled()
  })

  it('error database lain tetap menjadi kegagalan, bukan sukses palsu', async () => {
    mocks.taskCreate.mockRejectedValueOnce(new Error('koneksi putus'))
    const res = await POST(req({ ...baseBody, clientRequestId: KEY }))
    expect(res.status).toBe(500)
    expect(mocks.taskFindFirst).not.toHaveBeenCalled()
  })
})
