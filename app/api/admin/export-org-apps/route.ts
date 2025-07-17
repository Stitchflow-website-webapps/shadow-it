import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    // Get the request body
    const { organizationId } = await request.json();

    if (!organizationId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }

    // Get user email from cookies to verify it's success@stitchflow.io
    const userEmail = request.cookies.get('userEmail')?.value;
    
    if (userEmail !== 'success@stitchflow.io') {
      return NextResponse.json({ error: 'Unauthorized access' }, { status: 403 });
    }



    // Execute the query using direct SQL since we need complex joins
    const { data, error } = await supabaseAdmin
      .from('applications')
      .select(`
        id,
        organization_id,
        google_app_id,
        name,
        category,
        risk_level,
        management_status,
        total_permissions,
        created_at,
        updated_at,
        all_scopes,
        microsoft_app_id,
        category_status,
        provider,
        user_count,
        owner_email,
        notes,
        ai_risk_score
      `)
      .eq('organization_id', organizationId)
      .order('name');

    if (error) {
      console.error('Database error:', error);
      return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 });
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'No data found for this organization' }, { status: 404 });
    }

    // Get high-risk user counts for each application
    const highRiskCounts = new Map<string, number>();
    
    for (const app of data) {
      try {
        const { data: userApps, error: userAppsError } = await supabaseAdmin
          .from('user_applications')
          .select(`
            scopes,
            user:users!inner(id)
          `)
          .eq('application_id', app.id);

        if (userAppsError) {
          console.error(`Error fetching user apps for ${app.id}:`, userAppsError);
          highRiskCounts.set(app.id, 0);
          continue;
        }

        let highRiskUserCount = 0;
        const processedUsers = new Set<string>();

        for (const userApp of userApps || []) {
          if (!userApp.scopes || !userApp.user) continue;
          
          const userId = (userApp.user as any).id;
          if (processedUsers.has(userId)) continue; // Count each user only once per app
          processedUsers.add(userId);

          const scopes = Array.isArray(userApp.scopes) ? userApp.scopes : [userApp.scopes];
          
          // Check for high-risk scopes
          const hasHighRiskScope = scopes.some((scope: string) => {
            // Google high-risk scopes
            if (scope.includes('admin') || 
                scope.includes('gmail') || 
                scope.includes('drive') || 
                scope.includes('cloud-platform') ||
                scope === 'https://mail.google.com/') {
              return true;
            }
            
            // Microsoft high-risk scopes (exact matches)
            const microsoftHighRiskScopes = [
              'Application.ReadWrite.All',
              'User.ReadWrite.All',
              'Group.ReadWrite.All',
              'Directory.ReadWrite.All',
              'Mail.ReadWrite',
              'Mail.ReadWrite.All',
              'Mail.Send',
              'Files.ReadWrite.All',
              'Sites.ReadWrite.All',
              'MailboxSettings.ReadWrite'
            ];
            
            if (microsoftHighRiskScopes.includes(scope)) {
              return true;
            }
            
            // Microsoft high-risk scope patterns
            if (scope.includes('ReadWrite.All') ||
                scope.includes('ReadWrite') ||
                scope.includes('FullControl') ||
                scope.includes('Write.All')) {
              return true;
            }
            
            return false;
          });

          if (hasHighRiskScope) {
            highRiskUserCount++;
          }
        }

        highRiskCounts.set(app.id, highRiskUserCount);
      } catch (err) {
        console.error(`Error processing high-risk users for app ${app.id}:`, err);
        highRiskCounts.set(app.id, 0);
      }
    }

    // Convert data to CSV format
    const csvHeaders = [
      'ID',
      'Organization ID',
      'Google App ID',
      'Name',
      'Category',
      'Risk Level',
      'Management Status',
      'Total Permissions',
      'Created At',
      'Updated At',
      'All Scopes',
      'Microsoft App ID',
      'Category Status',
      'Provider',
      'User Count',
      'Owner Email',
      'Notes',
      'AI Risk Score',
      'High Risk User Count'
    ];

    const csvRows = data.map((row: any) => [
      row.id || '',
      row.organization_id || '',
      row.google_app_id || '',
      `"${(row.name || '').replace(/"/g, '""')}"`, // Escape quotes in name
      row.category || '',
      row.risk_level || '',
      row.management_status || '',
      row.total_permissions || '',
      row.created_at || '',
      row.updated_at || '',
      `"${(row.all_scopes || '').replace(/"/g, '""')}"`, // Escape quotes in scopes
      row.microsoft_app_id || '',
      row.category_status || '',
      row.provider || '',
      row.user_count || '',
      row.owner_email || '',
      `"${(row.notes || '').replace(/"/g, '""')}"`, // Escape quotes in notes
      row.ai_risk_score || '',
      highRiskCounts.get(row.id) || 0
    ]);

    const csvContent = [csvHeaders, ...csvRows]
      .map(row => row.join(','))
      .join('\n');

    // Get organization name for filename
    const { data: orgData } = await supabaseAdmin
      .from('organizations')
      .select('name, domain')
      .eq('id', organizationId)
      .single();

    const orgName = orgData?.name || orgData?.domain || 'unknown';
    const filename = `org-apps-${orgName}-${new Date().toISOString().split('T')[0]}.csv`;

    // Return CSV file
    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });

  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 