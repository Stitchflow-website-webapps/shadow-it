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

// Function to sync managed status to all other Shadow IT orgs that share the same managed app list
async function syncStatusToOtherShadowOrgs(appName: string, managementStatus: string, allShadowOrgIds: string[], currentShadowOrgId: string) {
  try {
    console.log(`Syncing status ${managementStatus} for app ${appName} to other Shadow IT orgs`);
    
    // Get the current shadow org ID (the one that initiated the change)
    const currentShadowOrgIds = currentShadowOrgId.split(',').map((id: string) => id.trim());
    
    // Find other shadow org IDs that need to be synced (exclude the current one)
    const otherShadowOrgIds = allShadowOrgIds.filter(id => !currentShadowOrgIds.includes(id));
    
    if (otherShadowOrgIds.length === 0) {
      console.log(`No other Shadow IT orgs to sync for app ${appName}`);
      return;
    }
    
    console.log(`Found ${otherShadowOrgIds.length} other Shadow IT orgs to sync: ${otherShadowOrgIds.join(', ')}`);
    
    // Update the managed status in all other Shadow IT orgs
    for (const shadowOrgId of otherShadowOrgIds) {
      try {
        // Find apps with this name in the other Shadow IT org
        const { data: appsToUpdate, error: findAppsError } = await supabaseAdmin
          .from('applications')
          .select('id, name, organization_id')
          .eq('organization_id', shadowOrgId)
          .ilike('name', appName); // Use ilike for case-insensitive matching
        
        if (findAppsError) {
          console.error(`Error finding apps in Shadow IT org ${shadowOrgId}:`, findAppsError);
          continue;
        }
        
        if (!appsToUpdate || appsToUpdate.length === 0) {
          console.log(`App ${appName} not found in Shadow IT org ${shadowOrgId} - skipping`);
          continue;
        }
        
        // Update each matching app
        for (const appToUpdate of appsToUpdate) {
          const { error: updateError } = await supabaseAdmin
            .from('applications')
            .update({ management_status: managementStatus })
            .eq('id', appToUpdate.id);
          
          if (updateError) {
            console.error(`Error updating app ${appToUpdate.name} in Shadow IT org ${shadowOrgId}:`, updateError);
          } else {
            console.log(`Successfully synced status ${managementStatus} for app ${appToUpdate.name} in Shadow IT org ${shadowOrgId}`);
          }
        }
        
      } catch (error) {
        console.error(`Error syncing to Shadow IT org ${shadowOrgId}:`, error);
      }
    }
    
  } catch (error) {
    console.error('Error syncing status to other Shadow IT orgs:', error);
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

    // 2. Sync changes to the App Inbox 'apps' table
    // - For "Managed" status: Create app if not exists, or update if exists
    // - For "Unmanaged" and "Newly discovered": Only update if app exists, don't create new
    const integrations = await getIntegrations();
    
    for (const app of updatedApps) {
      // Sync to inbox based on status
      console.log(`Syncing app ${app.name} with status ${managementStatus} to App Inbox`);
      if (!app.organization_id) {
        console.warn(`Skipping app sync for ${app.name} because organization_id is missing.`);
        continue;
      }

      // Handle comma-separated shadow org IDs - find which org contains this shadow org ID
      const shadowOrgIds = app.organization_id.split(',').map((id: string) => id.trim()).filter((id: string) => id.length > 0)
      
      if (shadowOrgIds.length === 0) {
        console.warn(`Invalid shadow_org_id: ${app.organization_id}`);
        continue;
      }

      let organization = null
      let allShadowOrgIds: string[] = [];

      // Try each shadow org ID to find which one contains the shadow org ID
      for (const singleShadowOrgId of shadowOrgIds) {
        // First try exact match
        let { data: org, error: orgError } = await organizeDb
          .from('organizations')
          .select('id, shadow_org_id')
          .eq('shadow_org_id', singleShadowOrgId)
          .single();

        // If no exact match, try to find organizations that contain this shadow org ID in comma-separated list
        if (orgError || !org) {
          const { data: orgs, error: orgsError } = await organizeDb
            .from('organizations')
            .select('id, shadow_org_id')
            .not('shadow_org_id', 'is', null)

          if (!orgsError && orgs) {
            // Find organization that contains the shadow org ID in its comma-separated list
            const foundOrg = orgs.find(orgItem => {
              if (!orgItem.shadow_org_id) return false
              const orgShadowIds = orgItem.shadow_org_id.split(',').map((id: string) => id.trim())
              return orgShadowIds.includes(singleShadowOrgId)
            })
            
            if (foundOrg) {
              org = { id: foundOrg.id, shadow_org_id: foundOrg.shadow_org_id }
              orgError = null // Clear the error since we found a match
            }
          }
        }

        if (!orgError && org) {
          organization = org
          // Get all shadow org IDs from the managed app list organization
          if (org.shadow_org_id) {
            allShadowOrgIds = org.shadow_org_id.split(',').map((id: string) => id.trim()).filter((id: string) => id.length > 0);
          }
          break
        }
      }

      if (!organization) {
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
        console.log(`Updating existing app ${app.name} in App Inbox with status ${managementStatus}`);
        const { error: updateError } = await organizeDb
          .from('apps')
          .update({ managed_status: managementStatus })
          .eq('id', existingApp.id)
          .eq('org_id', organization.id);

        if (updateError) {
          console.error('Error updating app in App Inbox:', updateError);
        } else {
          console.log(`Successfully updated app ${app.name} in App Inbox`);
          
          // NEW: Sync status back to all other Shadow IT orgs that share this managed app list
          await syncStatusToOtherShadowOrgs(app.name, managementStatus, allShadowOrgIds, app.organization_id);
        }
      } else {
        // If app does not exist, only create it if status is "Managed"
        if (managementStatus === "Managed") {
          const integration = integrations.find(int => int.name.toLowerCase() === app.name.toLowerCase());
          const connectionStatus = integration ? integration.connectionStatus : "Yes - CSV Sync";

          console.log(`Creating new app ${app.name} in App Inbox with status ${managementStatus}`);
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
          } else {
            console.log(`Successfully created app ${app.name} in App Inbox`);
            
            // NEW: Sync status back to all other Shadow IT orgs that share this managed app list
            await syncStatusToOtherShadowOrgs(app.name, managementStatus, allShadowOrgIds, app.organization_id);
          }
        } else {
          console.log(`App ${app.name} not found in App Inbox and status is ${managementStatus} - skipping creation`);
          
          // NEW: Even if app doesn't exist in managed list, sync status to other shadow orgs if they have the app
          await syncStatusToOtherShadowOrgs(app.name, managementStatus, allShadowOrgIds, app.organization_id);
        }
      }
    }

    return NextResponse.json({ success: true, updatedCount: updatedApps.length });

  } catch (error) {
    console.error('Error in bulk update:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}