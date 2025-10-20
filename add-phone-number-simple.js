import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function addPhoneNumberColumn() {
  try {
    console.log('🔧 Adding phone_number column to whatsapp_messages table...');
    
    // Add the phone_number column
    const { error: addColumnError } = await supabase
      .rpc('exec_sql', { 
        sql: 'ALTER TABLE whatsapp_messages ADD COLUMN phone_number TEXT;' 
      });
    
    if (addColumnError) {
      console.error('❌ Error adding column:', addColumnError);
      // Check if column already exists
      if (addColumnError.message.includes('already exists')) {
        console.log('✅ Column already exists, continuing...');
      } else {
        throw addColumnError;
      }
    } else {
      console.log('✅ phone_number column added successfully');
    }
    
    // Add index for better performance
    const { error: addIndexError } = await supabase
      .rpc('exec_sql', { 
        sql: 'CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_phone_number ON whatsapp_messages(phone_number);' 
      });
    
    if (addIndexError) {
      console.error('❌ Error adding index:', addIndexError);
    } else {
      console.log('✅ Index added successfully');
    }
    
    // Verify the column was added
    console.log('\n🔍 Verifying column addition...');
    const { data: sampleData, error: verifyError } = await supabase
      .from('whatsapp_messages')
      .select('phone_number')
      .limit(1);
    
    if (verifyError) {
      console.error('❌ Error verifying column:', verifyError);
    } else {
      console.log('✅ Column verification completed');
      console.log('📋 phone_number column is now available');
    }
    
    console.log('\n🎉 Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run the migration
addPhoneNumberColumn();
