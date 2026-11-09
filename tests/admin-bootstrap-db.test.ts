import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Test perilaku admin pemulihan terhadap database (ditiru).
 *
 * Yang dikunci di sini adalah janji keselamatan fitur ini:
 * - tanpa env var tidak menyentuh database sama sekali
 * - akun yang sudah ada TIDAK ditimpa kecuali diminta eksplisit
 * - password selalu masuk sebagai hash bcrypt, bukan teks asli
 * - kegagalan database tidak boleh melempar error ke jalur login
 * - dua request bersamaan tidak boleh membuat dua akun
 */

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: { user: mocks } }))

const { ensureEnvAdmin, __resetAdminBootstrapState } = await import('../src/lib/admin-bootstrap')

const VALID = { ADMIN_USERNAME: 'pemilik', ADMIN_PASSWORD: 'rahasia-kuat-123' }

beforeEach(() => {
  __resetAdminBootstrapState()
  mocks.findUnique.mockReset().mockResolvedValue(null)
  mocks.create.mockReset().mockResolvedValue({ id: 'u1' })
  mocks.update.mockReset().mockResolvedValue({ id: 'u1' })
  vi.unstubAllEnvs()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function setEnv(env: Record<string, string>) {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
}

describe('ensureEnvAdmin — tidak aktif', () => {
  it('tanpa env var: database tidak disentuh sama sekali', async () => {
    setEnv({ ADMIN_USERNAME: '', ADMIN_PASSWORD: '' })
    await ensureEnvAdmin()
    expect(mocks.findUnique).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('env tidak lengkap: ditolak tanpa menyentuh database', async () => {
    setEnv({ ADMIN_USERNAME: 'pemilik', ADMIN_PASSWORD: '' })
    await expect(ensureEnvAdmin()).resolves.toBeUndefined()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('password terlalu pendek: tidak membuat akun lemah', async () => {
    setEnv({ ADMIN_USERNAME: 'pemilik', ADMIN_PASSWORD: '12345' })
    await ensureEnvAdmin()
    expect(mocks.create).not.toHaveBeenCalled()
  })
})

describe('ensureEnvAdmin — membuat admin baru', () => {
  it('membuat akun dengan role ADMIN saat username belum ada', async () => {
    setEnv(VALID)
    await ensureEnvAdmin()

    expect(mocks.create).toHaveBeenCalledTimes(1)
    const data = mocks.create.mock.calls[0][0].data
    expect(data.username).toBe('pemilik')
    expect(data.role).toBe('ADMIN')
    expect(data.displayName).toBe('pemilik')
  })

  it('menyimpan hash bcrypt, bukan password asli', async () => {
    setEnv(VALID)
    await ensureEnvAdmin()

    const data = mocks.create.mock.calls[0][0].data
    expect(data.passwordHash).toMatch(/^\$2[aby]\$/)
    expect(data.passwordHash).not.toBe(VALID.ADMIN_PASSWORD)
    expect(JSON.stringify(mocks.create.mock.calls)).not.toContain(VALID.ADMIN_PASSWORD)
  })

  it('hanya berjalan sekali per proses walau dipanggil berulang', async () => {
    setEnv(VALID)
    await ensureEnvAdmin()
    await ensureEnvAdmin()
    await ensureEnvAdmin()
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.findUnique).toHaveBeenCalledTimes(1)
  })

  it('dua panggilan bersamaan tetap menghasilkan satu akun', async () => {
    setEnv(VALID)
    await Promise.all([ensureEnvAdmin(), ensureEnvAdmin()])
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })
})

describe('ensureEnvAdmin — akun yang sudah ada', () => {
  it('tidak menimpa password akun ADMIN yang sudah ada', async () => {
    mocks.findUnique.mockResolvedValue({ id: 'ada', role: 'ADMIN' })
    setEnv(VALID)
    await ensureEnvAdmin()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('tidak menaikkan role akun USER biasa secara diam-diam', async () => {
    mocks.findUnique.mockResolvedValue({ id: 'ada', role: 'USER' })
    setEnv(VALID)
    await ensureEnvAdmin()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('mereset password + role + blokir hanya kalau diizinkan eksplisit', async () => {
    mocks.findUnique.mockResolvedValue({ id: 'ada', role: 'USER' })
    setEnv({ ...VALID, ADMIN_ALLOW_PASSWORD_RESET: 'true' })
    await ensureEnvAdmin()

    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.update).toHaveBeenCalledTimes(1)
    const arg = mocks.update.mock.calls[0][0]
    expect(arg.where).toEqual({ id: 'ada' })
    expect(arg.data.role).toBe('ADMIN')
    expect(arg.data.isBlocked).toBe(false)
    expect(arg.data.passwordHash).toMatch(/^\$2[aby]\$/)
  })
})

describe('ensureEnvAdmin — kegagalan database', () => {
  it('unique constraint (balapan antar instance) ditelan, tidak melempar', async () => {
    mocks.create.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }))
    setEnv(VALID)
    await expect(ensureEnvAdmin()).resolves.toBeUndefined()
  })

  it('error lain tidak menggagalkan login dan dicoba lagi di request berikut', async () => {
    mocks.create.mockRejectedValueOnce(new Error('koneksi putus'))
    setEnv(VALID)

    await expect(ensureEnvAdmin()).resolves.toBeUndefined()
    // Belum selesai → percobaan berikutnya mencoba lagi dan kali ini berhasil.
    await expect(ensureEnvAdmin()).resolves.toBeUndefined()
    expect(mocks.create).toHaveBeenCalledTimes(2)
  })

  it('tidak menuliskan password maupun hash ke log', async () => {
    vi.stubEnv('LEVEL_LOG', 'debug')
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    // Pesan Prisma asli bisa memuat argumen invokasi di baris-baris berikutnya.
    mocks.create.mockRejectedValue(
      new Error('Invalid `prisma.user.create()` invocation\nargs: { passwordHash: "SENSITIVE_HASH" }')
    )
    setEnv(VALID)
    await ensureEnvAdmin()

    const semua = [err, warn, log].flatMap((s) => s.mock.calls.flat()).join(' ')
    expect(semua).not.toContain(VALID.ADMIN_PASSWORD)
    expect(semua).not.toContain('SENSITIVE_HASH')
  })
})
