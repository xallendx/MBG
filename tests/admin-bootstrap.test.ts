import { describe, expect, it } from 'vitest'
import { readAdminBootstrapConfig } from '../src/lib/admin-bootstrap-config'

/**
 * Test konfigurasi admin pemulihan.
 *
 * Kenapa perlu: fitur ini membuat akun ADMIN langsung dari environment
 * variable, jadi kesalahan validasi di sini berakibat akun dengan username
 * aneh, password terlalu pendek, atau — paling buruk — password yang diam-diam
 * berubah karena di-trim sehingga pemiliknya tidak bisa login.
 *
 * Lapisan yang menyentuh database ada di admin-bootstrap.ts dan diuji manual
 * terhadap Postgres; di sini hanya aturan baca env yang murni.
 */

describe('readAdminBootstrapConfig — kondisi mati', () => {
  it('mati kalau env kosong sama sekali', () => {
    expect(readAdminBootstrapConfig({})).toEqual({ status: 'disabled' })
  })

  it('mati kalau keduanya string kosong (kondisi .env.example)', () => {
    expect(readAdminBootstrapConfig({ ADMIN_USERNAME: '', ADMIN_PASSWORD: '' })).toEqual({
      status: 'disabled',
    })
  })

  it('mati kalau username hanya spasi dan password kosong', () => {
    expect(readAdminBootstrapConfig({ ADMIN_USERNAME: '   ', ADMIN_PASSWORD: '' })).toEqual({
      status: 'disabled',
    })
  })
})

describe('readAdminBootstrapConfig — isi separuh ditolak', () => {
  it('menolak kalau hanya username diisi', () => {
    const r = readAdminBootstrapConfig({ ADMIN_USERNAME: 'xallen' })
    expect(r.status).toBe('invalid')
    expect(r).toHaveProperty('reason', 'ADMIN_USERNAME dan ADMIN_PASSWORD harus diisi bersamaan')
  })

  it('menolak kalau hanya password diisi', () => {
    const r = readAdminBootstrapConfig({ ADMIN_PASSWORD: 'rahasia123' })
    expect(r.status).toBe('invalid')
  })

  it('menolak kalau username cuma spasi tapi password diisi', () => {
    const r = readAdminBootstrapConfig({ ADMIN_USERNAME: '  ', ADMIN_PASSWORD: 'rahasia123' })
    expect(r.status).toBe('invalid')
  })
})

describe('readAdminBootstrapConfig — aturan username', () => {
  it('menolak username kurang dari 3 karakter', () => {
    const r = readAdminBootstrapConfig({ ADMIN_USERNAME: 'ab', ADMIN_PASSWORD: 'rahasia123' })
    expect(r).toEqual({ status: 'invalid', reason: 'ADMIN_USERNAME minimal 3 karakter' })
  })

  it('menolak username lebih dari 50 karakter', () => {
    const r = readAdminBootstrapConfig({
      ADMIN_USERNAME: 'a'.repeat(51),
      ADMIN_PASSWORD: 'rahasia123',
    })
    expect(r).toEqual({ status: 'invalid', reason: 'ADMIN_USERNAME maksimal 50 karakter' })
  })

  it.each(['ada-spasi', 'ada-tanda-', 'ada@email', 'ada.titik', 'ada/slash'])(
    'menolak username mengandung karakter terlarang: %s',
    (username) => {
      const r = readAdminBootstrapConfig({ ADMIN_USERNAME: username, ADMIN_PASSWORD: 'rahasia123' })
      expect(r).toEqual({
        status: 'invalid',
        reason: 'ADMIN_USERNAME hanya boleh huruf, angka, dan underscore',
      })
    }
  )

  it('menerima huruf, angka, dan underscore', () => {
    const r = readAdminBootstrapConfig({ ADMIN_USERNAME: 'Admin_2026', ADMIN_PASSWORD: 'rahasia123' })
    expect(r.status).toBe('ok')
  })

  it('mempertahankan huruf besar/kecil karena login bersifat case-sensitive', () => {
    const r = readAdminBootstrapConfig({ ADMIN_USERNAME: 'XAllen', ADMIN_PASSWORD: 'rahasia123' })
    expect(r).toMatchObject({ status: 'ok', username: 'XAllen' })
  })

  it('membuang spasi tidak sengaja di sekitar username', () => {
    const r = readAdminBootstrapConfig({ ADMIN_USERNAME: '  xallen  ', ADMIN_PASSWORD: 'rahasia123' })
    expect(r).toMatchObject({ status: 'ok', username: 'xallen' })
  })

  it('menerima username tepat 3 dan tepat 50 karakter', () => {
    expect(
      readAdminBootstrapConfig({ ADMIN_USERNAME: 'abc', ADMIN_PASSWORD: 'rahasia123' }).status
    ).toBe('ok')
    expect(
      readAdminBootstrapConfig({ ADMIN_USERNAME: 'a'.repeat(50), ADMIN_PASSWORD: 'rahasia123' }).status
    ).toBe('ok')
  })
})

describe('readAdminBootstrapConfig — aturan password', () => {
  it('menolak password kurang dari 6 karakter', () => {
    const r = readAdminBootstrapConfig({ ADMIN_USERNAME: 'xallen', ADMIN_PASSWORD: '12345' })
    expect(r).toEqual({ status: 'invalid', reason: 'ADMIN_PASSWORD minimal 6 karakter' })
  })

  it('menolak password lebih dari 128 karakter', () => {
    const r = readAdminBootstrapConfig({ ADMIN_USERNAME: 'xallen', ADMIN_PASSWORD: 'x'.repeat(129) })
    expect(r).toEqual({ status: 'invalid', reason: 'ADMIN_PASSWORD maksimal 128 karakter' })
  })

  it('TIDAK memotong spasi password — pemilik harus bisa login dengan yang ia ketik', () => {
    const r = readAdminBootstrapConfig({ ADMIN_USERNAME: 'xallen', ADMIN_PASSWORD: '  rahasia  ' })
    expect(r).toMatchObject({ status: 'ok', password: '  rahasia  ' })
  })

  it('menerima password tepat 6 dan tepat 128 karakter', () => {
    expect(
      readAdminBootstrapConfig({ ADMIN_USERNAME: 'xallen', ADMIN_PASSWORD: '123456' }).status
    ).toBe('ok')
    expect(
      readAdminBootstrapConfig({ ADMIN_USERNAME: 'xallen', ADMIN_PASSWORD: 'x'.repeat(128) }).status
    ).toBe('ok')
  })

  it('tidak pernah menyertakan nilai password di pesan alasan', () => {
    const secret = 'jangan-bocor-123'
    const cases = [
      { ADMIN_USERNAME: 'ab', ADMIN_PASSWORD: secret },
      { ADMIN_USERNAME: 'ada-spasi', ADMIN_PASSWORD: secret },
      { ADMIN_PASSWORD: secret },
      { ADMIN_USERNAME: 'xallen', ADMIN_PASSWORD: 'x'.repeat(129) },
    ]
    for (const env of cases) {
      const r = readAdminBootstrapConfig(env)
      expect(JSON.stringify(r)).not.toContain(secret)
    }
  })
})

describe('readAdminBootstrapConfig — izin reset password', () => {
  it('mati secara default supaya env yang lupa dihapus tidak menimpa akun aktif', () => {
    const r = readAdminBootstrapConfig({ ADMIN_USERNAME: 'xallen', ADMIN_PASSWORD: 'rahasia123' })
    expect(r).toMatchObject({ status: 'ok', allowReset: false })
  })

  it.each(['true', 'TRUE', ' true '])('aktif untuk nilai %s', (flag) => {
    const r = readAdminBootstrapConfig({
      ADMIN_USERNAME: 'xallen',
      ADMIN_PASSWORD: 'rahasia123',
      ADMIN_ALLOW_PASSWORD_RESET: flag,
    })
    expect(r).toMatchObject({ status: 'ok', allowReset: true })
  })

  it.each(['1', 'yes', 'false', '', 'on'])(
    'tetap mati untuk nilai yang bukan "true": %s',
    (flag) => {
      const r = readAdminBootstrapConfig({
        ADMIN_USERNAME: 'xallen',
        ADMIN_PASSWORD: 'rahasia123',
        ADMIN_ALLOW_PASSWORD_RESET: flag,
      })
      expect(r).toMatchObject({ status: 'ok', allowReset: false })
    }
  )
})
