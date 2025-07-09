import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function POST(request: NextRequest) {
  try {
    const { filePath } = await request.json()

    if (!filePath) {
      return NextResponse.json({ error: 'File path is required' }, { status: 400 })
    }

    // Generate signed URL (expires in 1 hour)
    const { data, error } = await supabaseServer.storage
      .from('organize-app-inbox-contracts')
      .createSignedUrl(filePath, 3600)

    if (error) {
      console.error('Error creating signed URL:', error)
      return NextResponse.json({ error: 'Failed to create signed URL' }, { status: 500 })
    }

    return NextResponse.json({ signedUrl: data.signedUrl })
  } catch (error) {
    console.error('Signed URL error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
} 