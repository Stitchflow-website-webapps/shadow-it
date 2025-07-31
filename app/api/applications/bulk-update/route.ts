import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { organizeSupabaseAdmin } from '@/lib/supabase/organize-client';
import type { AppIntegration } from '@/hooks/use-app-integrations';

async function getIntegrations(): Promise<AppIntegration[]> {
  try {
    const response = await fetch(
      "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/stitchflow-intg%20list-K5UBvEAIl4xhSgVYxIckYWH6WsdxMh.csv",
    );
    const csvText = await response.text();
    const lines = csvText.split("\n");
    const data: AppIntegration[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const values = line.split(",").map((v) => v.trim().replace(/"/g, ""));
      if (values.length >= 2) {
        const name = values[0];
        const status = values[1];
        if (name && status) {
          let mappedStatus = "Not connected";
          if (status.toLowerCase().includes("csv") && status.toLowerCase().includes("api coming soon")) {
            mappedStatus = "Yes - CSV Sync";
          } else if (status.toLowerCase().includes("api")) {
            mappedStatus = "Yes - API";
          } else if (status.toLowerCase().includes("csv")) {
            mappedStatus = "Yes - CSV Sync";
          }
          data.push({ name, connectionStatus: mappedStatus });
        }
      }
    }
    return data;
  } catch (err) {
    console.error("Error fetching integrations for server-side creation:", err);
    return [];
  }
}

export async function PATCH(request: NextRequest) {
  const organizeDb = organizeSupabaseAdmin;
  try {
    const { appIds, managementStatus } = await request.json();

    if (!appIds || !Array.isArray(appIds) || appIds.length === 0 || !managementStatus) {
      return NextResponse.json({ error: 'appIds (array) and managementStatus are required' }, { status: 400 });
    }

    // 1. Update the main 'applications' table
    const { data: updatedApps, error: updateError } = await supabaseAdmin
      .from('applications')
      .update({ management_status: managementStatus })
      .in('id', appIds)
      .select('id, name, organization_id');

    if (updateError) {
      console.error('Error in bulk update of applications:', updateError);
      return NextResponse.json({ error: 'Failed to bulk update applications' }, { status: 500 });
    }

    if (!updatedApps) {
      return NextResponse.json({ error: 'No applications found to update' }, { status: 404 });
    }

    // 2. Sync changes to the App Inbox 'apps' table ONLY when status is "Managed"
    const integrations = await getIntegrations();
    
    for (const app of updatedApps) {
      // Only sync to inbox if the status is "Managed"
      if (managementStatus !== "Managed") {
        continue;
      }
      if (!app.organization_id) {
        console.warn(`Skipping app sync for ${app.name} because organization_id is missing.`);
        continue;
      }

      // First get the org_id from the organizations table using shadow_org_id
      const { data: organization, error: orgError } = await organizeDb
        .from('organizations')
        .select('id')
        .eq('shadow_org_id', app.organization_id)
        .single();

      if (orgError || !organization) {
        console.warn(`Organization not found for shadow_org_id: ${app.organization_id}`);
        continue;
      }

      // Check if the app already exists in the apps table
      const { data: existingApp, error: findError } = await organizeDb
        .from('apps')
        .select('id')
        .eq('name', app.name)
        .eq('org_id', organization.id)
        .single();

      if (findError && findError.code !== 'PGRST116') { // PGRST116: 'exact-one-row-not-found'
        console.error('Error finding app in App Inbox:', findError);
        continue;
      }

      // If app exists, update it
      if (existingApp) {
        const { error: updateError } = await organizeDb
          .from('apps')
          .update({ managed_status: managementStatus })
          .eq('id', existingApp.id)
          .eq('org_id', organization.id);

        if (updateError) {
          console.error('Error updating app in App Inbox:', updateError);
        }
      } else {
        // If app does not exist, create it
        const integration = integrations.find(int => int.name.toLowerCase() === app.name.toLowerCase());
        const connectionStatus = integration ? integration.connectionStatus : "Yes - CSV Sync";

        const { error: createError } = await organizeDb
          .from('apps')
          .insert({
            name: app.name,
            managed_status: managementStatus,
            org_id: organization.id,
            stitchflow_status: connectionStatus,
          });
        
        if (createError) {
          console.error('Error creating app in App Inbox:', createError);
        }
      }
    }

    return NextResponse.json({ success: true, updatedCount: updatedApps.length });

  } catch (error) {
    console.error('Error in bulk update:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 