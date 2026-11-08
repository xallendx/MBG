import { describe, expect, it } from 'vitest'
import {
  loginSchema,
  registerSchema,
  settingsUpdateSchema,
  taskCreateSchema,
  taskUpdateSchema,
  projectCreateSchema,
  templateCreateSchema,
  pushSubscribeSchema,
} from '../src/lib/schemas'

/**
 * Test lapisan validasi.
 *
 * Alasan ada test ini: dulu API memakai `req.json()` + pengecekan manual yang
 * tidak konsisten — sebagian endpoint menerima `notifyBeforeCooldownMin: "5"`
 * lalu diam-diam membuangnya, sebagian lagi menyimpan apa saja. Test di bawah
 * mengunci perilaku baru: nilai salah ditolak dengan pesan berbahasa Indonesia,
 * key asing ditolak, dan default yang aman tetap terisi.
 */

describe('loginSchema', () => {
  it('menerima kredensial normal', () => {
    const r = loginSchema.safeParse({ username: 'admin1', password: 'admin123' })
    expect(r.success).toBe(true)
  })

  it('menolak body kosong', () => {
    const r = loginSchema.safeParse({})
    expect(r.success).toBe(false)
  })

  it('memangkas spasi di username', () => {
    const r = loginSchema.safeParse({ username: '  admin1  ', password: 'x' })
    expect(r.success && r.data.username).toBe('admin1')
  })

  it('menolak password sangat panjang', () => {
    const r = loginSchema.safeParse({ username: 'a', password: 'x'.repeat(129) })
    expect(r.success).toBe(false)
  })
})

describe('registerSchema', () => {
  it('menolak username dengan karakter aneh', () => {
    const r = registerSchema.safeParse({ username: 'bad name!', password: 'rahasia1' })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0].message).toContain('underscore')
  })

  it('menolak password pendek', () => {
    const r = registerSchema.safeParse({ username: 'budi', password: '123' })
    expect(r.success).toBe(false)
  })

  it('mengubah displayName kosong menjadi null', () => {
    const r = registerSchema.safeParse({ username: 'budi', password: 'rahasia1', displayName: '   ' })
    expect(r.success && r.data.displayName).toBeNull()
  })
})

describe('taskCreateSchema', () => {
  it('mengisi default untuk field opsional', () => {
    const r = taskCreateSchema.safeParse({ name: 'Klaim faucet' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.scheduleType).toBe('sekali')
      expect(r.data.priority).toBe('medium')
      expect(r.data.pinned).toBe(false)
      expect(r.data.scheduleConfig).toEqual({})
    }
  })

  it('menolak nama kosong', () => {
    const r = taskCreateSchema.safeParse({ name: '   ' })
    expect(r.success).toBe(false)
  })

  it('menolak scheduleType yang tidak dikenal', () => {
    const r = taskCreateSchema.safeParse({ name: 'A', scheduleType: 'tiap-menit' })
    expect(r.success).toBe(false)
  })

  it('menerima scheduleConfig berupa string JSON', () => {
    const r = taskCreateSchema.safeParse({ name: 'A', scheduleConfig: '{"hour":9,"minute":0}' })
    expect(r.success && r.data.scheduleConfig).toEqual({ hour: 9, minute: 0 })
  })

  it('mengubah string JSON rusak menjadi objek kosong', () => {
    const r = taskCreateSchema.safeParse({ name: 'A', scheduleConfig: '{bukan json' })
    expect(r.success && r.data.scheduleConfig).toEqual({})
  })

  it('menolak nama lebih dari 200 karakter', () => {
    const r = taskCreateSchema.safeParse({ name: 'x'.repeat(201) })
    expect(r.success).toBe(false)
  })
})

describe('taskUpdateSchema', () => {
  it('mengizinkan patch sebagian', () => {
    const r = taskUpdateSchema.safeParse({ pinned: true })
    expect(r.success).toBe(true)
  })

  it('menolak posisi negatif', () => {
    const r = taskUpdateSchema.safeParse({ position: -1 })
    expect(r.success).toBe(false)
  })
})

describe('projectCreateSchema', () => {
  it('menerima warna hex valid', () => {
    const r = projectCreateSchema.safeParse({ name: 'Testnet', color: '#000080' })
    expect(r.success).toBe(true)
  })

  it('menolak warna bukan hex', () => {
    const r = projectCreateSchema.safeParse({ name: 'Testnet', color: 'red' })
    expect(r.success).toBe(false)
  })
})

describe('templateCreateSchema', () => {
  it('menerima template minimal', () => {
    const r = templateCreateSchema.safeParse({ name: 'Harian' })
    expect(r.success && r.data.priority).toBe('medium')
  })
})

describe('settingsUpdateSchema', () => {
  it('menerima pengaturan valid', () => {
    const r = settingsUpdateSchema.safeParse({
      timezone: 'WITA',
      timeFormat: '24',
      notifyBeforeCooldownMin: 5,
    })
    expect(r.success).toBe(true)
  })

  it('menolak nilai bertipe salah (dulu hilang diam-diam)', () => {
    const r = settingsUpdateSchema.safeParse({ notifyBeforeCooldownMin: '5' })
    expect(r.success).toBe(false)
  })

  it('menolak timezone di luar WIB/WITA/WIT', () => {
    const r = settingsUpdateSchema.safeParse({ timezone: 'UTC' })
    expect(r.success).toBe(false)
  })

  it('menolak key yang tidak dikenal', () => {
    const r = settingsUpdateSchema.safeParse({ tema: 'gelap' })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues.some(i => i.message.includes('tidak dikenal'))).toBe(true)
  })

  it('menolak body kosong', () => {
    const r = settingsUpdateSchema.safeParse({})
    expect(r.success).toBe(false)
  })

  it('mengizinkan null untuk memutus Telegram', () => {
    const r = settingsUpdateSchema.safeParse({ telegramChatId: null, telegramName: null })
    expect(r.success).toBe(true)
  })

  it('menolak pomodoroDuration di luar 1–120', () => {
    expect(settingsUpdateSchema.safeParse({ pomodoroDuration: 0 }).success).toBe(false)
    expect(settingsUpdateSchema.safeParse({ pomodoroDuration: 121 }).success).toBe(false)
  })
})

describe('pushSubscribeSchema', () => {
  it('menolak endpoint bukan URL', () => {
    const r = pushSubscribeSchema.safeParse({ endpoint: 'bukan-url', keys: { auth: 'a', p256dh: 'b' } })
    expect(r.success).toBe(false)
  })

  it('menerima subscription lengkap', () => {
    const r = pushSubscribeSchema.safeParse({
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys: { auth: 'auth-key', p256dh: 'p256dh-key' },
    })
    expect(r.success).toBe(true)
  })
})
