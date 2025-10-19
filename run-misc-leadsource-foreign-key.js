const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables:');
  console.error('   VITE_SUPABASE_URL:', !!supabaseUrl);
  console.error('   SUPABASE_SERVICE_ROLE_KEY:', !!supabaseServiceKey);
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runSQL() {
  try {
    console.log('🚀 Running misc_leadsource foreign key setup...');
    
    // Read the SQL file
    const sqlPath = path.join(__dirname, 'add_misc_leadsource_foreign_key.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    // Split the SQL into individual statements
    const statements = sql
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
    
    console.log(`📝 Found ${statements.length} SQL statements to execute`);
    
    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      console.log(`\n🔧 Executing statement ${i + 1}/${statements.length}:`);
      console.log(statement.substring(0, 100) + (statement.length > 100 ? '...' : ''));
      
      try {
        const { data, error } = await supabase.rpc('exec_sql', { sql: statement });
        
        if (error) {
          console.error(`❌ Error in statement ${i + 1}:`, error.message);
          // Continue with other statements
        } else {
          console.log(`✅ Statement ${i + 1} executed successfully`);
          if (data) {
            console.log('📊 Result:', data);
          }
        }
      } catch (err) {
        console.error(`❌ Exception in statement ${i + 1}:`, err.message);
      }
    }
    
    console.log('\n🎉 SQL execution completed!');
    
  } catch (error) {
    console.error('❌ Error running SQL:', error);
    process.exit(1);
  }
}

// Check if we have the exec_sql function, if not, provide alternative
async function checkExecSqlFunction() {
  try {
    const { data, error } = await supabase.rpc('exec_sql', { sql: 'SELECT 1;' });
    if (error && error.message.includes('function exec_sql')) {
      console.log('⚠️  exec_sql function not available. Please run the SQL manually in your database.');
      console.log('📁 SQL file location:', path.join(__dirname, 'add_misc_leadsource_foreign_key.sql'));
      return false;
    }
    return true;
  } catch (err) {
    console.log('⚠️  exec_sql function not available. Please run the SQL manually in your database.');
    console.log('📁 SQL file location:', path.join(__dirname, 'add_misc_leadsource_foreign_key.sql'));
    return false;
  }
}

async function main() {
  console.log('🔍 Checking if exec_sql function is available...');
  
  const hasExecSql = await checkExecSqlFunction();
  
  if (hasExecSql) {
    await runSQL();
  } else {
    console.log('\n📋 To run this SQL manually:');
    console.log('1. Open your database admin tool (pgAdmin, DBeaver, etc.)');
    console.log('2. Connect to your database');
    console.log('3. Run the contents of: add_misc_leadsource_foreign_key.sql');
  }
}

main();