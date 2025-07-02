import { NextRequest, NextResponse } from 'next/server';
import { supabaseAIAdmin } from '@/lib/supabase-ai-schema';

export async function POST(request: NextRequest) {
  try {
    // Get org_id from header
    const orgId = request.headers.get('x-org-id');
    
    if (!orgId) {
      return NextResponse.json({ error: 'Missing x-org-id header' }, { status: 400 });
    }

    // Get the CSV content from form data
    const formData = await request.formData();
    const csvFile = formData.get('csv');
    
    if (!csvFile) {
      return NextResponse.json({ error: 'Missing CSV file' }, { status: 400 });
    }

    // Check if csvFile is actually a File object
    if (!(csvFile instanceof File)) {
      return NextResponse.json({ error: 'Invalid file format. Please upload a CSV file.' }, { status: 400 });
    }

    // Read and parse CSV content
    let csvContent: string;
    try {
      csvContent = await csvFile.text();
    } catch (error) {
      console.error('Error reading CSV file:', error);
      return NextResponse.json({ error: 'Failed to read CSV file' }, { status: 400 });
    }
    const lines = csvContent.split('\n').filter(line => line.trim());
    
    if (lines.length === 0) {
      return NextResponse.json({ error: 'Empty CSV file' }, { status: 400 });
    }

    // Parse CSV header to find tool name column
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
    const toolNameColumnIndex = headers.findIndex(h => 
      h.includes('tool') || h.includes('app') || h.includes('application') || h.includes('name')
    );

    if (toolNameColumnIndex === -1) {
      return NextResponse.json({ 
        error: 'Could not find tool name column. Expected column names: tool, app, application, or name' 
      }, { status: 400 });
    }

    // Extract tool names from CSV data rows
    const toolNames = [];
    for (let i = 1; i < lines.length; i++) {
      const row = lines[i].split(',');
      if (row[toolNameColumnIndex]) {
        const toolName = row[toolNameColumnIndex].trim().replace(/"/g, '');
        if (toolName) {
          toolNames.push(toolName);
        }
      }
    }

    console.log(`Processing ${toolNames.length} tool names for org ${orgId}`);

    // Query ai_risk_scores table to find matching tools
    const { data: riskScores, error: queryError } = await supabaseAIAdmin
      .from('ai_risk_scores')
      .select('app_id, "Tool Name"')
      .in('"Tool Name"', toolNames);

    if (queryError) {
      console.error('Error querying ai_risk_scores:', queryError);
      return NextResponse.json({ error: 'Failed to query risk scores' }, { status: 500 });
    }

    if (!riskScores || riskScores.length === 0) {
      return NextResponse.json({ 
        message: 'No matching tools found in ai_risk_scores table',
        processed: 0,
        matched: 0,
        toolNames: toolNames
      });
    }

    // Prepare data for insertion into org_apps table
    const orgAppsData = riskScores.map(score => ({
      org_id: orgId,
      app_id: score.app_id
    }));

    // Insert into org_apps table (using upsert to handle duplicates)
    const { data: insertedData, error: insertError } = await supabaseAIAdmin
      .from('org_apps')
      .upsert(orgAppsData, { 
        onConflict: 'org_id,app_id',
        ignoreDuplicates: true 
      })
      .select();

    if (insertError) {
      console.error('Error inserting into org_apps:', insertError);
      return NextResponse.json({ error: 'Failed to insert organization apps' }, { status: 500 });
    }

    // Create response with detailed results
    const matchedTools = riskScores.map(score => score["Tool Name"]);
    const unmatchedTools = toolNames.filter(name => !matchedTools.includes(name));

    return NextResponse.json({
      success: true,
      message: 'CSV processed successfully',
      results: {
        totalToolsInCsv: toolNames.length,
        matchedTools: matchedTools.length,
        unmatchedTools: unmatchedTools.length,
        insertedRecords: insertedData?.length || 0
      },
      details: {
        matchedTools: matchedTools,
        unmatchedTools: unmatchedTools
      }
    });

  } catch (error) {
    console.error('Error processing CSV import:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 