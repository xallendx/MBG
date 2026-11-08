import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { handleApiError, requireUserId } from '@/lib/api'
import { parseSettings } from '@/lib/settings'

// POST /api/telegram/disconnect — putuskan koneksi Telegram user
export async function POST() {
  try {
    const userId = await requireUserId()

    const user = await db.user.findUnique({ where: { id: userId }, select: { settings: true } })
    if (!user) return NextResponse.json({ error: 'User tidak ditemukan' }, { status: 404 })

    const settings = parseSettings(user.settings, 'POST /api/telegram/disconnect')

    settings.telegramChatId = null
    settings.telegramName = null
    settings.telegramCode = null
    settings.telegramCodeExpiry = null
    settings.telegramConnected = false
    settings.telegramNotifEnabled = false

    await db.user.update({
      where: { id: userId },
      data: {
        telegramId: null, // kolom khusus ikut dibersihkan
        settings: JSON.stringify(settings),
      },
    })

    return NextResponse.json({ success: true })
  } catch (e) {
    return handleApiError('POST /api/telegram/disconnect', e)
  }
}
