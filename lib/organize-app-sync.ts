import { organizeSupabaseAdmin } from '@/lib/supabase/organize-client';
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

interface ShadowItApp {
  name: string;
  management_status: string;
  // This interface can be expanded with other fields from shadow-it.applications if needed later.
}

interface ShadowItOrg {
  id: string;
  name: string;
  // This interface can be expanded with other fields from shadow-it.organizations if needed later.
}

let stitchflowIntegrations: Map<string, string>;

/**
 * Reads and parses the stitchflow integration CSV file.
 * The result is cached in memory to avoid repeated file I/O.
 */
function getStitchflowIntegrations() {
  if (stitchflowIntegrations) {
    return stitchflowIntegrations;
  }

  try {
    const csvFilePath = path.resolve(process.cwd(), 'stitchflow_integration_list.csv');
    const fileContent = fs.readFileSync(csvFilePath, { encoding: 'utf-8' });
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
    });

    stitchflowIntegrations = new Map<string, string>();
    for (const record of records as any[]) {
      const appName = record['Stitchflow integrations supported'];
      let connectionStatus = record['Stitchflow connection status'];

      if (connectionStatus === 'API') {
        connectionStatus = 'Yes - API';
      } else if (connectionStatus?.startsWith('CSV')) { 
        connectionStatus = 'Yes - CSV Sync';
      }

      if (appName && connectionStatus) {
        stitchflowIntegrations.set(appName.toLowerCase(), connectionStatus);
      }
    }
    console.log(`[OrganizeAppSync] Loaded ${stitchflowIntegrations.size} Stitchflow integrations.`);
  } catch (error) {
    console.error('[OrganizeAppSync] Error reading or parsing stitchflow_integration_list.csv:', error);
    stitchflowIntegrations = new Map<string, string>();
  }
  
  return stitchflowIntegrations;
}

/**
 * Syncs newly discovered applications from the main 'shadow-it' schema to the 'organize-app-inbox' schema.
 * @param newlyDiscoveredApps - An array of new application objects from the shadow-it cron job.
 * @param shadowItOrg - The organization object from the shadow-it schema.
 */
export async function syncNewAppsToOrganizeInbox(
  newlyDiscoveredApps: ShadowItApp[],
  shadowItOrg: ShadowItOrg
) {
  console.log(`[OrganizeAppSync] Starting sync for org: ${shadowItOrg.name} (${shadowItOrg.id})`);
  if (!newlyDiscoveredApps || newlyDiscoveredApps.length === 0) {
    console.log('[OrganizeAppSync] No new apps to sync.');
    return;
  }

  try {
    // 1. Find or create the corresponding organization in the 'organize-app-inbox' schema.
    let { data: organizeOrg, error: findOrgError } = await organizeSupabaseAdmin
      .from('organizations')
      .select('id, name')
      .eq('shadow_org_id', shadowItOrg.id)
      .single();

    if (findOrgError && findOrgError.code !== 'PGRST116') { // PGRST116 indicates "no rows returned" which is not an error here.
      console.error(`[OrganizeAppSync] Error finding organization for shadow_org_id ${shadowItOrg.id}:`, findOrgError);
      return; // Fail gracefully as requested.
    }

    if (!organizeOrg) {
      console.log(`[OrganizeAppSync] Organization with shadow_org_id ${shadowItOrg.id} not found. Creating it.`);
      const { data: newOrganizeOrg, error: createOrgError } = await organizeSupabaseAdmin
        .from('organizations')
        .insert({
          name: `${shadowItOrg.name}'s Organization`,
          shadow_org_id: shadowItOrg.id,
          identity_provider: 'EMPTY',
          email_provider: 'EMPTY'
        })
        .select('id, name')
        .single();

      if (createOrgError) {
        console.error(`[OrganizeAppSync] Could not create organization for shadow_org_id ${shadowItOrg.id}:`, createOrgError);
        return;
      }
      organizeOrg = newOrganizeOrg;
      console.log(`[OrganizeAppSync] Successfully created organization: ${organizeOrg.name} (${organizeOrg.id})`);
    } else {
        console.log(`[OrganizeAppSync] Found corresponding organization: ${organizeOrg.name} (${organizeOrg.id})`);
    }

    if (!organizeOrg) {
        console.error(`[OrganizeAppSync] Failed to find or create an organization in organize-app-inbox.`);
        return;
    }

    // 2. Prepare and insert the new applications.
    const integrations = getStitchflowIntegrations();
    
    const { data: existingApps, error: existingAppsError } = await organizeSupabaseAdmin
      .from('apps')
      .select('name')
      .eq('org_id', organizeOrg.id);

    if (existingAppsError) {
        console.error(`[OrganizeAppSync] Could not fetch existing apps for org ${organizeOrg.id} to check for duplicates:`, existingAppsError);
        return;
    }
    const existingAppNames = new Set(existingApps.map(app => app.name.toLowerCase()));

    const appsToInsert = [];
    for (const app of newlyDiscoveredApps) {
      if (existingAppNames.has(app.name.toLowerCase())) {
        console.log(`[OrganizeAppSync] App "${app.name}" already exists for this org. Skipping.`);
        continue;
      }
      
      const appNameLower = app.name.toLowerCase();
      const connectionStatus = integrations.get(appNameLower) || 'Not connected';

      appsToInsert.push({
        name: app.name,
        org_id: organizeOrg.id,
        managed_status: app.management_status,
        stitchflow_status: connectionStatus,
      });
    }

    if (appsToInsert.length > 0) {
      console.log(`[OrganizeAppSync] Inserting ${appsToInsert.length} new app(s) into organize-app-inbox.`);
      const { error: insertAppsError } = await organizeSupabaseAdmin
        .from('apps')
        .insert(appsToInsert);

      if (insertAppsError) {
        console.error(`[OrganizeAppSync] Error inserting new apps into organize-app-inbox:`, insertAppsError);
      } else {
        console.log(`[OrganizeAppSync] Successfully inserted ${appsToInsert.length} app(s).`);
      }
    } else {
        console.log('[OrganizeAppSync] No new applications to insert after de-duplication.');
    }

    console.log(`[OrganizeAppSync] Sync process completed for org: ${shadowItOrg.name}`);

  } catch (error) {
    console.error('[OrganizeAppSync] An unexpected error occurred during the sync process:', error);
  }
} 