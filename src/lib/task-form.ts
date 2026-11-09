/**
 * Aturan form tambah tugas berurutan (Opsi A).
 *
 * Tugas disimpan satu per satu: kegagalan tugas ke-7 tidak membatalkan enam
 * tugas yang sudah dikonfirmasi server. File ini murni logika agar aturan
 * "ingat jadwal per proyek", draft kotor, dan kunci percobaan bisa diuji tanpa
 * browser/database. Tidak ada nama/link tugas yang disimpan sebagai preferensi.
 */
import { NO_PROJECT_FILTER, projectIdForNewTask } from './task-view'

export interface TaskFormDefaults {
  scheduleType: string
  scheduleConfig: Record<string, unknown>
  priority: string
}

export interface TaskFormSnapshot extends TaskFormDefaults {
  name: string
  description: string
  link: string
  projectId: string | null
}

export const EMPTY_TASK_DEFAULTS: TaskFormDefaults = {
  scheduleType: 'sekali',
  scheduleConfig: {},
  priority: 'medium',
}

/** JSON kanonis: urutan key objek tidak dianggap sebagai perubahan draft. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return `{${Object.keys(obj).sort().filter(k => obj[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function cloneTaskDefaults(defaults: TaskFormDefaults): TaskFormDefaults {
  return {
    scheduleType: defaults.scheduleType,
    scheduleConfig: JSON.parse(canonicalJson(defaults.scheduleConfig)) as Record<string, unknown>,
    priority: defaults.priority,
  }
}

/** Kunci memakai JSON tuple supaya id user/proyek dengan pemisah apa pun tidak bertabrakan. */
export function taskDefaultsKey(userId: string | null | undefined, projectId: string | null | undefined): string {
  return JSON.stringify([userId ?? '', projectIdForNewTask(projectId) ?? ''])
}

export function rememberTaskDefaults(
  store: Map<string, TaskFormDefaults>,
  userId: string | null | undefined,
  projectId: string | null | undefined,
  defaults: TaskFormDefaults,
): void {
  store.set(taskDefaultsKey(userId, projectId), cloneTaskDefaults(defaults))
}

export function readTaskDefaults(
  store: Map<string, TaskFormDefaults>,
  userId: string | null | undefined,
  projectId: string | null | undefined,
): TaskFormDefaults {
  const stored = store.get(taskDefaultsKey(userId, projectId))
  return stored ? cloneTaskDefaults(stored) : cloneTaskDefaults(EMPTY_TASK_DEFAULTS)
}

export function emptyTaskForm(projectId: string | null | undefined, defaults: TaskFormDefaults): TaskFormSnapshot {
  return {
    ...cloneTaskDefaults(defaults),
    name: '',
    description: '',
    link: '',
    projectId: projectIdForNewTask(projectId),
  }
}

export function taskFormSnapshot(form: TaskFormSnapshot): string {
  return canonicalJson({ ...form, projectId: projectIdForNewTask(form.projectId) })
}

export function isTaskFormDirty(form: TaskFormSnapshot, baseline: string): boolean {
  return taskFormSnapshot(form) !== baseline
}

/**
 * Satu percobaan simpan: kunci idempoten + sidik jari isi yang dikirim.
 *
 * KENAPA PERLU SIDIK JARI
 * -----------------------
 * Setelah respons hilang di jaringan, kunci sengaja dipertahankan supaya retry
 * dengan isi yang sama tidak menggandakan tugas. Tapi kalau pengguna lalu
 * MENGUBAH isiannya dan menekan Simpan lagi, kunci lama terkirim bersama isi
 * baru; server menolaknya dengan REQUEST_PAYLOAD_CONFLICT dan kunci itu tidak
 * pernah dilepas. Akibatnya tombol Simpan gagal terus dengan pesan yang sama
 * sampai dialog ditutup — persis keluhan "tambah tugas tidak bisa disimpan".
 *
 * Isi sama → kunci sama (tetap idempoten). Isi berubah → percobaan baru.
 */
export interface SaveAttempt {
  key: string
  fingerprint: string
}

export function nextSaveAttempt(
  current: SaveAttempt | null,
  fingerprint: string,
  makeKey: () => string = newTaskRequestId,
): SaveAttempt {
  if (current && current.fingerprint === fingerprint) return current
  return { key: makeKey(), fingerprint }
}

/**
 * Server sudah memastikan percobaan itu tersimpan (isinya berbeda / kunci
 * bentrok). Percobaan lama harus dilepas supaya Simpan berikutnya tidak
 * mengulang penolakan yang sama selamanya.
 */
export function attemptIsSettled(errorCode: unknown): boolean {
  return errorCode === 'REQUEST_PAYLOAD_CONFLICT' || errorCode === 'REQUEST_ID_CONFLICT'
}

/** UUID v4 untuk kunci idempoten; fallback untuk browser tanpa randomUUID(). */
export function newTaskRequestId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  if (!c || typeof c.getRandomValues !== 'function') {
    // Sangat tua / WebView tanpa Web Crypto. Kunci ini bukan rahasia, hanya
    // penanda percobaan; lebih baik bisa menyimpan daripada tombol mati total.
    const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('')
    return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`
  }
  const bytes = c.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export { NO_PROJECT_FILTER }
