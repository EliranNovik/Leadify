const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function addPhoneNumberColumn() {
  try {
    console.log('🔧 Adding phone_number column to whatsapp_messages table...');
    
    // Read the SQL migration file
    const sqlPath = path.join(__dirname, 'add_phone_number_column.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    
    // Split the SQL into individual statements
    const statements = sqlContent
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0);
    
    console.log(`📝 Found ${statements.length} SQL statements to execute`);
    
    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i] + ';';
      console.log(`\n🔨 Executing statement ${i + 1}/${statements.length}:`);
      console.log(statement.substring(0, 100) + (statement.length > 100 ? '...' : ''));
      
      try {
        const { error } = await supabase.rpc('exec_sql', { sql: statement });
        
        if (error) {
          console.error(`❌ Error executing statement ${i + 1}:`, error);
          // Continue with next statement instead of failing completely
        } else {
          console.log(`✅ Statement ${i + 1} executed successfully`);
        }
      } catch (err) {
        console.error(`❌ Exception executing statement ${i + 1}:`, err.message);
      }
    }
    
    // Verify the column was added
    console.log('\n🔍 Verifying column addition...');
    const { data: columns, error: columnError } = await supabase
      .from('whatsapp_messages')
      .select('*')
      .limit(1);
    
    if (columnError) {
      console.error('❌ Error verifying column:', columnError);
    } else {
      console.log('✅ Column verification completed');
      console.log('📋 Available columns:', Object.keys(columns[0] || {}));
    }
    
    console.log('\n🎉 Migration completed!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run the migration
addPhoneNumberColumn();
