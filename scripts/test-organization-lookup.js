const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing required environment variables: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const organizeSupabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  db: {
    schema: 'organize-app-inbox'
  }
})

async function testOrganizationLookup() {
  console.log('🧪 Testing organization lookup logic...\n')

  // Test cases - these are the shadow org IDs from your error logs
  const testCases = [
    '06082830-06bf-4fb2-bfdd-d955ff996abc', // The problematic one
    'e322be90-b0c6-44c9-96e0-afe62b2fb868'  // The one showing "No organizations found"
  ]

  for (const testShadowOrgId of testCases) {
    console.log(`🔍 Testing shadow org ID: ${testShadowOrgId}`)
    
    try {
      // Test the new lookup logic
      let organizations = null
      let orgError = null

      // First try to find organizations that contain this shadow org ID in comma-separated list
      const { data: orgs, error: orgsError } = await organizeSupabaseAdmin
        .from('organizations')
        .select('*')
        .not('shadow_org_id', 'is', null)

      if (!orgsError && orgs) {
        // Find organization that contains the shadow org ID in its comma-separated list
        const matchingOrg = orgs.find(org => {
          if (!org.shadow_org_id) return false
          const orgShadowIds = org.shadow_org_id.split(',').map((id) => id.trim())
          return orgShadowIds.includes(testShadowOrgId)
        })
        
        if (matchingOrg) {
          organizations = [matchingOrg]
          orgError = null
          console.log(`   ✅ Found in comma-separated list: ${matchingOrg.name} (${matchingOrg.id})`)
          console.log(`      Full shadow_org_id: ${matchingOrg.shadow_org_id}`)
        }
      }

      // If no comma-separated match found, try exact match
      if (!organizations || organizations.length === 0) {
        const { data: exactOrgs, error: exactError } = await organizeSupabaseAdmin
          .from('organizations')
          .select('*')
          .eq('shadow_org_id', testShadowOrgId)

        if (!exactError && exactOrgs && exactOrgs.length > 0) {
          organizations = exactOrgs
          orgError = null
          console.log(`   ✅ Found exact match: ${exactOrgs[0].name} (${exactOrgs[0].id})`)
          if (exactOrgs.length > 1) {
            console.log(`   ⚠️  Multiple exact matches found: ${exactOrgs.length}`)
          }
        } else {
          orgError = exactError
          console.log(`   ❌ No exact match found`)
        }
      }

      if (!orgError && organizations && organizations.length > 0) {
        // If there are multiple organizations, use the oldest one
        const organization = organizations.sort((a, b) => 
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        )[0]

        console.log(`   🎯 Selected organization: ${organization.name} (${organization.id})`)
        console.log(`      Created: ${organization.created_at}`)
        console.log(`      Identity Provider: ${organization.identity_provider || 'N/A'}`)
        console.log(`      Email Provider: ${organization.email_provider || 'N/A'}`)
      } else {
        console.log(`   ❌ No organization found for shadow org ID: ${testShadowOrgId}`)
      }

    } catch (error) {
      console.error(`   ❌ Error testing shadow org ID ${testShadowOrgId}:`, error)
    }
    
    console.log('')
  }

  // Also test with a comma-separated input
  console.log('🔍 Testing comma-separated shadow org ID input...')
  const commaSeparatedTest = '06082830-06bf-4fb2-bfdd-d955ff996abc,e322be90-b0c6-44c9-96e0-afe62b2fb868'
  const shadowOrgIds = commaSeparatedTest.split(',').map((id) => id.trim()).filter((id) => id.length > 0)
  
  console.log(`   Input: ${commaSeparatedTest}`)
  console.log(`   Parsed IDs: ${JSON.stringify(shadowOrgIds)}`)
  
  for (const singleShadowOrgId of shadowOrgIds) {
    console.log(`   🔍 Looking for: ${singleShadowOrgId}`)
    
    try {
      let organizations = null
      let orgError = null

      // First try to find organizations that contain this shadow org ID in comma-separated list
      const { data: orgs, error: orgsError } = await organizeSupabaseAdmin
        .from('organizations')
        .select('*')
        .not('shadow_org_id', 'is', null)

      if (!orgsError && orgs) {
        const matchingOrg = orgs.find(org => {
          if (!org.shadow_org_id) return false
          const orgShadowIds = org.shadow_org_id.split(',').map((id) => id.trim())
          return orgShadowIds.includes(singleShadowOrgId)
        })
        
        if (matchingOrg) {
          organizations = [matchingOrg]
          orgError = null
          console.log(`      ✅ Found: ${matchingOrg.name} (${matchingOrg.id})`)
        }
      }

      if (!organizations || organizations.length === 0) {
        const { data: exactOrgs, error: exactError } = await organizeSupabaseAdmin
          .from('organizations')
          .select('*')
          .eq('shadow_org_id', singleShadowOrgId)

        if (!exactError && exactOrgs && exactOrgs.length > 0) {
          organizations = exactOrgs
          orgError = null
          console.log(`      ✅ Found exact match: ${exactOrgs[0].name} (${exactOrgs[0].id})`)
        } else {
          console.log(`      ❌ Not found`)
        }
      }
    } catch (error) {
      console.error(`      ❌ Error:`, error)
    }
  }
}

// Run the test
testOrganizationLookup()
  .then(() => {
    console.log('✅ Test complete!')
    process.exit(0)
  })
  .catch(error => {
    console.error('❌ Test failed:', error)
    process.exit(1)
  })
