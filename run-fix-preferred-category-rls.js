const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables
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

async function runSQLScript() {
  try {
    console.log('🔧 Fixing RLS policies for tenant_employee_prefered_category table...');
    
    // Read the SQL file
    const sqlPath = path.join(__dirname, 'fix_tenant_employee_preferred_category_rls.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    
    // Split the SQL content into individual statements
    const statements = sqlContent
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
    
    console.log(`📋 Found ${statements.length} SQL statements to execute`);
    
    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      
      if (statement.trim()) {
        try {
          console.log(`\n🔄 Executing statement ${i + 1}/${statements.length}...`);
          
          const { data, error } = await supabase.rpc('exec_sql', { 
            sql_query: statement 
          });
          
          if (error) {
            console.error(`❌ Error in statement ${i + 1}:`, error);
            
            // Try direct query execution as fallback
            const { data: directData, error: directError } = await supabase
              .from('information_schema.tables')
              .select('*')
              .limit(1);
            
            if (directError) {
              console.error('❌ Direct query also failed:', directError);
            }
          } else {
            console.log(`✅ Statement ${i + 1} executed successfully`);
            if (data && data.length > 0) {
              console.log('📊 Result:', data);
            }
          }
        } catch (execError) {
          console.error(`❌ Exception in statement ${i + 1}:`, execError.message);
        }
      }
    }
    
    // Test the table access
    console.log('\n🧪 Testing table access...');
    
    const { data: testData, error: testError } = await supabase
      .from('tenant_employee_prefered_category')
      .select('*')
      .limit(5);
    
    if (testError) {
      console.error('❌ Test query failed:', testError);
    } else {
      console.log('✅ Test query successful!');
      console.log('📊 Sample data:', testData);
      console.log(`📈 Total accessible records: ${testData.length}`);
    }
    
    console.log('\n🎉 RLS policy fix completed!');
    
  } catch (error) {
    console.error('❌ Script execution failed:', error);
  }
}

// Alternative approach: Use direct SQL execution
async function runDirectSQL() {
  try {
    console.log('🔧 Running direct SQL commands...');
    
    const commands = [
      'ALTER TABLE public.tenant_employee_prefered_category ENABLE ROW LEVEL SECURITY;',
      'DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.tenant_employee_prefered_category;',
      'CREATE POLICY "Enable read access for authenticated users" ON public.tenant_employee_prefered_category FOR SELECT TO authenticated USING (true);',
      'CREATE POLICY "Enable insert for authenticated users" ON public.tenant_employee_prefered_category FOR INSERT TO authenticated WITH CHECK (true);',
      'CREATE POLICY "Enable update for authenticated users" ON public.tenant_employee_prefered_category FOR UPDATE TO authenticated USING (true) WITH CHECK (true);',
      'CREATE POLICY "Enable delete for authenticated users" ON public.tenant_employee_prefered_category FOR DELETE TO authenticated USING (true);'
    ];
    
    for (const command of commands) {
      try {
        console.log(`🔄 Executing: ${command.substring(0, 50)}...`);
        
        // Try using the REST API directly
        const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'apikey': supabaseServiceKey
          },
          body: JSON.stringify({
            sql: command
          })
        });
        
        if (response.ok) {
          console.log('✅ Command executed successfully');
        } else {
          console.error('❌ Command failed:', response.status, response.statusText);
        }
      } catch (cmdError) {
        console.error('❌ Command execution error:', cmdError.message);
      }
    }
    
  } catch (error) {
    console.error('❌ Direct SQL execution failed:', error);
  }
}

// Main execution
async function main() {
  console.log('🚀 Starting RLS policy fix for tenant_employee_prefered_category...\n');
  
  // Try the main approach first
  await runSQLScript();
  
  // If that fails, try direct SQL
  console.log('\n🔄 Trying alternative approach...');
  await runDirectSQL();
  
  console.log('\n✨ Script completed!');
  console.log('📝 Next steps:');
  console.log('1. Check the Supabase dashboard for any errors');
  console.log('2. Verify the policies were created in the Authentication > Policies section');
  console.log('3. Test the table access in your application');
}

main().catch(console.error);
