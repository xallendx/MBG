/**
 * Apakah jadwal sebuah tugas benar-benar berubah saat diedit?
 *
 * KENAPA PERLU
 * ------------
 * `PUT /api/tasks/[id]` dulu menganggap jadwal berubah kalau body permintaan
 * memuat key `scheduleType` atau `scheduleConfig`. Padahal form edit di browser
 * selalu mengirim seluruh isi tugas, termasuk dua key itu, walau yang diubah
 * cuma nama atau prioritas. Akibatnya penanda notifikasi (`notifiedWarnAt` /
 * `notifiedReadyAt`) ikut di-reset setiap kali ganti nama, dan sweep berikutnya
 * mengirim ulang "Task siap dikerjakan!" untuk kejadian yang sama.
 *
 * Jadi yang dibandingkan adalah nilainya, bukan ada-tidaknya key.
 */
import { canonicalJson } from './task-form'

export interface ExistingSchedule {
  scheduleType: string
  /** Kolom DB: JSON string. Bisa rusak untuk data lama. */
  scheduleConfig: string
}

export interface SchedulePatch {
  scheduleType?: string
  scheduleConfig?: Record<string, unknown>
}

/** Parse tanpa melempar; config rusak dianggap kosong agar tidak selalu "berubah". */
function parseConfig(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

export function scheduleActuallyChanged(existing: ExistingSchedule, patch: SchedulePatch): boolean {
  if (patch.scheduleType !== undefined && patch.scheduleType !== existing.scheduleType) return true
  if (patch.scheduleConfig === undefined) return false
  // Urutan key dan angka vs teks tidak dianggap perubahan jadwal.
  return canonicalJson(patch.scheduleConfig) !== canonicalJson(parseConfig(existing.scheduleConfig))
}
