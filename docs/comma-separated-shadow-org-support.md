# Comma-Separated Shadow Org ID Support

## Overview

This feature enables a single organization in the `organize-app-inbox` schema to represent multiple shadow-it organizations. This is particularly useful for cases like Zurabio, where the app list data needs to be shown for multiple shadow-it organizations.

## Background

Previously, each organization in the `organize-app-inbox` schema could only be linked to a single shadow-it organization via the `shadow_org_id` field. This created limitations when:

1. A single company has multiple shadow-it organization records
2. Data needs to be consolidated across multiple shadow-it organizations
3. The app list should show combined data from multiple sources

## Implementation

### Database Schema

The `shadow_org_id` field in the `organizations` table now supports comma-separated values:

```sql
-- Example: Organization linked to multiple shadow-it orgs
UPDATE "organize-app-inbox".organizations 
SET shadow_org_id = 'shadow-org-1,shadow-org-2,shadow-org-3'
WHERE id = 'your-org-id';
```

### API Changes

#### 1. Apps API (`/api/organize/apps`)

**GET Request:**
- Accepts comma-separated `shadowOrgId` parameter
- Fetches apps from all provided shadow organizations
- Merges and deduplicates apps based on name
- Returns apps with `source_shadow_org_id` field for tracking

**POST Request:**
- Uses the first valid shadow org ID for creating new apps
- Returns created app with `source_shadow_org_id` field

**PUT Request:**
- Finds the correct organization containing the app
- Updates the app in the appropriate organization
- Returns updated app with `source_shadow_org_id` field

**DELETE Request:**
- Finds the correct organization containing the app
- Deletes the app from the appropriate organization

#### 2. Organization API (`/api/organize/organization`)

**GET Request:**
- Returns settings from the first available organization
- Includes `source_shadow_org_id` field indicating which shadow org was used

**PUT Request:**
- Updates settings for all organizations matching the shadow org IDs
- Returns the last successfully updated organization

### Frontend Changes

The app list page (`/app-list/page.tsx`) automatically handles:
- Merged app data from multiple organizations
- Deduplication based on app names
- Organization settings from the first available organization
- All existing functionality without requiring UI changes

## Usage Examples

### Setting Up Comma-Separated Shadow Org IDs

```sql
-- Find your organization
SELECT * FROM "organize-app-inbox".organizations 
WHERE name ILIKE '%zurabio%';

-- Update to support multiple shadow orgs
UPDATE "organize-app-inbox".organizations 
SET shadow_org_id = 'shadow-org-1,shadow-org-2'
WHERE id = 'your-organize-org-id';
```

### API Usage

```javascript
// Fetch apps from multiple shadow organizations
const response = await fetch('/api/organize/apps?shadowOrgId=org1,org2,org3');
const apps = await response.json();

// Apps now include source_shadow_org_id for tracking
apps.forEach(app => {
  console.log(`${app.name} from ${app.source_shadow_org_id}`);
});
```

### Testing

Use the provided test script to verify functionality:

```bash
# Test the comma-separated shadow org ID support
node scripts/test-comma-separated-shadow-orgs.js

# Show setup instructions
node scripts/test-comma-separated-shadow-orgs.js --setup
```

## Data Handling

### App Deduplication

When apps with the same name exist across multiple shadow organizations:
- The app with the most recent `updated_at` timestamp is kept
- Other duplicates are filtered out
- The `source_shadow_org_id` indicates which organization the final app came from

### Organization Settings

When fetching organization settings:
- The first available organization's settings are returned
- If settings need to be updated, all organizations are updated
- This ensures consistent settings across all linked shadow organizations

## Benefits

1. **Unified View**: Users see a single, consolidated app list
2. **Data Integrity**: Automatic deduplication prevents duplicate entries
3. **Backward Compatibility**: Existing single shadow org ID setups continue to work
4. **Source Tracking**: Each app includes information about its origin
5. **Flexible Management**: Settings can be updated across all linked organizations

## Limitations

1. **Settings Consistency**: All linked organizations will have the same identity and email provider settings
2. **App Ownership**: Apps are stored in one of the linked organizations, not distributed
3. **Performance**: Multiple database queries are required for comma-separated values

## Migration Guide

### For Existing Organizations

No migration is required. Existing organizations with single shadow org IDs continue to work without changes.

### For New Multi-Org Setups

1. Identify the shadow org IDs that need to be linked
2. Update the `shadow_org_id` field with comma-separated values
3. Test the app list to ensure data appears correctly
4. Verify organization settings are applied consistently

### Example Migration Script

```javascript
// Example: Link Zurabio's multiple shadow organizations
const shadowOrgIds = ['zurabio-main-org', 'zurabio-subsidiary-org'];
const commaSeparatedIds = shadowOrgIds.join(',');

await organizeSupabaseAdmin
  .from('organizations')
  .update({ shadow_org_id: commaSeparatedIds })
  .eq('id', 'zurabio-organize-org-id');
```

## Monitoring and Troubleshooting

### Logging

The API endpoints log warnings for:
- Shadow org IDs that don't match any organization
- Failed database queries for specific shadow orgs
- Deduplication activities

### Common Issues

1. **No Apps Appearing**: Verify shadow org IDs are correct and organizations exist
2. **Duplicate Apps**: Check if deduplication logic is working correctly
3. **Settings Not Updating**: Ensure all linked organizations are being updated

### Debugging

```javascript
// Check which shadow orgs are linked
const { data: org } = await organizeSupabaseAdmin
  .from('organizations')
  .select('shadow_org_id')
  .eq('id', 'your-org-id')
  .single();

console.log('Linked shadow orgs:', org.shadow_org_id.split(','));
```

## Security Considerations

- All shadow org IDs must belong to the same authenticated user's organization
- API endpoints validate access to all provided shadow org IDs
- Source tracking helps identify data origins for auditing

## Future Enhancements

1. **Performance Optimization**: Batch database queries for better performance
2. **Advanced Deduplication**: More sophisticated merging rules for conflicting data
3. **Settings Inheritance**: Different settings for different shadow organizations
4. **Analytics**: Tracking of app usage across multiple shadow organizations

---

**Status**: Implemented and Ready for Production  
**Version**: 1.0  
**Last Updated**: 2024-12-19  
**Affected Components**: Apps API, Organization API, App List UI
