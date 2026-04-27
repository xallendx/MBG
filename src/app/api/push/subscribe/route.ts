import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireCurrentUser } from '@/lib/auth'

// POST /api/push/subscribe — save push subscription
export async function POST(req: NextRequest) {
  try {
    const user = await requireCurrentUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { endpoint, keys } = body

    if (!endpoint || !keys || !keys.auth || !keys.p256dh) {
      return NextResponse.json({ error: 'Invalid subscription data' }, { status: 400 })
    }

    // Security: prevent subscription hijacking — check ownership before upsert
    const existing = await db.pushSubscription.findUnique({ where: { endpoint } })
    if (existing && existing.userId !== user.id) {
      // Another user owns this endpoint — reject
      return NextResponse.json({ error: 'Subscription belongs to another user' }, { status: 403 })
    }

    if (existing) {
      // Update existing subscription for this user
      await db.pushSubscription.update({
        where: { endpoint },
        data: { keys: JSON.stringify(keys) }
      })
    } else {
      // Create new subscription
      await db.pushSubscription.create({
        data: {
          userId: user.id,
          endpoint,
          keys: JSON.stringify(keys),
        }
      })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}

// DELETE /api/push/subscribe — remove push subscription
export async function DELETE(req: NextRequest) {
  try {
    const user = await requireCurrentUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { endpoint } = body

    if (!endpoint) {
      return NextResponse.json({ error: 'Endpoint required' }, { status: 400 })
    }

    await db.pushSubscription.deleteMany({
      where: { userId: user.id, endpoint }
    })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}
