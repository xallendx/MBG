import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function POST() {
  const c = await cookies()
  c.delete('mbg_user_id')
  return NextResponse.json({ success: true })
}
