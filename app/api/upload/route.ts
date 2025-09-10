import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File
    const orgId = formData.get('orgId') as string
    const appName = formData.get('appName') as string
    const fileType = formData.get('fileType') as string // 'contract' or 'vendor'

    if (!file || !orgId || !appName) {
      return NextResponse.json({ error: 'File, organization ID, and app name are required' }, { status: 400 })
    }

    // Define allowed file types
    const allowedTypes = [
      'application/pdf',
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]

    // Validate file type
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({
        error: 'Only PDF, CSV, Excel (.xlsx, .xls), and Word (.docx, .doc) files are allowed'
      }, { status: 400 })
    }

    // For contract files, maintain PDF-only restriction for backward compatibility
    if (fileType === 'contract' && file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Contract files must be PDF format' }, { status: 400 })
    }

    // Generate safe filename with timestamp for storage
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const fileExtension = file.name.split('.').pop() || 'bin'
    const safeName = `${appName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${timestamp}.${fileExtension}`

    // Determine file path based on file type
    const subFolder = fileType === 'vendor' ? 'vendor_files' : ''
    const filePath = subFolder
      ? `${orgId}/${appName}/${subFolder}/${safeName}`
      : `${orgId}/${appName}/${safeName}`
    
    // Preserve original filename for display
    const originalFileName = file.name

    // Convert File to ArrayBuffer
    const arrayBuffer = await file.arrayBuffer()
    const fileBuffer = new Uint8Array(arrayBuffer)

    // Upload file to Supabase storage
    const { data, error } = await supabaseServer.storage
      .from('organize-app-inbox-contracts')
      .upload(filePath, fileBuffer, {
        contentType: file.type,
        upsert: true
      })

    if (error) {
      console.error('Error uploading file:', error)
      return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 })
    }

    // Generate signed URL (expires in 1 hour)
    const { data: signedUrlData, error: signedUrlError } = await supabaseServer.storage
      .from('organize-app-inbox-contracts')
      .createSignedUrl(filePath, 3600)

    if (signedUrlError) {
      console.error('Error creating signed URL:', signedUrlError)
      return NextResponse.json({ error: 'Failed to create signed URL' }, { status: 500 })
    }

    return NextResponse.json({
      url: signedUrlData.signedUrl,
      filePath: filePath,
      fileName: originalFileName,
      storagePath: safeName
    })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
} 