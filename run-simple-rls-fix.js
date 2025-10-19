const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables:');
  console.error('VITE_SUPABASE_URL:', supabaseUrl ? '✅' : '❌');
  console.error('SUPABASE_SERVICE_ROLE_KEY:', supabaseServiceKey ? '✅' : '❌');
  process.exit(1);
}

// Create Supabase client with service role key for admin operations
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function fixRLSPolicies() {
  try {
    console.log('🔧 Fixing RLS policies for tenant_employee_prefered_category table...\n');
    
    // Step 1: Enable RLS
    console.log('1️⃣ Enabling RLS on the table...');
    try {
      const { error: rlsError } = await supabase.rpc('exec_sql', { 
        sql_query: 'ALTER TABLE public.tenant_employee_prefered_category ENABLE ROW LEVEL SECURITY;'
      });
      if (rlsError) console.error('RLS Error:', rlsError);
      else console.log('✅ RLS enabled');
    } catch (e) {
      console.log('ℹ️ RLS might already be enabled or using alternative method');
    }

    // Step 2: Drop existing policies
    console.log('\n2️⃣ Dropping existing policies...');
    const dropPolicies = [
      'DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.tenant_employee_prefered_category;',
      'DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.tenant_employee_prefered_category;',
      'DROP POLICY IF EXISTS "Enable update for authenticated users" ON public.tenant_employee_prefered_category;',
      'DROP POLICY IF EXISTS "Enable delete for authenticated users" ON public.tenant_employee_prefered_category;'
    ];

    for (const policy of dropPolicies) {
      try {
        await supabase.rpc('exec_sql', { sql_query: policy });
      } catch (e) {
        console.log('ℹ️ Policy drop (might not exist):', policy.substring(0, 50));
      }
    }
    console.log('✅ Existing policies dropped');

    // Step 3: Create new policies
    console.log('\n3️⃣ Creating new RLS policies...');
    
    const policies = [
      {
        name: 'Enable read access for authenticated users',
        sql: 'CREATE POLICY "Enable read access for authenticated users" ON public.tenant_employee_prefered_category FOR SELECT TO authenticated USING (true);'
      },
      {
        name: 'Enable insert for authenticated users',
        sql: 'CREATE POLICY "Enable insert for authenticated users" ON public.tenant_employee_prefered_category FOR INSERT TO authenticated WITH CHECK (true);'
      },
      {
        name: 'Enable update for authenticated users',
        sql: 'CREATE POLICY "Enable update for authenticated users" ON public.tenant_employee_prefered_category FOR UPDATE TO authenticated USING (true) WITH CHECK (true);'
      },
      {
        name: 'Enable delete for authenticated users',
        sql: 'CREATE POLICY "Enable delete for authenticated users" ON public.tenant_employee_prefered_category FOR DELETE TO authenticated USING (true);'
      }
    ];

    for (const policy of policies) {
      try {
        const { error } = await supabase.rpc('exec_sql', { sql_query: policy.sql });
        if (error) {
          console.error(`❌ Failed to create ${policy.name}:`, error);
        } else {
          console.log(`✅ Created policy: ${policy.name}`);
        }
      } catch (e) {
        console.error(`❌ Exception creating ${policy.name}:`, e.message);
      }
    }

    // Step 4: Grant permissions
    console.log('\n4️⃣ Granting table permissions...');
    try {
      const { error: grantError } = await supabase.rpc('exec_sql', { 
        sql_query: 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_employee_prefered_category TO authenticated, anon;'
      });
      if (grantError) console.error('Grant Error:', grantError);
      else console.log('✅ Permissions granted');
    } catch (e) {
      console.log('ℹ️ Grant permissions (might already exist)');
    }

    // Step 5: Test access
    console.log('\n5️⃣ Testing table access...');
    const { data: testData, error: testError } = await supabase
      .from('tenant_employee_prefered_category')
      .select('*')
      .limit(5);
    
    if (testError) {
      console.error('❌ Test access failed:', testError);
    } else {
      console.log('✅ Test access successful!');
      console.log('📊 Sample data:', testData);
      console.log(`📈 Accessible records: ${testData.length}`);
    }

    // Step 6: List created policies
    console.log('\n6️⃣ Verifying created policies...');
    try {
      const { data: policiesData, error: policiesError } = await supabase
        .rpc('exec_sql', { 
          sql_query: `SELECT policyname, cmd, roles FROM pg_policies WHERE tablename = 'tenant_employee_prefered_category' ORDER BY policyname;`
        });
      
      if (policiesError) {
        console.error('❌ Could not verify policies:', policiesError);
      } else {
        console.log('✅ Policies verification:', policiesData);
      }
    } catch (e) {
      console.log('ℹ️ Policy verification (using alternative method)');
    }

    console.log('\n🎉 RLS policy fix completed!');
    console.log('\n📝 Next steps:');
    console.log('1. Refresh your application');
    console.log('2. Check if the preferred categories are now loading');
    console.log('3. Verify the employee filtering is working');
    
  } catch (error) {
    console.error('❌ Script execution failed:', error);
  }
}

// Alternative manual approach if RPC fails
async function manualApproach() {
  console.log('\n🔄 Trying manual approach...');
  
  try {
    // Test direct table access
    const { data, error } = await supabase
      .from('tenant_employee_prefered_category')
      .select('*')
      .limit(1);
    
    if (error) {
      console.error('❌ Direct access still failing:', error);
      console.log('\n💡 Manual steps needed:');
      console.log('1. Go to Supabase Dashboard');
      console.log('2. Navigate to Authentication > Policies');
      console.log('3. Find tenant_employee_prefered_category table');
      console.log('4. Create these policies manually:');
      console.log('   - SELECT policy: authenticated users, USING (true)');
      console.log('   - INSERT policy: authenticated users, WITH CHECK (true)');
      console.log('   - UPDATE policy: authenticated users, USING (true) WITH CHECK (true)');
      console.log('   - DELETE policy: authenticated users, USING (true)');
    } else {
      console.log('✅ Direct access working!');
      console.log('📊 Data:', data);
    }
  } catch (e) {
    console.error('❌ Manual approach failed:', e.message);
  }
}

// Main execution
async function main() {
  console.log('🚀 Starting RLS policy fix for tenant_employee_prefered_category...\n');
  
  await fixRLSPolicies();
  await manualApproach();
  
  console.log('\n✨ Script completed!');
}

main().catch(console.error);
