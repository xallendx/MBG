import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  userFindUnique: vi.fn(),
  userCount: vi.fn(),
  userUpdate: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('@/lib/db', () => ({
  db: {
    $transaction: mocks.transaction,
  },
}))

const { PUT } = await import('../src/app/api/admin/users/[id]/route')

const admin = { id: 'admin-1', role: 'ADMIN', isBlocked: false }
const target = { id: 'admin-2', username: 'admin2', displayName: null, role: 'ADMIN', isBlocked: false }
const tx = {
  $queryRaw: mocks.queryRaw,
  user: {
    findUnique: mocks.userFindUnique,
    count: mocks.userCount,
    update: mocks.userUpdate,
  },
}

function request(id: string, body: Record<string, unknown>) {
  return new Request(`http://localhost/api/admin/users/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function put(body: Record<string, unknown>, id = 'admin-2') {
  return PUT(request(id, body), { params: Promise.resolve({ id }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAdmin.mockResolvedValue({ error: null, user: admin })
  mocks.userFindUnique.mockResolvedValue({ ...target })
  mocks.userCount.mockResolvedValue(2)
  mocks.userUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...target, ...data }))
  mocks.queryRaw.mockResolvedValue([])
  mocks.transaction.mockImplementation(async (callback: (txArg: typeof tx) => unknown) => callback(tx))
})

describe('PUT /api/admin/users/[id] — lindungi admin aktif terakhir', () => {
  it('demote admin aktif terakhir ditolak di dalam transaksi terkunci', async () => {
    mocks.userCount.mockResolvedValue(1)
    const response = await put({ role: 'USER' })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('admin aktif terakhir')
    expect(mocks.transaction).toHaveBeenCalledOnce()
    expect(mocks.queryRaw).toHaveBeenCalledOnce()
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })

  it('memblokir admin aktif terakhir juga ditolak', async () => {
    mocks.userCount.mockResolvedValue(1)
    const response = await put({ isBlocked: true })
    expect(response.status).toBe(400)
    expect(mocks.queryRaw).toHaveBeenCalledOnce()
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })

  it('demote diizinkan bila masih ada admin aktif lain', async () => {
    const response = await put({ role: 'USER' })
    expect(response.status).toBe(200)
    expect(mocks.queryRaw).toHaveBeenCalledOnce()
    expect(mocks.userUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { role: 'USER' } }))
  })

  it('block admin diizinkan bila masih ada admin aktif lain', async () => {
    const response = await put({ isBlocked: true })
    expect(response.status).toBe(200)
    expect(mocks.queryRaw).toHaveBeenCalledOnce()
    expect(mocks.userUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { isBlocked: true } }))
  })

  it('request yang menunggu lock mengecek ulang jumlah admin sesudah lock', async () => {
    // Pemeriksaan pertama mengembalikan target admin aktif. Setelah lock target
    // tetap admin, tetapi hitungan terakhir menunjukkan hanya satu yang tersisa.
    mocks.userFindUnique.mockResolvedValueOnce({ ...target }).mockResolvedValueOnce({ ...target })
    mocks.userCount.mockResolvedValue(1)
    const response = await put({ role: 'USER' })
    expect(response.status).toBe(400)
    expect(mocks.userFindUnique).toHaveBeenCalledTimes(2)
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })

  it('tetap melindungi admin dari blokir/demote dirinya sendiri', async () => {
    expect((await put({ isBlocked: true }, admin.id)).status).toBe(400)
    expect((await put({ role: 'USER' }, admin.id)).status).toBe(400)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('user target yang tidak ada menghasilkan 404 tanpa update', async () => {
    mocks.userFindUnique.mockResolvedValue(null)
    const response = await put({ isBlocked: true })
    expect(response.status).toBe(404)
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })
})
