import { NextRequest, NextResponse } from 'next/server'
import { organizeSupabaseAdmin } from '@/lib/supabase/organize-client'

// PATCH - Update vendor file label
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; fileId: string } }
) {
  try {
    const { label }: { label: string } = await request.json()

    if (typeof label !== 'string') {
      return NextResponse.json({ error: 'Label must be a string' }, { status: 400 })
    }

    // Get current vendor files
    const { data: app, error: fetchError } = await organizeSupabaseAdmin
      .from('apps')
      .select('vendor_files')
      .eq('id', params.id)
      .single()

    if (fetchError) {
      console.error('Error fetching app:', fetchError)
      return NextResponse.json({ error: 'Failed to fetch app' }, { status: 500 })
    }

    if (!app) {
      return NextResponse.json({ error: 'App not found' }, { status: 404 })
    }

    const currentFiles = app.vendor_files || []
    const fileIndex = currentFiles.findIndex(f => f.id === params.fileId)

    if (fileIndex === -1) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    // Update the file label
    const updatedFiles = [...currentFiles]
    updatedFiles[fileIndex] = {
      ...updatedFiles[fileIndex],
      label: label.trim()
    }

    // Update the database
    const { error: updateError } = await organizeSupabaseAdmin
      .from('apps')
      .update({
        vendor_files: updatedFiles,
        vendor_files_limit: updatedFiles.length,
        updated_at: new Date().toISOString()
      })
      .eq('id', params.id)

    if (updateError) {
      console.error('Error updating vendor file label:', updateError)
      return NextResponse.json({ error: 'Failed to update file label' }, { status: 500 })
    }

    return NextResponse.json({ 
      message: 'File label updated successfully',
      vendorFiles: updatedFiles
    })
  } catch (error) {
    console.error('Error in PATCH vendor file:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
