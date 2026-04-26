import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { sendTelegramMessage } from '@/lib/telegram'

export async function POST(req: NextRequest) {
  const userId = await requireUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { message } = await req.json()
    if (!message) {
      return NextResponse.json({ error: 'Message wajib diisi' }, { status: 400 })
    }

    // Find user's telegramChatId from settings
    const user = await db.user.findUnique({ where: { id: userId } })
    if (!user) return NextResponse.json({ error: 'User tidak ditemukan' }, { status: 404 })

    const settings = user.settings ? JSON.parse(user.settings) : {}
    const telegramChatId = settings.telegramChatId

    if (!telegramChatId) {
      return NextResponse.json({ error: 'Telegram belum dihubungkan. Buka Alat → Telegram untuk menghubungkan.' }, { status: 400 })
    }

    await sendTelegramMessage(telegramChatId, message)

    return NextResponse.json({ success: true, message: 'Notifikasi terkirim' })
  } catch (error) {
    console.error('Telegram notify error:', error)
    return NextResponse.json({ error: 'Gagal mengirim notifikasi: ' + (error instanceof Error ? error.message : String(error)) }, { status: 500 })
  }
}
