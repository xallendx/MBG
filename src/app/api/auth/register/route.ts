import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { setAuthCookie } from '@/lib/auth'
import { clientIp, consumeRateLimit } from '@/lib/rate-limit'
import { ApiError, handleApiError, parseBody } from '@/lib/api'
import { registerSchema } from '@/lib/schemas'
import { logWarn } from '@/lib/logger'

// Rate limit berbasis database (Map in-memory tidak efektif di serverless).
const MAX_REGISTER_ATTEMPTS = 5
const REGISTER_WINDOW_MS = 15 * 60 * 1000 // 15 minutes

/**
 * GET /api/auth/register
 * Dipakai layar Daftar untuk tahu apakah instalasi ini masih kosong.
 * Kalau belum ada user sama sekali, user pertama boleh mendaftar tanpa kode
 * undangan dan otomatis menjadi ADMIN — sebelumnya fresh install sama sekali
 * tidak bisa dipakai karena belum ada kode undangan di database.
 */
export async function GET() {
  try {
    const userCount = await db.user.count()
    return NextResponse.json({ bootstrap: userCount === 0, userCount })
  } catch (e) {
    // Kalau DB belum siap, jangan blokir pendaftaran — tapi catat supaya
    // kegagalan koneksi tidak hilang tanpa jejak.
    logWarn('GET /api/auth/register', 'gagal menghitung user', {
      error: e instanceof Error ? e.message : String(e),
    })
    return NextResponse.json({ bootstrap: false, userCount: -1 })
  }
}

export async function POST(req: Request) {
  try {
    const ip = clientIp(req)
    const body = await parseBody(req, registerSchema)
    const { username, password, displayName } = body
    const inviteCode = body.inviteCode ?? ''

    // Fresh install (belum ada user): pendaftaran pertama tidak butuh kode undangan.
    const existingUserCount = await db.user.count()
    const isBootstrap = existingUserCount === 0

    // Validate invite code (kecuali saat bootstrap)
    if (!isBootstrap && (!inviteCode || typeof inviteCode !== 'string')) {
      return NextResponse.json({ error: 'Kode undangan wajib diisi. Minta kode ke admin.' }, { status: 400 })
    }
    if (!isBootstrap && String(inviteCode).trim().length < 6) {
      return NextResponse.json({ error: 'Kode undangan tidak valid' }, { status: 400 })
    }

    // Rate limit per IP + per kode undangan. Sebelumnya hanya per kode undangan,
    // dan Map-nya tidak bertahan di serverless sehingga brute force tetap mungkin.
    if (!isBootstrap) {
      const [byCode, byIp] = await Promise.all([
        consumeRateLimit(`register:code:${String(inviteCode).trim().toUpperCase()}`, MAX_REGISTER_ATTEMPTS, REGISTER_WINDOW_MS),
        consumeRateLimit(`register:ip:${ip}`, MAX_REGISTER_ATTEMPTS * 4, REGISTER_WINDOW_MS),
      ])
      if (!byCode.allowed || !byIp.allowed) {
        const retry = Math.max(byCode.retryAfterSeconds, byIp.retryAfterSeconds, 60)
        return NextResponse.json(
          { error: `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(retry / 60)} menit.` },
          { status: 429, headers: { 'Retry-After': String(retry) } }
        )
      }
    }

    const code = isBootstrap ? '' : inviteCode.trim().toUpperCase()

    // Hash password with bcrypt
    const passwordHash = await bcrypt.hash(password, 10)

    // Wrap invite code check + user creation + invite code update in a transaction
    const result = await db.$transaction(async (tx) => {
      if (isBootstrap) {
        // Serialize first-user creation and recheck inside the lock. The count
        // before this transaction is only a hint, not an authorization check.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('mbg:first-user-bootstrap'))`
        if (await tx.user.count() !== 0) throw new Error('BOOTSTRAP_CLOSED')
        // User pertama = admin. Tidak menyentuh tabel InviteCode.
        const firstUser = await tx.user.create({
          data: { username, passwordHash, displayName: displayName || null, role: 'ADMIN' }
        })
        return firstUser
      }

      // READ COMMITTED transactions alone do not prevent duplicate use.
      // Lock the code before checking usedBy; keep the lock until user creation commits.
      await tx.$queryRaw`SELECT id FROM "InviteCode" WHERE code = ${code} FOR UPDATE`
      const invite = await tx.inviteCode.findUnique({ where: { code } })
      if (!invite) {
        throw new Error('INVALID_CODE')
      }
      if (invite.usedBy) {
        throw new Error('CODE_USED')
      }

      // Check existing user
      const existing = await tx.user.findUnique({ where: { username } })
      if (existing) {
        throw new Error('USERNAME_TAKEN')
      }

      const userRole = invite.role || 'USER'

      const user = await tx.user.create({
        data: {
          username,
          passwordHash,
          displayName: displayName || null,
          role: userRole
        }
      })

      await tx.inviteCode.update({
        where: { id: invite.id },
        data: { usedBy: user.id, usedAt: new Date() }
      })

      return user
    })

    const res = NextResponse.json({ success: true, user: { id: result.id, username: result.username, displayName: result.displayName, role: result.role } })
    setAuthCookie(res, result.id)
    return res
  } catch (e) {
    // Error domain dari dalam transaksi dipetakan ke status HTTP yang jelas.
    if (e instanceof Error && e.message === 'BOOTSTRAP_CLOSED') {
      return handleApiError('POST /api/auth/register', new ApiError(403, 'Pendaftaran awal telah selesai. Gunakan kode undangan.', 'BOOTSTRAP_CLOSED'))
    }
    if (e instanceof Error && e.message === 'INVALID_CODE') {
      return handleApiError('POST /api/auth/register', new ApiError(403, 'Kode undangan tidak valid', 'INVALID_CODE'))
    }
    if (e instanceof Error && e.message === 'CODE_USED') {
      return handleApiError('POST /api/auth/register', new ApiError(403, 'Kode undangan sudah digunakan', 'CODE_USED'))
    }
    if (e instanceof Error && e.message === 'USERNAME_TAKEN') {
      return handleApiError('POST /api/auth/register', new ApiError(409, 'Username sudah digunakan', 'USERNAME_TAKEN'))
    }
    return handleApiError('POST /api/auth/register', e)
  }
}
