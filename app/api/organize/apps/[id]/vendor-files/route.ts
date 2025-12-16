import { NextRequest, NextResponse } from 'next/server'
import { organizeSupabaseAdmin } from '@/lib/supabase/organize-client'
import { supabaseServer } from '@/lib/supabase-server'
import type { VendorFile } from '@/lib/supabase/organize-client'

// GET - Retrieve vendor files for an app
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { data: app, error } = await organizeSupabaseAdmin
      .from('apps')
      .select('vendor_files')
      .eq('id', params.id)
      .single()

    if (error) {
      console.error('Error fetching app vendor files:', error)
      return NextResponse.json({ error: 'Failed to fetch vendor files' }, { status: 500 })
    }

    if (!app) {
      return NextResponse.json({ error: 'App not found' }, { status: 404 })
    }

    return NextResponse.json({ vendorFiles: app.vendor_files || [] })
  } catch (error) {
    console.error('Error in GET vendor files:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Add a new vendor file
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { vendorFile }: { vendorFile: VendorFile } = await request.json()

    if (!vendorFile) {
      return NextResponse.json({ error: 'Vendor file data is required' }, { status: 400 })
    }

    // Get current vendor files
    const { data: app, error: fetchError } = await organizeSupabaseAdmin
      .from('apps')
      .select('vendor_files, vendor_files_limit')
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
    const limit = app.vendor_files_limit || 5

    // Check file limit
    if (currentFiles.length >= limit) {
      return NextResponse.json({ 
        error: `Maximum of ${limit} vendor files allowed` 
      }, { status: 400 })
    }

    // Add the new file
    const updatedFiles = [...currentFiles, vendorFile]

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
      console.error('Error updating vendor files:', updateError)
      return NextResponse.json({ error: 'Failed to add vendor file' }, { status: 500 })
    }

    return NextResponse.json({ 
      message: 'Vendor file added successfully',
      vendorFiles: updatedFiles
    })
  } catch (error) {
    console.error('Error in POST vendor files:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Remove a vendor file
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(request.url)
    const fileId = searchParams.get('fileId')

    if (!fileId) {
      return NextResponse.json({ error: 'File ID is required' }, { status: 400 })
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
    const fileToDelete = currentFiles.find(f => f.id === fileId)

    if (!fileToDelete) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    // Remove file from storage
    try {
      const { error: deleteFileError } = await supabaseServer.storage
        .from('organize-app-inbox-contracts')
        .remove([fileToDelete.filePath])

      if (deleteFileError) {
        console.error('Error deleting file from storage:', deleteFileError)
        // Continue with database update even if file deletion fails
      }
    } catch (storageError) {
      console.error('Storage deletion error:', storageError)
      // Continue with database update
    }

    // Remove file from array
    const updatedFiles = currentFiles.filter(f => f.id !== fileId)

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
      console.error('Error updating vendor files:', updateError)
      return NextResponse.json({ error: 'Failed to remove vendor file' }, { status: 500 })
    }

    return NextResponse.json({ 
      message: 'Vendor file removed successfully',
      vendorFiles: updatedFiles
    })
  } catch (error) {
    console.error('Error in DELETE vendor files:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
