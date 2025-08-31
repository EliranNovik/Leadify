const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function runMigration() {
  console.log('🔧 Running legacy contract migration...');
  
  try {
    // Add public_token column
    const { error: alterError } = await supabase.rpc('exec_sql', { 
      sql: 'ALTER TABLE public.lead_leadcontact ADD COLUMN IF NOT EXISTS public_token text;' 
    });
    
    if (alterError) {
      console.error('❌ Error adding public_token column:', alterError);
      return;
    }
    
    console.log('✅ Added public_token column');
    
    // Add index
    const { error: indexError } = await supabase.rpc('exec_sql', { 
      sql: 'CREATE INDEX IF NOT EXISTS idx_lead_leadcontact_public_token ON public.lead_leadcontact(public_token);' 
    });
    
    if (indexError) {
      console.error('❌ Error creating index:', indexError);
      return;
    }
    
         console.log('✅ Created index for public_token');
     
     // Add RLS policies
     const { error: policy1Error } = await supabase.rpc('exec_sql', { 
       sql: `
         DO $$ 
         BEGIN
             IF NOT EXISTS (
                 SELECT 1 FROM pg_policies 
                 WHERE tablename = 'lead_leadcontact' 
                 AND policyname = 'Public access to legacy contracts with valid token'
             ) THEN
                 CREATE POLICY "Public access to legacy contracts with valid token" 
                 ON public.lead_leadcontact 
                 FOR SELECT 
                 USING (public_token IS NOT NULL);
             END IF;
         END $$;
       ` 
     });
     
     if (policy1Error) {
       console.error('❌ Error creating SELECT policy:', policy1Error);
       return;
     }
     
     console.log('✅ Created SELECT policy');
     
     const { error: policy2Error } = await supabase.rpc('exec_sql', { 
       sql: `
         DO $$ 
         BEGIN
             IF NOT EXISTS (
                 SELECT 1 FROM pg_policies 
                 WHERE tablename = 'lead_leadcontact' 
                 AND policyname = 'Update signed legacy contracts'
             ) THEN
                 CREATE POLICY "Update signed legacy contracts" 
                 ON public.lead_leadcontact 
                 FOR UPDATE 
                 USING (public_token IS NOT NULL);
             END IF;
         END $$;
       ` 
     });
     
     if (policy2Error) {
       console.error('❌ Error creating UPDATE policy:', policy2Error);
       return;
     }
     
     console.log('✅ Created UPDATE policy');
     console.log('🎉 Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
  }
}

runMigration();
