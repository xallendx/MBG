import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, handleApiError, parseBody, requireUserId } from '@/lib/api'
import { settingsUpdateSchema } from '@/lib/schemas'
import { mergeSettings, parseSettings, resolveSettings } from '@/lib/settings'

/**
 * Pengaturan disimpan sebagai kolom JSON string (lihat model User).
 *
 * Dulu nilai yang tidak valid **diam-diam dibuang** ("silently skip invalid
 * values"), sehingga user mengira pengaturannya tersimpan padahal tidak — mis.
 * `notifyBeforeCooldownMin: "5"` (string) hilang tanpa pesan. Sekarang nilai
 * tidak valid ditolak dengan pesan jelas, dan key yang tidak dikenal ditolak.
 */

export async function GET() {
  try {
    const userId = await requireUserId()
    const user = await db.user.findUnique({ where: { id: userId } })

    // resolveSettings: JSON rusak / nilai lama yang tidak valid tidak lagi bocor
    // ke klien — field bermasalah diganti default yang aman.
    return NextResponse.json(resolveSettings(user?.settings, 'GET /api/settings'))
  } catch (e) {
    return handleApiError('GET /api/settings', e)
  }
}

export async function PUT(req: Request) {
  const ctx = 'PUT /api/settings'
  try {
    const userId = await requireUserId()
    const patch = await parseBody(req, settingsUpdateSchema)

    const user = await db.user.findUnique({ where: { id: userId }, select: { settings: true } })
    if (!user) throw new ApiError(401, 'Sesi tidak valid. Silakan login ulang.', 'UNAUTHORIZED')

    const current = parseSettings(user.settings, ctx)
    // Key lama yang tidak dikenal tetap tersimpan; hanya key yang dikirim yang diubah.
    const merged = mergeSettings(current, patch as Record<string, unknown>)
    await db.user.update({
      where: { id: userId },
      data: { settings: JSON.stringify(merged) },
    })

    return NextResponse.json(merged)
  } catch (e) {
    return handleApiError(ctx, e)
  }
}
