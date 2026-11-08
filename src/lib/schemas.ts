/**
 * Skema validasi (zod) untuk seluruh input API.
 *
 * Semua pesan ditulis dalam Bahasa Indonesia dan menyebut field-nya, supaya
 * bisa langsung ditampilkan ke user tanpa penerjemahan tambahan.
 */
import { z } from 'zod'
import { isSafeHttpUrl } from './safe-url'
import { isAllowedPushEndpoint } from './push-endpoint'

const HEX_COLOR = /^#[0-9A-Fa-f]{3,8}$/

export const SCHEDULE_TYPES = [
  'sekali',
  'harian',
  'mingguan',
  'jam_tertentu',
  'tanggal_spesifik',
  'kustom',
] as const

export const PRIORITIES = ['high', 'medium', 'low'] as const

/**
 * String wajib. `error` di level string dipakai supaya field yang hilang sama
 * sekali tidak menghasilkan pesan bawaan zod berbahasa Inggris
 * ("Invalid input: expected string, received undefined").
 */
const trimmed = (min: number, max: number, label: string) =>
  z
    .string({ error: `${label} wajib diisi` })
    .trim()
    .min(min, `${label} minimal ${min} karakter`)
    .max(max, `${label} maksimal ${max} karakter`)

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} maksimal ${max} karakter`)
    .nullish()
    .transform(v => (v ? v : null))

const optionalLink = optionalText(2000, 'Link').refine(v => v === null || isSafeHttpUrl(v), 'Link harus berupa URL HTTP atau HTTPS yang valid')

const color = z
  .string()
  .regex(HEX_COLOR, 'Format warna tidak valid (contoh: #000080)')

// ── Auth ─────────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  username: trimmed(1, 50, 'Username'),
  password: z
    .string({ error: 'Password wajib diisi' })
    .min(1, 'Password wajib diisi')
    .max(128, 'Password terlalu panjang'),
})

export const registerSchema = z.object({
  username: z
    .string({ error: 'Username wajib diisi' })
    .trim()
    .min(3, 'Username minimal 3 karakter')
    .max(50, 'Username maksimal 50 karakter')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username hanya boleh huruf, angka, dan underscore'),
  password: z
    .string({ error: 'Password wajib diisi' })
    .min(6, 'Password minimal 6 karakter')
    .max(128, 'Password terlalu panjang'),
  displayName: z
    .string()
    .trim()
    .max(100, 'Nama tampilan maksimal 100 karakter')
    .nullish()
    .transform(v => (v ? v : null)),
  inviteCode: z.string().trim().max(64, 'Kode undangan terlalu panjang').nullish(),
})

// ── Task ─────────────────────────────────────────────────────────────────────

/** scheduleConfig boleh dikirim sebagai objek maupun string JSON. */
const scheduleConfigSchema = z
  .union([z.record(z.string(), z.unknown()), z.string().max(4000)])
  .nullish()
  .transform(v => {
    if (!v) return {}
    if (typeof v === 'string') {
      try {
        const parsed = JSON.parse(v)
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
      } catch {
        return {}
      }
    }
    return v
  })

export const taskCreateSchema = z.object({
  name: trimmed(1, 200, 'Nama task'),
  description: optionalText(5000, 'Deskripsi'),
  link: optionalLink,
  notes: optionalText(5000, 'Catatan'),
  scheduleType: z.enum(SCHEDULE_TYPES, { error: 'Tipe jadwal tidak valid' }).default('sekali'),
  scheduleConfig: scheduleConfigSchema,
  projectId: z.string({ error: 'projectId harus berupa teks' }).max(64).nullish().transform(v => (v ? v : null)),
  pinned: z.boolean({ error: 'pinned harus true/false' }).default(false),
  priority: z.enum(PRIORITIES, { error: 'Priority harus high, medium, atau low' }).default('medium'),
})

export const taskUpdateSchema = z.object({
  name: trimmed(1, 200, 'Nama task').optional(),
  description: optionalText(5000, 'Deskripsi').optional(),
  link: optionalLink.optional(),
  notes: optionalText(5000, 'Catatan').optional(),
  scheduleType: z.enum(SCHEDULE_TYPES, { error: 'Tipe jadwal tidak valid' }).optional(),
  scheduleConfig: scheduleConfigSchema.optional(),
  projectId: z.string({ error: 'projectId harus berupa teks' }).max(64).nullish().optional(),
  pinned: z.boolean({ error: 'pinned harus true/false' }).optional(),
  priority: z.enum(PRIORITIES, { error: 'Priority harus high, medium, atau low' }).optional(),
  position: z.number({ error: 'position harus berupa angka' }).int('position harus bilangan bulat').min(0).max(100000).optional(),
})

// ── Project ──────────────────────────────────────────────────────────────────

export const projectCreateSchema = z.object({
  name: trimmed(1, 100, 'Nama project'),
  color: color.optional(),
})

export const projectUpdateSchema = z.object({
  name: trimmed(1, 100, 'Nama project').optional(),
  color: color.optional(),
  position: z.number({ error: 'position harus berupa angka' }).int('position harus bilangan bulat').min(0).max(10000).optional(),
})

// ── Note ─────────────────────────────────────────────────────────────────────

export const noteCreateSchema = z.object({
  content: trimmed(1, 10000, 'Isi catatan'),
  color: color.optional(),
})

export const noteUpdateSchema = z.object({
  content: trimmed(1, 10000, 'Isi catatan').optional(),
  color: color.optional(),
  pinned: z.boolean({ error: 'pinned harus true/false' }).optional(),
})

// ── Template ─────────────────────────────────────────────────────────────────

export const templateCreateSchema = z.object({
  name: trimmed(1, 200, 'Nama template'),
  description: optionalText(5000, 'Deskripsi'),
  link: optionalLink,
  scheduleType: z.enum(SCHEDULE_TYPES, { error: 'Tipe jadwal tidak valid' }).default('sekali'),
  scheduleConfig: scheduleConfigSchema,
  priority: z.enum(PRIORITIES, { error: 'Priority harus high, medium, atau low' }).default('medium'),
})

export const templateUpdateSchema = templateCreateSchema.partial()

// ── Settings ─────────────────────────────────────────────────────────────────

/** Pengaturan user disimpan sebagai JSON string di kolom User.settings. */
export const settingsSchema = z.object({
  timezone: z.enum(['WIB', 'WITA', 'WIT'], { error: 'Timezone harus WIB, WITA, atau WIT' }),
  timeFormat: z.enum(['12', '24'], { error: 'Format jam harus "12" atau "24"' }),
  autoExpandSiap: z.boolean({ error: 'autoExpandSiap harus true/false' }),
  autoCompleteLink: z.boolean({ error: 'autoCompleteLink harus true/false' }),
  telegramNotifEnabled: z.boolean({ error: 'telegramNotifEnabled harus true/false' }),
  browserNotifEnabled: z.boolean({ error: 'browserNotifEnabled harus true/false' }),
  pomodoroDuration: z
    .number({ error: 'pomodoroDuration harus berupa angka' })
    .int('pomodoroDuration harus bilangan bulat')
    .min(1, 'pomodoroDuration minimal 1 menit')
    .max(120, 'pomodoroDuration maksimal 120 menit'),
  audioAlertEnabled: z.boolean({ error: 'audioAlertEnabled harus true/false' }),
  telegramBotUsername: z
    .string({ error: 'Username bot harus berupa teks' })
    .max(100, 'Username bot maksimal 100 karakter'),
  notifyBeforeCooldownMin: z
    .number({ error: 'notifyBeforeCooldownMin harus berupa angka' })
    .int('notifyBeforeCooldownMin harus bilangan bulat')
    .min(1, 'notifyBeforeCooldownMin minimal 1 menit')
    .max(60, 'notifyBeforeCooldownMin maksimal 60 menit'),
  // Koneksi Telegram — null dipakai untuk memutus koneksi dari panel pengaturan.
  telegramChatId: z.union([z.string().max(64), z.number()]).nullable().optional(),
  telegramId: z.union([z.string().max(64), z.number()]).nullable().optional(),
  telegramName: z.string().max(100).nullable().optional(),
  telegramConnected: z.boolean().optional(),
  // Diisi server (generate-code / webhook), ikut diizinkan agar tidak ditolak
  // kalau suatu saat dikirim balik oleh klien.
  telegramCode: z.string().max(64).optional(),
  telegramCodeExpiry: z.number().optional(),
})

export type SettingsKey = keyof typeof settingsSchema.shape

const settingsKeys = new Set(Object.keys(settingsSchema.shape))

/**
 * Divalidasi per key satu per satu supaya pesan errornya menyebut nama key
 * yang salah (mis. "notifyBeforeCooldownMin harus bilangan bulat"), bukan
 * pesan generik. Key asing ditolak, bukan dibuang diam-diam.
 */
export const settingsUpdateSchema = z
  .record(z.string().max(64), z.unknown())
  .superRefine((obj, ctx) => {
    const keys = Object.keys(obj)
    if (keys.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Tidak ada pengaturan yang dikirim' })
      return
    }
    for (const key of keys) {
      if (!settingsKeys.has(key)) {
        ctx.addIssue({ code: 'custom', message: `Pengaturan tidak dikenal: ${key}`, path: [key] })
        continue
      }
      const field = (settingsSchema.shape as Record<string, z.ZodType>)[key]
      const result = field.safeParse(obj[key])
      if (!result.success) {
        ctx.addIssue({
          code: 'custom',
          message: result.error.issues[0]?.message ?? `Nilai ${key} tidak valid`,
          path: [key],
        })
      }
    }
  })

// ── Admin ────────────────────────────────────────────────────────────────────

export const inviteCodeCreateSchema = z.object({
  role: z.enum(['USER', 'ADMIN'], { error: 'Role harus USER atau ADMIN' }).default('USER'),
})

export const adminUserUpdateSchema = z.object({
  isBlocked: z.boolean({ error: 'isBlocked harus true/false' }).optional(),
  role: z.enum(['USER', 'ADMIN'], { error: 'Role harus USER atau ADMIN' }).optional(),
})

// ── Push ─────────────────────────────────────────────────────────────────────

export const pushSubscribeSchema = z.object({
  endpoint: z.string({ error: 'Endpoint push wajib diisi' }).url('Endpoint push tidak valid').max(2000).refine(isAllowedPushEndpoint, 'Layanan push tidak didukung atau tidak aman'),
  keys: z.object({
    auth: z.string().min(1, 'Key auth wajib diisi').max(500),
    p256dh: z.string().min(1, 'Key p256dh wajib diisi').max(500),
  }),
})
