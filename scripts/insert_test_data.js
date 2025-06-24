import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function insertTestData() {
  try {
    // Insert test leads
    const { data: leads, error: leadsError } = await supabase
      .from('leads')
      .upsert([
        {
          lead_number: 'L122325',
          name: 'Mark Ehrlich',
          status: 'New Lead',
          topic: 'German Citizenship',
          email: 'mark.e@example.com',
          source: 'Website',
          helper: 'Mindi',
          expert: 'David K'
        },
        {
          lead_number: 'L122326',
          name: 'Jane Granek',
          status: 'Hot Lead',
          topic: 'German Citizenship',
          email: 'jane.g@example.com',
          source: 'Referral',
          helper: 'Mindi',
          expert: 'David K'
        },
        {
          lead_number: 'L122327',
          name: 'Ida Bloch',
          status: 'Follow Up',
          topic: 'Proposal Discussion',
          email: 'ida.b@example.com',
          source: 'Direct',
          helper: 'Mindi',
          expert: 'David K'
        }
      ], { onConflict: 'lead_number' })
      .select();

    if (leadsError) {
      throw leadsError;
    }

    console.log('Leads inserted:', leads);

    // Get today's and tomorrow's dates
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

    // Insert meetings for the leads
    const meetings = leads.map((lead, index) => ({
      client_id: lead.id,
      meeting_date: index < 2 ? today : tomorrow,
      meeting_time: ['10:00', '14:30', '11:00'][index],
      meeting_location: ['Jerusalem Office', 'Teams', 'Tel Aviv Office'][index],
      meeting_manager: 'Sarah L',
      meeting_currency: 'NIS',
      meeting_amount: [500, 750, 1000][index],
      expert: 'David K',
      helper: 'Mindi',
      teams_meeting_url: `https://teams.microsoft.com/l/meetup-join/sample-${lead.lead_number}`,
      meeting_brief: [
        'Initial consultation about German citizenship application',
        'Follow-up meeting to discuss document requirements',
        'Price proposal discussion and next steps'
      ][index],
      scheduler: 'Anna Zh',
      status: 'scheduled'
    }));

    const { data: insertedMeetings, error: meetingsError } = await supabase
      .from('meetings')
      .insert(meetings)
      .select();

    if (meetingsError) {
      throw meetingsError;
    }

    console.log('Meetings inserted:', insertedMeetings);
    console.log('Test data insertion completed successfully!');
  } catch (error) {
    console.error('Error inserting test data:', error);
  } finally {
    process.exit();
  }
}

insertTestData(); 