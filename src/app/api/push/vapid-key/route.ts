import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'

// GET /api/push/vapid-key — return public VAPID key for push subscription
export async function GET() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''
  if (!publicKey) {
    return NextResponse.json({ error: 'Push not configured' }, { status: 500 })
  }
  return NextResponse.json({ publicKey })
}
