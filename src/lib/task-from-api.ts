/**
 * Ubah balasan API tugas menjadi bentuk yang dipakai daftar di layar.
 *
 * KENAPA PERLU
 * ------------
 * `POST /api/tasks` dan `PUT /api/tasks/[id]` mengembalikan tugas yang sudah
 * tersimpan, tetapi `saveTask` dulu membuang balasan itu dan hanya memanggil
 * ulang `/api/init`. Akibatnya:
 *
 * 1. Dengan jaringan lambat, dialog sudah tertutup tetapi tugasnya belum
 *    terlihat selama satu perjalanan bolak-balik penuh (terukur ~1,2 detik
 *    pada latensi 1,2 detik) — terasa seperti "Simpan & selesai tidak jalan".
 * 2. Kalau `/api/init` gagal (sinyal hilang, cold start lewat batas waktu),
 *    tugas SUDAH tersimpan di server namun tidak pernah muncul di daftar
 *    sampai pengguna memuat ulang. Ini terlihat persis seperti gagal simpan.
 *
 * Sekarang balasan dipakai langsung. Status dan cooldown dihitung dengan
 * fungsi yang sama seperti server (`schedule.ts`) supaya tidak ada kedip
 * "siap → cooldown" saat sinkronisasi latar belakang menyusul.
 */
import { computeStatus, getNextReadyAt } from './schedule'

/** Bentuk balasan mentah: bisa dari Prisma (tanpa status) atau sudah diperkaya. */
export interface ApiTaskLike {
  id?: unknown
  name?: unknown
  description?: unknown
  link?: unknown
  scheduleType?: unknown
  scheduleConfig?: unknown
  notes?: unknown
  pinned?: unknown
  priority?: unknown
  createdAt?: unknown
  project?: { id: string; name: string; color: string } | null
  status?: unknown
  nextReadyAt?: unknown
  lastCompletedAt?: unknown
  cooldownRemaining?: unknown
  cooldownMs?: unknown
  logCount?: unknown
}

export interface ViewTaskLike {
  id: string
  name: string
  description: string | null
  link: string | null
  scheduleType: string
  scheduleConfig: string
  notes: string | null
  pinned: boolean
  priority?: string
  status: 'siap' | 'cooldown' | 'selesai'
  nextReadyAt: string | null
  lastCompletedAt: string | null
  cooldownRemaining: string
  cooldownMs: number
  project: { id: string; name: string; color: string } | null
  createdAt: string
  logCount?: number
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const isoOrNull = (v: unknown): string | null => {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString()
  if (typeof v === 'string' && v) { const d = new Date(v); return isNaN(d.getTime()) ? null : d.toISOString() }
  return null
}

/** Format teks cooldown sama dengan ticker di layar supaya tidak berkedip. */
export function cooldownText(ms: number): string {
  if (ms <= 0) return ''
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  if (h >= 1) return `${h}j ${m}m`
  if (m >= 1) return `${m}m ${s}s`
  return `${s}s`
}

/**
 * @param raw      balasan API (`null`/bentuk tak dikenal → `null`, pemanggil
 *                 tetap punya jalur sinkronisasi latar belakang).
 * @param previous tugas lama saat mengedit; dipakai untuk melengkapi kolom yang
 *                 tidak dikirim server (log terakhir, jumlah log).
 * @param timezone zona waktu pengguna, sama seperti yang dipakai `/api/init`.
 * @param now      disuntik saat pengujian supaya hasil deterministik.
 */
export function taskFromApi(
  raw: ApiTaskLike | null | undefined,
  opts: { previous?: ViewTaskLike | null; timezone?: string; now?: number } = {},
): ViewTaskLike | null {
  if (!raw || typeof raw.id !== 'string' || !raw.id || typeof raw.name !== 'string') return null
  const prev = opts.previous ?? null
  const now = opts.now ?? Date.now()
  const scheduleType = str(raw.scheduleType) ?? prev?.scheduleType ?? 'sekali'
  const scheduleConfig = typeof raw.scheduleConfig === 'string'
    ? raw.scheduleConfig
    : raw.scheduleConfig && typeof raw.scheduleConfig === 'object'
      ? JSON.stringify(raw.scheduleConfig)
      : prev?.scheduleConfig ?? '{}'
  const createdAt = isoOrNull(raw.createdAt) ?? prev?.createdAt ?? new Date(now).toISOString()
  const lastCompletedAt = isoOrNull(raw.lastCompletedAt) ?? prev?.lastCompletedAt ?? null
  const logCountRaw = typeof raw.logCount === 'number' ? raw.logCount : prev?.logCount
  const logCount = typeof logCountRaw === 'number' && logCountRaw >= 0 ? logCountRaw : (lastCompletedAt ? 1 : 0)
  const project = raw.project === undefined ? prev?.project ?? null : raw.project ?? null

  // Balasan complete/undo/reset sudah membawa statushitung server: percaya saja.
  const enriched = raw.status === 'siap' || raw.status === 'cooldown' || raw.status === 'selesai'
  let status: ViewTaskLike['status']
  let nextReadyAt: string | null
  if (enriched) {
    status = raw.status as ViewTaskLike['status']
    nextReadyAt = isoOrNull(raw.nextReadyAt)
  } else {
    // Hitung seperti server: cukup log terakhir, dan untuk tugas baru belum ada.
    const logs = lastCompletedAt ? [{ completedAt: new Date(lastCompletedAt) }] : []
    const scheduleTask = { scheduleType, scheduleConfig, logs, createdAt }
    status = computeStatus(scheduleTask, opts.timezone)
    const next = getNextReadyAt(scheduleTask, opts.timezone)
    nextReadyAt = next ? next.toISOString() : null
  }

  const cooldownMs = status === 'cooldown' && nextReadyAt
    ? Math.max(0, new Date(nextReadyAt).getTime() - now)
    : 0

  return {
    id: raw.id,
    name: raw.name,
    description: str(raw.description) ?? prev?.description ?? null,
    link: str(raw.link) ?? null,
    scheduleType,
    scheduleConfig,
    notes: raw.notes === undefined ? prev?.notes ?? null : str(raw.notes),
    pinned: typeof raw.pinned === 'boolean' ? raw.pinned : prev?.pinned ?? false,
    priority: str(raw.priority) ?? prev?.priority ?? 'medium',
    status,
    nextReadyAt,
    lastCompletedAt,
    cooldownRemaining: cooldownText(cooldownMs),
    cooldownMs,
    project,
    createdAt,
    logCount,
  }
}

/**
 * Sisipkan tugas baru tanpa menggandakan: balasan 200 (retry idempoten) bisa
 * membawa tugas yang sudah ada di daftar.
 */
export function upsertTask<T extends { id: string }>(list: T[], task: T, atTop = false): T[] {
  const i = list.findIndex(t => t.id === task.id)
  if (i >= 0) { const next = [...list]; next[i] = { ...next[i], ...task }; return next }
  return atTop ? [task, ...list] : [...list, task]
}
