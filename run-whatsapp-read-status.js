import { createClient } from '@supabase/supabase-js';

// Load environment variables
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function addReadStatusColumns() {
  try {
    console.log('🔄 Adding read status columns to whatsapp_messages...');
    
    // Add is_read column
    console.log('📝 Adding is_read column...');
    const { error: error1 } = await supabase
      .rpc('exec', {
        sql: 'ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE;'
      });
    
    if (error1) {
      console.log('⚠️ is_read column might already exist:', error1.message);
    } else {
      console.log('✅ is_read column added');
    }

    // Add read_at column
    console.log('📝 Adding read_at column...');
    const { error: error2 } = await supabase
      .rpc('exec', {
        sql: 'ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMP WITH TIME ZONE;'
      });
    
    if (error2) {
      console.log('⚠️ read_at column might already exist:', error2.message);
    } else {
      console.log('✅ read_at column added');
    }

    // Add read_by column
    console.log('📝 Adding read_by column...');
    const { error: error3 } = await supabase
      .rpc('exec', {
        sql: 'ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS read_by UUID REFERENCES users(id);'
      });
    
    if (error3) {
      console.log('⚠️ read_by column might already exist:', error3.message);
    } else {
      console.log('✅ read_by column added');
    }

    console.log('🎉 Migration completed!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
  }
}

addReadStatusColumns();
