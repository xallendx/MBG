import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { logError, logInfo, logWarn } from '@/lib/logger'
import { readAdminBootstrapConfig } from '@/lib/admin-bootstrap-config'

/**
 * Membuat (atau mereset) satu akun ADMIN dari environment variable.
 * Lihat `admin-bootstrap-config.ts` untuk alasan fitur ini ada.
 *
 * Aturan keselamatan:
 * 1. Tanpa env var → tidak melakukan apa-apa.
 * 2. Username yang sudah ada TIDAK disentuh, kecuali reset diminta eksplisit
 *    lewat ADMIN_ALLOW_PASSWORD_RESET=true.
 * 3. Password selalu di-hash bcrypt; tidak pernah ditulis ke log.
 * 4. Kegagalan di sini tidak boleh menggagalkan login — error ditelan setelah
 *    dicatat, lalu dicoba lagi pada permintaan berikutnya.
 */

const CTX = 'admin-bootstrap'

// Dijalankan sekali per proses. Di serverless artinya sekali per cold start,
// bukan sekali per request — cukup murah dan tidak menambah query di jalur panas.
let settled = false
let inflight: Promise<void> | null = null

export async function ensureEnvAdmin(): Promise<void> {
  if (settled) return
  // Dua request bersamaan saat cold start tidak boleh membuat dua akun.
  if (inflight) return inflight
  inflight = run().finally(() => {
    inflight = null
  })
  return inflight
}

/** Hanya untuk test: lupa status memo supaya bisa diuji berulang. */
export function __resetAdminBootstrapState() {
  settled = false
  inflight = null
}

async function run(): Promise<void> {
  const cfg = readAdminBootstrapConfig(process.env)

  if (cfg.status === 'disabled') return
  if (cfg.status === 'invalid') {
    // Pesan alasan tidak memuat nilai password, hanya nama variabel.
    logWarn(CTX, `dilewati: ${cfg.reason}`)
    settled = true
    return
  }

  try {
    const existing = await db.user.findUnique({
      where: { username: cfg.username },
      select: { id: true, role: true },
    })

    if (existing && !cfg.allowReset) {
      if (existing.role !== 'ADMIN') {
        logWarn(CTX, 'ADMIN_USERNAME sudah dipakai akun non-admin; akun tidak diubah', {
          username: cfg.username,
        })
      }
      settled = true
      return
    }

    const passwordHash = await bcrypt.hash(cfg.password, 10)

    if (existing) {
      await db.user.update({
        where: { id: existing.id },
        data: { passwordHash, role: 'ADMIN', isBlocked: false },
      })
      logInfo(CTX, 'password admin direset dari environment variable', {
        username: cfg.username,
      })
    } else {
      await db.user.create({
        data: {
          username: cfg.username,
          passwordHash,
          displayName: cfg.username,
          role: 'ADMIN',
        },
      })
      logInfo(CTX, 'akun admin dibuat dari environment variable', {
        username: cfg.username,
      })
    }

    settled = true
  } catch (e) {
    // Dua instance bisa lolos pengecekan bersamaan; yang kalah kena unique
    // constraint. Itu berarti akunnya sudah ada — anggap selesai.
    const code = (e as { code?: string } | null)?.code
    if (code === 'P2002') {
      settled = true
      return
    }
    // Pesan error Prisma bisa menyertakan argumen invokasi (termasuk hash).
    // Ambil baris pertama saja supaya tidak ada material rahasia masuk log.
    const firstLine = e instanceof Error ? e.message.split('\n')[0] : String(e)
    logError(CTX, new Error(firstLine))
    // settled tetap false → dicoba lagi di request berikutnya.
  }
}
