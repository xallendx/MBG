import { describe, expect, it } from 'vitest'
import {
  SETTINGS_DEFAULTS,
  getTimezone,
  mergeSettings,
  parseSettings,
  resolveSettings,
} from '../src/lib/settings'

/**
 * Test pembacaan `User.settings`.
 *
 * Sebelum modul ini ada, setiap route melakukan `JSON.parse(user.settings)`
 * sendiri lalu cast `settings.timezone as string`. Nilai lama yang tidak valid
 * (mis. `"Asia/Jakarta"` dari versi awal) langsung dipakai untuk menghitung
 * jadwal → task muncul di jam yang salah tanpa error apa pun.
 */

describe('parseSettings', () => {
  it('null / string kosong → objek kosong', () => {
    expect(parseSettings(null)).toEqual({})
    expect(parseSettings(undefined)).toEqual({})
    expect(parseSettings('')).toEqual({})
  })

  it('JSON valid diparse apa adanya', () => {
    expect(parseSettings('{"timezone":"WITA","pomodoroDuration":30}')).toEqual({
      timezone: 'WITA',
      pomodoroDuration: 30,
    })
  })

  it('JSON rusak tidak melempar error', () => {
    expect(parseSettings('{bukan json')).toEqual({})
    expect(parseSettings('null')).toEqual({})
    expect(parseSettings('[1,2,3]')).toEqual({})
  })
})

describe('resolveSettings', () => {
  it('settings kosong → semua default terisi', () => {
    const s = resolveSettings(null)
    expect(s.timezone).toBe('WIB')
    expect(s.timeFormat).toBe('24')
    expect(s.notifyBeforeCooldownMin).toBe(5)
    expect(s.autoExpandSiap).toBe(SETTINGS_DEFAULTS.autoExpandSiap)
  })

  it('nilai tidak valid diganti default, bukan dipakai apa adanya', () => {
    const s = resolveSettings(
      JSON.stringify({ timezone: 'Asia/Jakarta', notifyBeforeCooldownMin: '5', timeFormat: '25' })
    )
    expect(s.timezone).toBe('WIB')
    expect(s.notifyBeforeCooldownMin).toBe(5)
    expect(s.timeFormat).toBe('24')
  })

  it('nilai di luar rentang juga jatuh ke default', () => {
    const s = resolveSettings(JSON.stringify({ pomodoroDuration: 500 }))
    expect(s.pomodoroDuration).toBe(SETTINGS_DEFAULTS.pomodoroDuration)
  })

  it('nilai valid dipertahankan', () => {
    const s = resolveSettings(JSON.stringify({ timezone: 'WIT', notifyBeforeCooldownMin: 15 }))
    expect(s.timezone).toBe('WIT')
    expect(s.notifyBeforeCooldownMin).toBe(15)
  })

  it('key lama yang tidak dikenal tidak menghilang', () => {
    const s = resolveSettings(JSON.stringify({ legacyFlag: true, timezone: 'WITA' }))
    expect(s.legacyFlag).toBe(true)
    expect(s.timezone).toBe('WITA')
  })

  it('telegramChatId null tetap null (artinya terputus)', () => {
    const s = resolveSettings(JSON.stringify({ telegramChatId: null }))
    expect(s.telegramChatId).toBeNull()
  })

  it('JSON rusak → default lengkap, tidak melempar', () => {
    const s = resolveSettings('{rusak')
    expect(s.timezone).toBe('WIB')
  })
})

describe('getTimezone', () => {
  it('mengembalikan timezone valid', () => {
    expect(getTimezone(JSON.stringify({ timezone: 'WITA' }))).toBe('WITA')
  })

  it('nilai asing → WIB', () => {
    expect(getTimezone(JSON.stringify({ timezone: 'UTC' }))).toBe('WIB')
    expect(getTimezone(JSON.stringify({ timezone: 42 }))).toBe('WIB')
    expect(getTimezone(null)).toBe('WIB')
  })
})

describe('mergeSettings', () => {
  it('hanya mengubah key yang dikirim', () => {
    const merged = mergeSettings(
      { timezone: 'WIB', pomodoroDuration: 25 },
      { timezone: 'WITA' }
    )
    expect(merged).toEqual({ timezone: 'WITA', pomodoroDuration: 25 })
  })

  it('key asing dari patch diabaikan', () => {
    const merged = mergeSettings({ timezone: 'WIB' }, { tema: 'gelap' } as Record<string, unknown>)
    expect(merged).toEqual({ timezone: 'WIB' })
  })

  it('key asing yang sudah tersimpan tetap dipertahankan', () => {
    const merged = mergeSettings({ legacyFlag: 1, timezone: 'WIB' }, { timezone: 'WIT' })
    expect(merged).toEqual({ legacyFlag: 1, timezone: 'WIT' })
  })
})
