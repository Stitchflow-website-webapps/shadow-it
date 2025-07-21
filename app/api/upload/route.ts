import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File
    const orgId = formData.get('orgId') as string
    const appName = formData.get('appName') as string

    if (!file || !orgId || !appName) {
      return NextResponse.json({ error: 'File, organization ID, and app name are required' }, { status: 400 })
    }

    // Validate file type
    if (file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Only PDF files are allowed' }, { status: 400 })
    }

    // Validate file size (10MB limit)
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'File size must be less than 10MB' }, { status: 400 })
    }

    // Generate safe filename with timestamp for storage
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const safeName = `${appName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${timestamp}.pdf`
    const filePath = `${orgId}/${appName}/${safeName}`
    
    // Preserve original filename for display
    const originalFileName = file.name

    // Convert File to ArrayBuffer
    const arrayBuffer = await file.arrayBuffer()
    const fileBuffer = new Uint8Array(arrayBuffer)

    // Upload file to Supabase storage
    const { data, error } = await supabaseServer.storage
      .from('organize-app-inbox-contracts')
      .upload(filePath, fileBuffer, {
        contentType: 'application/pdf',
        upsert: true
      })

    if (error) {
      console.error('Error uploading file:', error)
      return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 })
    }

    // Get public URL
    const { data: urlData } = supabaseServer.storage
      .from('organize-app-inbox-contracts')
      .getPublicUrl(filePath)

    return NextResponse.json({
      url: urlData.publicUrl,
      filePath: filePath,
      fileName: originalFileName,
      storagePath: safeName
    })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
} 