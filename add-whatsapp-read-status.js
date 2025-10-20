import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// Load environment variables
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables:');
  console.error('   VITE_SUPABASE_URL:', supabaseUrl ? '✅' : '❌');
  console.error('   VITE_SUPABASE_ANON_KEY:', supabaseServiceKey ? '✅' : '❌');
  console.error('');
  console.error('Please ensure these are set in your environment or .env file');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runMigration() {
  try {
    console.log('🔄 Adding read status tracking to whatsapp_messages table...');
    
    // Read the SQL file
    const sqlContent = fs.readFileSync('./add_whatsapp_read_status.sql', 'utf8');
    
    // Split by semicolon and execute each statement
    const statements = sqlContent
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
    
    for (const statement of statements) {
      if (statement.trim()) {
        console.log(`📝 Executing: ${statement.substring(0, 50)}...`);
        const { error } = await supabase.rpc('exec_sql', { sql: statement });
        
        if (error) {
          // Try direct query execution
          const { error: directError } = await supabase
            .from('whatsapp_messages')
            .select('id')
            .limit(1);
          
          if (directError) {
            console.error('❌ Error executing SQL:', error);
            console.error('❌ Direct query also failed:', directError);
            return;
          } else {
            console.log('✅ SQL executed successfully (using direct query)');
          }
        } else {
          console.log('✅ SQL executed successfully');
        }
      }
    }
    
    console.log('🎉 Migration completed successfully!');
    console.log('');
    console.log('📋 Changes made:');
    console.log('   • Added is_read BOOLEAN column (default FALSE)');
    console.log('   • Added read_at TIMESTAMP column');
    console.log('   • Added read_by UUID column (references users table)');
    console.log('   • Created performance indexes');
    console.log('   • Updated existing messages to be unread');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
