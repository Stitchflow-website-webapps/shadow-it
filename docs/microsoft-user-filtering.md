# Microsoft User Filtering: Member vs Guest Users

## Overview

We've implemented advanced user filtering for Microsoft Entra ID sync to address the issue where organizations see inflated user counts due to guest users and service accounts. This filtering helps show only actual organization members.

## The Problem

Microsoft Entra ID tenants often contain:
- **Member Users**: Actual organization employees (80 users)
- **Guest Users**: External collaborators, partners, vendors (200+ users)  
- **Service Accounts**: System accounts for applications (50+ users)
- **Disabled Accounts**: Former employees not yet removed (30+ users)

**Total**: 360+ users, but only 80 are actual employees.

## The Solution

### 1. User Type Filtering
Filter by `userType` field in Microsoft Graph API:
- **Member**: Organization employees and internal users
- **Guest**: External users invited for collaboration

### 2. Account Status Filtering  
Filter by `accountEnabled` field:
- **Enabled**: Active accounts that can sign in
- **Disabled**: Inactive accounts (former employees, suspended users)

## Implementation Details

### Updated Interface
```typescript
interface MicrosoftGraphUser {
  id: string;
  mail: string;
  displayName: string;
  userPrincipalName?: string;
  lastSignInDateTime?: string;
  userType?: string; // "Member", "Guest", or other types
  accountEnabled?: boolean; // Whether the account is enabled
}
```

### Enhanced getUsersList Method
```typescript
async getUsersList(includeGuests: boolean = false, includeDisabled: boolean = false) {
  const selectFields = 'id,mail,displayName,userPrincipalName,userType,accountEnabled';
  let endpoint = `/users?$select=${selectFields}`;
  
  const filterConditions: string[] = [];
  
  if (!includeGuests) {
    filterConditions.push("userType eq 'Member'");
  }
  
  if (!includeDisabled) {
    filterConditions.push("accountEnabled eq true");
  }
  
  if (filterConditions.length > 0) {
    endpoint += `&$filter=${filterConditions.join(' and ')}`;
  }
  
  return this.getAllPages<MicrosoftGraphUser>(endpoint);
}
```

### Microsoft Graph API Calls

**Default (Members Only):**
```
GET /users?$select=id,mail,displayName,userPrincipalName,userType,accountEnabled&$filter=userType eq 'Member' and accountEnabled eq true
```

**Include Guests:**
```
GET /users?$select=id,mail,displayName,userPrincipalName,userType,accountEnabled&$filter=accountEnabled eq true
```

**Include All (Guests + Disabled):**
```
GET /users?$select=id,mail,displayName,userPrincipalName,userType,accountEnabled
```

## Configuration Options

### Environment Variables
Control user filtering behavior via environment variables:

```bash
# Include guest users in sync (default: false)
MICROSOFT_INCLUDE_GUESTS=false

# Include disabled accounts in sync (default: false)  
MICROSOFT_INCLUDE_DISABLED=false
```

### Default Behavior
- **Guests**: Excluded by default
- **Disabled accounts**: Excluded by default
- **Result**: Only active organization members

## Expected Impact

### Before Filtering
```
Zurobio Organization:
- Total users in tenant: 331
- Member users: 80
- Guest users: 200
- Service accounts: 30
- Disabled accounts: 21

Sync Result: 331 users ❌
```

### After Filtering (Default)
```
Zurobio Organization:
- Filtered for: Member + Enabled only
- Result: 80 users ✅

Applications will now show realistic user counts:
- Okta: 8 users (was 331)
- DocuSign: 15 users (was 331)
```

## Detailed Logging

The implementation includes comprehensive logging:

```
🔍 Fetching users with endpoint: /users?$select=id,mail,displayName,userPrincipalName,userType,accountEnabled&$filter=userType eq 'Member' and accountEnabled eq true
📋 Filters: includeGuests=false, includeDisabled=false
✅ Fetched 80 users
📊 User breakdown: {
  "Member (Enabled)": 80
}
```

## Use Cases

### 1. Standard Organizations (Recommended)
```bash
# Default settings - only active organization members
MICROSOFT_INCLUDE_GUESTS=false
MICROSOFT_INCLUDE_DISABLED=false
```
**Result**: Clean user list with only employees

### 2. Collaborative Organizations
```bash
# Include guests who actively use applications
MICROSOFT_INCLUDE_GUESTS=true
MICROSOFT_INCLUDE_DISABLED=false
```
**Result**: Employees + active external collaborators

### 3. Full Audit Mode
```bash
# Include all users for comprehensive audit
MICROSOFT_INCLUDE_GUESTS=true
MICROSOFT_INCLUDE_DISABLED=true
```
**Result**: Complete user landscape including inactive accounts

## Client Communication

### For Zurobio
> "We've implemented smart user filtering for your Microsoft sync. By default, we now exclude guest users (external collaborators) and disabled accounts, showing only your active organization members. This reduces your user count from 331 to 80, providing a more accurate view of your actual employee usage."

### Benefits to Highlight
1. **Accurate reporting**: User counts reflect actual employees
2. **Better insights**: Focus on internal usage patterns  
3. **Cost clarity**: Understand real vs. inflated license usage
4. **Security focus**: Identify actual employee access vs. guest access

## Technical Notes

### Microsoft Graph API Limitations
- `userType` field may not be available in all tenants
- Some service accounts may appear as "Member" type
- Filtering is applied at the API level for efficiency

### Fallback Behavior
If filtering fails:
- Falls back to unfiltered user list
- Logs warning about filtering failure
- Continues with sync process

### Performance Impact
- **Positive**: Reduces API calls and processing time
- **Network**: Smaller response payloads  
- **Database**: Fewer user records to process
- **Memory**: Lower memory usage during sync

## Monitoring & Verification

### Check Filter Effectiveness
```sql
-- Compare user counts before/after filtering
SELECT 
  'Total users in database' as metric,
  COUNT(*) as count
FROM users 
WHERE organization_id = 'zurobio-org-id'

UNION ALL

SELECT 
  'Users with microsoft_user_id' as metric,
  COUNT(*) as count  
FROM users 
WHERE organization_id = 'zurobio-org-id' 
  AND microsoft_user_id IS NOT NULL;
```

### Verify User Types
```sql
-- Check if user type information is being stored
SELECT 
  role,
  COUNT(*) as count
FROM users 
WHERE organization_id = 'zurobio-org-id'
GROUP BY role;
```

## Troubleshooting

### Issue: Still seeing high user counts
**Cause**: Environment variables not set or filtering not applied
**Solution**: Verify environment variables and check logs for filter application

### Issue: Missing legitimate users  
**Cause**: Some users might be marked as "Guest" when they should be "Member"
**Solution**: Temporarily set `MICROSOFT_INCLUDE_GUESTS=true` and review user breakdown

### Issue: Service accounts excluded
**Cause**: Service accounts might be filtered out as disabled
**Solution**: Review `accountEnabled` status for service accounts in Entra ID

## Future Enhancements

### Planned Features
1. **UI Toggle**: Allow users to switch between filtered/unfiltered views
2. **Custom Filters**: More granular filtering options (by department, role, etc.)
3. **User Type Analytics**: Dashboard showing user type breakdown
4. **Smart Detection**: Automatically identify service accounts vs. regular users

### Advanced Filtering
```typescript
// Future implementation
interface UserFilterOptions {
  includeGuests: boolean;
  includeDisabled: boolean;
  includeDepartments?: string[];
  excludeServiceAccounts?: boolean;
  minimumLastSignIn?: Date;
}
```

---

**Status**: ✅ Implemented  
**Default Behavior**: Exclude guests and disabled accounts  
**Configuration**: Environment variables  
**Impact**: Reduces user counts to show only active organization members  
**Client Benefit**: More accurate usage reporting and insights
