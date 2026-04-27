import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { clearAuthCookie } from '@/lib/auth'

export async function POST() {
  const res = NextResponse.json({ success: true })
  clearAuthCookie(res)
  // Also clear from request cookies for middleware consistency
  const c = await cookies()
  c.delete('mbg_user_id')
  return res
}
