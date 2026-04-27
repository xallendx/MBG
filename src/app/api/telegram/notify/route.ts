import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { sendTelegramMessage } from '@/lib/telegram'

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUser()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { message } = await req.json()
    if (!message) {
      return NextResponse.json({ error: 'Message wajib diisi' }, { status: 400 })
    }

    // Find user's telegramChatId from settings
    const user = await db.user.findUnique({ where: { id: userId } })
    if (!user) return NextResponse.json({ error: 'User tidak ditemukan' }, { status: 404 })

    let settings: Record<string, unknown> = {}
    if (user.settings) {
      try { settings = JSON.parse(user.settings) } catch { settings = {} }
    }
    const telegramChatId = settings.telegramChatId

    if (!telegramChatId) {
      return NextResponse.json({ error: 'Telegram belum dihubungkan. Buka Alat → Telegram untuk menghubungkan.' }, { status: 400 })
    }

    // HTML-escape the message content before sending as HTML
    const safeMessage = escHtml(typeof message === 'string' ? message : JSON.stringify(message))
    await sendTelegramMessage(telegramChatId as string | number, safeMessage)

    return NextResponse.json({ success: true, message: 'Notifikasi terkirim' })
  } catch {
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}
