/**
 * Rate limiting berbasis database.
 *
 * MASALAH YANG DIPERBAIKI
 * -----------------------
 * Sebelumnya login & registrasi memakai `Map` di level modul:
 *
 *     const loginAttempts = new Map<string, { count, windowStart }>()
 *
 * Di Vercel (serverless) setiap instance punya memori sendiri, dan cold start
 * menghapus isinya. Artinya batas "5 percobaan / 15 menit" tidak benar-benar
 * berlaku: penyerang cukup menembak paralel ke banyak instance, atau menunggu
 * instance baru dibuat. Kode undangan dan password jadi bisa di-brute force.
 *
 * SOLUSI
 * ------
 * Hitungan disimpan di tabel `RateLimit` (satu baris per key) dan di-update
 * dengan satu statement atomik (`INSERT ... ON CONFLICT DO UPDATE`), sehingga
 * konsisten lintas instance dan tahan cold start.
 *
 * Catatan: sengaja tidak memakai transaksi terpisah supaya tetap satu round-trip.
 */

import { db } from '@/lib/db'
import { ApiError } from './api'

export type RateLimitResult = {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

/**
 * Hitung satu percobaan untuk `key`.
 * @param key     identitas unik, mis. `login:1.2.3.4:admin1`
 * @param max     jumlah percobaan maksimum dalam satu window
 * @param windowMs panjang window dalam milidetik
 */
export async function consumeRateLimit(
  key: string,
  max: number,
  windowMs: number
): Promise<RateLimitResult> {
  const windowSeconds = Math.max(1, Math.round(windowMs / 1000))

  try {
    const rows = await db.$queryRaw<Array<{ count: number; windowStartMs: number }>>`
      INSERT INTO "RateLimit" ("key", "count", "windowStart")
      VALUES (${key}, 1, now())
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN "RateLimit"."windowStart" < now() - (${windowSeconds} * interval '1 second')
          THEN 1
          ELSE "RateLimit"."count" + 1
        END,
        "windowStart" = CASE
          WHEN "RateLimit"."windowStart" < now() - (${windowSeconds} * interval '1 second')
          THEN now()
          ELSE "RateLimit"."windowStart"
        END
      RETURNING "count", (extract(epoch from "windowStart") * 1000)::bigint AS "windowStartMs"
    `

    const row = rows[0]
    const count = Number(row?.count ?? 1)
    const windowStartMs = Number(row?.windowStartMs ?? Date.now())
    const elapsed = Date.now() - windowStartMs
    const retryAfterSeconds = Math.max(0, Math.ceil((windowMs - elapsed) / 1000))

    return {
      allowed: count <= max,
      remaining: Math.max(0, max - count),
      retryAfterSeconds,
    }
  } catch (e) {
    // A missing/broken limiter must never silently permit authentication or guessing.
    console.error('[rate-limit] gagal menghitung limit:', e instanceof Error ? e.message : String(e))
    throw new ApiError(503, 'Pembatas keamanan sementara tidak tersedia. Coba lagi nanti.', 'RATE_LIMIT_UNAVAILABLE')
  }
}

/** Reset hitungan (mis. setelah login berhasil). */
export async function resetRateLimit(key: string): Promise<void> {
  await db.rateLimit.deleteMany({ where: { key } }).catch(() => {})
}

/**
 * Bersihkan baris lama. Dipanggil sesekali dari endpoint cron supaya tabel
 * tidak tumbuh tanpa batas.
 */
export async function pruneRateLimits(olderThanHours = 24): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanHours * 3600000)
  const res = await db.rateLimit.deleteMany({ where: { windowStart: { lt: cutoff } } })
  return res.count
}

/** Ambil IP klien dari header proxy (Vercel) dengan fallback aman. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip') || 'unknown'
}
