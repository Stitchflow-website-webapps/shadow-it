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

async function analyzeDuplicateOrganizations() {
  console.log('🔍 Analyzing duplicate organizations in organize-app-inbox schema...\n')

  try {
    // Step 1: Get all organizations with shadow_org_id
    const { data: organizations, error } = await organizeSupabaseAdmin
      .from('organizations')
      .select('*')
      .not('shadow_org_id', 'is', null)

    if (error) {
      console.error('❌ Error fetching organizations:', error)
      return
    }

    console.log(`📊 Total organizations with shadow_org_id: ${organizations.length}`)

    // Step 2: Find duplicates (including comma-separated scenarios)
    const shadowOrgIdCounts = {}
    const shadowOrgIdMappings = {}
    
    organizations.forEach(org => {
      if (!org.shadow_org_id) return
      
      // Handle comma-separated shadow org IDs
      const individualIds = org.shadow_org_id.split(',').map(id => id.trim()).filter(id => id.length > 0)
      
      individualIds.forEach(id => {
        shadowOrgIdCounts[id] = (shadowOrgIdCounts[id] || 0) + 1
        
        if (!shadowOrgIdMappings[id]) {
          shadowOrgIdMappings[id] = []
        }
        shadowOrgIdMappings[id].push(org)
      })
    })

    const duplicates = Object.entries(shadowOrgIdCounts)
      .filter(([_, count]) => count > 1)
      .sort(([_, a], [__, b]) => b - a)

    console.log(`🚨 Found ${duplicates.length} shadow_org_ids with duplicate organizations:\n`)

    if (duplicates.length === 0) {
      console.log('✅ No duplicate organizations found!')
      return
    }

    // Step 3: Show detailed information about duplicates
    for (const [shadowOrgId, count] of duplicates) {
      console.log(`🔍 Shadow Org ID: ${shadowOrgId}`)
      console.log(`   📈 Duplicate count: ${count}`)
      
      const duplicateOrgs = shadowOrgIdMappings[shadowOrgId]
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))

      console.log('   📋 Organizations:')
      duplicateOrgs.forEach((org, index) => {
        console.log(`      ${index + 1}. ID: ${org.id}`)
        console.log(`         Name: ${org.name}`)
        console.log(`         Domain: ${org.domain || 'N/A'}`)
        console.log(`         Full shadow_org_id: ${org.shadow_org_id}`)
        console.log(`         Created: ${org.created_at}`)
        console.log(`         Identity Provider: ${org.identity_provider || 'N/A'}`)
        console.log(`         Email Provider: ${org.email_provider || 'N/A'}`)
        console.log('')
      })

      // Check if this is the problematic shadow org ID
      if (shadowOrgId === '06082830-06bf-4fb2-bfdd-d955ff996abc') {
        console.log('   ⚠️  THIS IS THE PROBLEMATIC SHADOW ORG ID CAUSING THE PGRST116 ERROR!')
        console.log('')
      }
    }

    // Step 4: Check apps associated with duplicate organizations
    console.log('📱 Checking apps associated with duplicate organizations...\n')

    for (const [shadowOrgId, count] of duplicates) {
      const duplicateOrgs = shadowOrgIdMappings[shadowOrgId]
      
      for (const org of duplicateOrgs) {
        const { data: apps, error: appsError } = await organizeSupabaseAdmin
          .from('apps')
          .select('id, name')
          .eq('org_id', org.id)

        if (appsError) {
          console.error(`❌ Error fetching apps for org ${org.id}:`, appsError)
          continue
        }

        console.log(`   📱 Org ${org.id} (${org.name}) has ${apps.length} apps:`)
        if (apps.length > 0) {
          apps.forEach(app => {
            console.log(`      - ${app.name} (ID: ${app.id})`)
          })
        }
        console.log('')
      }
    }

    // Step 5: Recommendations
    console.log('💡 RECOMMENDATIONS:')
    console.log('1. Run the SQL script fix_duplicate_organizations.sql to analyze the duplicates')
    console.log('2. For each duplicate set, decide which organization to keep (usually the oldest)')
    console.log('3. Move all apps from duplicate organizations to the primary one')
    console.log('4. Delete the duplicate organizations')
    console.log('5. Add a unique constraint on shadow_org_id to prevent future duplicates')
    console.log('6. The API code has been updated to handle duplicates gracefully')

  } catch (error) {
    console.error('❌ Unexpected error:', error)
  }
}

// Run the analysis
analyzeDuplicateOrganizations()
  .then(() => {
    console.log('✅ Analysis complete!')
    process.exit(0)
  })
  .catch(error => {
    console.error('❌ Analysis failed:', error)
    process.exit(1)
  })
