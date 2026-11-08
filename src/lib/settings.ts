/**
 * Satu pintu untuk membaca kolom `User.settings` (JSON string).
 *
 * Sebelumnya setiap pemakai melakukan `JSON.parse(user.settings)` sendiri lalu
 * melakukan cast `settings.timezone as string`. Kalau isinya rusak atau berisi
 * nilai lama yang tidak valid (mis. `"Asia/Jakarta"` alih-alih `"WIB"`), nilai
 * itu langsung masuk ke perhitungan jadwal (`getNextReadyAt`) tanpa pemeriksaan:
 * task bisa muncul di jam yang salah, atau bahkan error saat runtime.
 *
 * Modul ini menjamin:
 *   1. JSON rusak tidak pernah melempar error (dikembalikan sebagai `{}` + log).
 *   2. Nilai yang tidak valid jatuh ke default yang aman, bukan dipakai apa adanya.
 *   3. Key yang tidak dikenal tetap disimpan (tidak merusak data lama saat merge).
 */
import { settingsSchema, type SettingsKey } from '@/lib/schemas'
import { logWarn } from '@/lib/logger'

export const TIMEZONES = ['WIB', 'WITA', 'WIT'] as const
export type Timezone = (typeof TIMEZONES)[number]

/** Default yang dipakai kalau kolom settings kosong / nilainya tidak valid. */
export const SETTINGS_DEFAULTS = {
  timezone: 'WIB' as Timezone,
  timeFormat: '24' as '12' | '24',
  autoExpandSiap: true,
  autoCompleteLink: false,
  telegramNotifEnabled: true,
  browserNotifEnabled: true,
  audioAlertEnabled: true,
  notifyBeforeCooldownMin: 5,
  pomodoroDuration: 25,
} satisfies Partial<Record<SettingsKey, unknown>>

export type RawSettings = Record<string, unknown>

/**
 * Parse kolom settings apa adanya. Tidak pernah melempar; JSON rusak → `{}`.
 * `ctx` hanya untuk log supaya bisa dilacak route mana yang menemukan data rusak.
 */
export function parseSettings(raw: string | null | undefined, ctx?: string): RawSettings {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as RawSettings)
      : {}
  } catch {
    logWarn(ctx ?? 'settings', 'kolom settings berisi JSON tidak valid, dianggap kosong')
    return {}
  }
}

/**
 * Nilai settings yang sudah tervalidasi + default untuk semua field penting.
 * Field yang invalid dibuang, lalu diisi default — jadi pemakai dijamin selalu
 * mendapat timezone yang sah.
 */
export function resolveSettings(
  raw: string | null | undefined,
  ctx?: string
): Record<SettingsKey, unknown> & RawSettings {
  const object = parseSettings(raw, ctx)
  const resolved: Record<string, unknown> = { ...SETTINGS_DEFAULTS, ...object }

  for (const [key, field] of Object.entries(settingsSchema.shape)) {
    const result = field.safeParse(resolved[key])
    if (result.success) {
      resolved[key] = result.data
      continue
    }
    // Nilai tidak valid → kembali ke default (kalau ada) atau dibuang.
    if (key in SETTINGS_DEFAULTS) {
      resolved[key] = (SETTINGS_DEFAULTS as Record<string, unknown>)[key]
      logWarn(ctx ?? 'settings', `nilai "${key}" tidak valid, memakai default`, {
        received: typeof resolved[key],
      })
    } else {
      delete resolved[key]
    }
  }

  return resolved as Record<SettingsKey, unknown> & RawSettings
}

/** Timezone yang dijamin valid — dipakai perhitungan jadwal & notifikasi. */
export function getTimezone(raw: string | null | undefined, ctx?: string): Timezone {
  const value = resolveSettings(raw, ctx).timezone
  return (TIMEZONES as readonly string[]).includes(value as string) ? (value as Timezone) : 'WIB'
}

/** Gabungkan patch ke settings lama; key tak dikenal diabaikan. */
export function mergeSettings(
  current: RawSettings,
  patch: RawSettings
): RawSettings {
  const merged: RawSettings = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in settingsSchema.shape)) continue
    merged[key] = value
  }
  return merged
}
