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



    // Get basic application data first
    console.log('Fetching applications for organization:', organizationId);
    
    const { data: applications, error: appError } = await supabaseAdmin
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

    if (appError) {
      console.error('Database error fetching applications:', appError);
      return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 });
    }

    if (!applications || applications.length === 0) {
      return NextResponse.json({ error: 'No data found for this organization' }, { status: 404 });
    }

    // Get user counts for each application efficiently
    console.log(`Processing user counts for ${applications.length} applications`);
    
    const finalData = await Promise.all(applications.map(async (app) => {
      try {
        // Get all user applications for this app
        const { data: userApps, error: userAppError } = await supabaseAdmin
          .from('user_applications')
          .select('user_id, scopes')
          .eq('application_id', app.id);

        if (userAppError) {
          console.error(`Error fetching user apps for ${app.id}:`, userAppError);
          return {
            ...app,
            high_risk_user_count: 0,
            total_user_count: 0
          };
        }

        // Count unique users
        const uniqueUsers = new Set(userApps?.map(ua => ua.user_id) || []);
        const totalUserCount = uniqueUsers.size;

        // Count high-risk users
        const highRiskUsers = new Set<string>();
        
        for (const userApp of userApps || []) {
          if (!userApp.scopes || !Array.isArray(userApp.scopes)) continue;
          
          const hasHighRiskScope = userApp.scopes.some((scope: string) => {
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
            highRiskUsers.add(userApp.user_id);
          }
        }

        return {
          ...app,
          high_risk_user_count: highRiskUsers.size,
          total_user_count: totalUserCount
        };
      } catch (error) {
        console.error(`Error processing app ${app.id}:`, error);
        return {
          ...app,
          high_risk_user_count: 0,
          total_user_count: 0
        };
      }
    }));

    // Sort by high risk user count descending, then by name
    finalData.sort((a, b) => {
      if (b.high_risk_user_count !== a.high_risk_user_count) {
        return b.high_risk_user_count - a.high_risk_user_count;
      }
      return (a.name || '').localeCompare(b.name || '');
    });

    console.log(`Processed ${finalData.length} applications. Sample data:`, {
      firstApp: finalData[0] ? {
        id: finalData[0].id,
        name: finalData[0].name,
        category: finalData[0].category,
        high_risk_user_count: finalData[0].high_risk_user_count,
        total_user_count: finalData[0].total_user_count
      } : 'No apps'
    });

    if (!finalData || finalData.length === 0) {
      return NextResponse.json({ error: 'No data found for this organization' }, { status: 404 });
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
      'High Risk User Count',
      'Total User Count'
    ];

    // Helper function to safely escape CSV values
    const escapeCsvValue = (value: any): string => {
      if (value === null || value === undefined) {
        return '';
      }
      
      const stringValue = String(value);
      
      // If the value contains comma, newline, or quotes, wrap it in quotes and escape internal quotes
      if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('\r') || stringValue.includes('"')) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      
      return stringValue;
    };

    // Process data and create CSV rows with proper escaping
    const csvRows = finalData.map((row: any) => {
      console.log(`Processing row for app: ${row.name} (${row.id})`);
      
      return [
        escapeCsvValue(row.id),
        escapeCsvValue(row.organization_id),
        escapeCsvValue(row.google_app_id),
        escapeCsvValue(row.name),
        escapeCsvValue(row.category),
        escapeCsvValue(row.risk_level),
        escapeCsvValue(row.management_status),
        escapeCsvValue(row.total_permissions),
        escapeCsvValue(row.created_at),
        escapeCsvValue(row.updated_at),
        escapeCsvValue(Array.isArray(row.all_scopes) ? row.all_scopes.join('; ') : row.all_scopes),
        escapeCsvValue(row.microsoft_app_id),
        escapeCsvValue(row.category_status),
        escapeCsvValue(row.provider),
        escapeCsvValue(row.high_risk_user_count || 0),
        escapeCsvValue(row.total_user_count || 0)
      ];
    });

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