/**
 * Lapisan bersama untuk route API.
 *
 * MASALAH YANG DIPERBAIKI
 * -----------------------
 * 1. Validasi dilakukan manual di setiap route dengan gaya berbeda-beda
 *    ("wajib diisi", "tidak valid", "harus berupa boolean", ...). `zod` sudah
 *    ada di dependencies tapi **0 pemakaian**. Sekarang skema ada di satu
 *    tempat (`src/lib/schemas.ts`) dan dipakai lewat `parseBody`.
 * 2. Error sering ditelan `catch {}` tanpa log, atau dijawab "Request failed"
 *    tanpa konteks. Sekarang semua route memakai `handleApiError` yang mencatat
 *    error terstruktur dan memetakan error Prisma ke status HTTP yang tepat.
 * 3. Pesan error untuk user jadi konsisten dan spesifik (mengambil issue
 *    pertama dari zod), bukan "coba lagi" yang tidak informatif.
 */

import { NextResponse } from 'next/server'
import { ZodError, type ZodType } from 'zod'
import { Prisma } from '@prisma/client'
import { requireUser } from '@/lib/auth'
import { logError, logWarn } from '@/lib/logger'

/** Error yang memang ditujukan untuk user (status & pesan sudah jelas). */
export class ApiError extends Error {
  status: number
  code?: string

  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export function jsonError(status: number, message: string, code?: string) {
  return NextResponse.json({ error: message, ...(code ? { code } : {}) }, { status })
}

/**
 * Ambil userId dari cookie, atau lempar 401.
 * Menghilangkan boilerplate `if (!userId) return ...` di 40 route.
 */
export async function requireUserId(): Promise<string> {
  const userId = await requireUser()
  if (!userId) throw new ApiError(401, 'Sesi tidak valid. Silakan login ulang.', 'UNAUTHORIZED')
  return userId
}

/** Ambil issue zod pertama sebagai pesan yang bisa dibaca user. */
export function zodMessage(err: ZodError): string {
  const issue = err.issues[0]
  if (!issue) return 'Data tidak valid'
  // Pesan kustom schema dipakai apa adanya. Pesan bawaan zod berbahasa Inggris
  // ("Invalid input: expected string, received undefined", "Required", dst.)
  // tidak boleh bocor ke UI, jadi diganti pesan Indonesia yang menyebut field.
  const isDefaultEnglish = /^(Invalid input|Required|Invalid$|Unrecognized key)/i.test(issue.message)
  const path = issue.path.join('.')
  if (issue.message && !isDefaultEnglish) {
    return path ? `${path}: ${issue.message}` : issue.message
  }
  return path ? `Isian "${path}" tidak valid` : 'Data yang dikirim tidak valid'
}

/**
 * Parse & validasi body JSON terhadap skema zod.
 * Body yang bukan JSON valid → 400 (bukan 500 seperti sebelumnya).
 */
export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    throw new ApiError(400, 'Body request harus berupa JSON yang valid', 'INVALID_JSON')
  }

  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw new ApiError(400, zodMessage(parsed.error), 'VALIDATION_ERROR')
  }
  return parsed.data
}

/** Ubah error apa pun menjadi respons HTTP + catat log terstruktur. */
export function handleApiError(ctx: string, error: unknown): NextResponse {
  if (error instanceof ApiError) {
    // 4xx bukan kondisi abnormal — cukup warn, tidak perlu alert.
    if (error.status >= 500) logError(ctx, error)
    else logWarn(ctx, error.message, { status: error.status, code: error.code })
    return jsonError(error.status, error.message, error.code)
  }

  if (error instanceof ZodError) {
    logWarn(ctx, 'validasi gagal', { issues: error.issues.length })
    return jsonError(400, zodMessage(error), 'VALIDATION_ERROR')
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // P2002 = unique constraint, P2025 = record tidak ditemukan
    if (error.code === 'P2002') {
      logWarn(ctx, 'unique constraint', { target: error.meta })
      return jsonError(409, 'Data sudah ada (duplikat)', 'DUPLICATE')
    }
    if (error.code === 'P2025') {
      logWarn(ctx, 'record tidak ditemukan', { meta: error.meta })
      return jsonError(404, 'Data tidak ditemukan', 'NOT_FOUND')
    }
    logError(ctx, error, { prismaCode: error.code })
    return jsonError(500, 'Terjadi kesalahan pada database', 'DB_ERROR')
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    logError(ctx, error)
    return jsonError(503, 'Database tidak dapat dihubungi', 'DB_UNAVAILABLE')
  }

  logError(ctx, error)
  return jsonError(500, 'Terjadi kesalahan pada server', 'INTERNAL')
}

/** Pastikan record milik user yang sedang login (mencegah akses lintas user). */
export function assertOwnership(ownerId: string | null | undefined, userId: string) {
  if (!ownerId || ownerId !== userId) {
    throw new ApiError(404, 'Data tidak ditemukan', 'NOT_FOUND')
  }
}
