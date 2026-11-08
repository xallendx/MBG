import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { setAuthCookie } from '@/lib/auth'
import { clientIp, consumeRateLimit, resetRateLimit } from '@/lib/rate-limit'
import { ApiError, handleApiError, parseBody } from '@/lib/api'
import { loginSchema } from '@/lib/schemas'
import { ensureEnvAdmin } from '@/lib/admin-bootstrap'

// Rate limit berbasis database — lihat src/lib/rate-limit.ts untuk alasannya
// (Map in-memory tidak berfungsi di serverless: tiap instance punya memori
// sendiri dan cold start menghapusnya).
const MAX_LOGIN_ATTEMPTS = 10
const LOGIN_WINDOW_MS = 15 * 60 * 1000 // 15 minutes

async function verifyPassword(password: string, hash: string): Promise<{ match: boolean; newHash?: string }> {
  if (hash.startsWith('$2')) {
    const match = await bcrypt.compare(password, hash)
    return { match }
  }
  // Legacy SHA-256 — verify and re-hash
  const sha256 = crypto.createHash('sha256').update(password).digest('hex')
  if (sha256 === hash) {
    const newHash = await bcrypt.hash(password, 10)
    return { match: true, newHash }
  }
  return { match: false }
}

export async function POST(req: Request) {
  try {
    const ip = clientIp(req)
    const { username, password } = await parseBody(req, loginSchema)

    // Akun admin pemulihan dari ADMIN_USERNAME/ADMIN_PASSWORD (kalau diisi).
    // Dipanggil sebelum pencarian user supaya percobaan login pertama setelah
    // redeploy langsung berhasil. No-op kalau env var tidak diisi, dan tidak
    // pernah melempar error sehingga tidak bisa menggagalkan login.
    await ensureEnvAdmin()

    // Rate limit dua lapis: per username (target akun) dan per IP (satu sumber
    // yang menembak banyak username). Keduanya harus di bawah batas.
    const uname = String(username).toLowerCase().slice(0, 64)
    const [byUser, byIp] = await Promise.all([
      consumeRateLimit(`login:user:${uname}`, MAX_LOGIN_ATTEMPTS, LOGIN_WINDOW_MS),
      consumeRateLimit(`login:ip:${ip}`, MAX_LOGIN_ATTEMPTS * 3, LOGIN_WINDOW_MS),
    ])
    if (!byUser.allowed || !byIp.allowed) {
      const retry = Math.max(byUser.retryAfterSeconds, byIp.retryAfterSeconds, 60)
      return NextResponse.json(
        { error: `Terlalu banyak percobaan login. Coba lagi dalam ${Math.ceil(retry / 60)} menit.` },
        { status: 429, headers: { 'Retry-After': String(retry) } }
      )
    }

    const user = await db.user.findUnique({ where: { username } })
    if (!user || user.isBlocked) {
      return NextResponse.json({ error: 'Username atau password salah' }, { status: 401 })
    }

    const result = await verifyPassword(password, user.passwordHash)

    if (!result.match) {
      return NextResponse.json({ error: 'Username atau password salah' }, { status: 401 })
    }

    // Re-hash legacy SHA-256 passwords with bcrypt
    if (result.newHash) {
      await db.user.update({
        where: { id: user.id },
        data: { passwordHash: result.newHash }
      })
    }

    // Hitungan per-username direset setelah login berhasil supaya user sah
    // tidak "terbawa" sisa percobaan gagal sebelumnya.
    await resetRateLimit(`login:user:${uname}`)

    const res = NextResponse.json({ success: true, user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role } })
    setAuthCookie(res, user.id)
    return res
  } catch (e) {
    return handleApiError('POST /api/auth/login', e)
  }
}
