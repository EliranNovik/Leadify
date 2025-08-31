import { supabase } from './supabase';

// Interface for legacy interactions from leads_leadinteractions table
export interface LegacyInteraction {
  id: bigint;
  cdate: string | null;
  udate: string | null;
  kind: string | null;
  date: string | null;
  time: string | null;
  minutes: bigint | null;
  content: string | null;
  creator_id: string | null;
  lead_id: bigint | null;
  direction: string | null;
  link: string | null;
  read: string | null;
  wa_num_id: string | null;
  employee_id: string | null;
  description: string | null;
}

// Interface for transformed interaction (compatible with InteractionsTab)
export interface TransformedLegacyInteraction {
  id: string | number;
  date: string;
  time: string;
  raw_date: string;
  employee: string;
  direction: 'in' | 'out';
  kind: string;
  length: string;
  content: string;
  observation: string;
  editable: boolean;
  status?: string;
  subject?: string;
}

// Helper function to clean up escape sequences and extra characters
function cleanLegacyText(text: string): string {
  if (!text || text === '\\N' || text === 'EMPTY' || text === 'FAILED') {
    return '';
  }
  
  return text
    .replace(/\\r\\n/g, '\n')  // Convert \r\n to actual line breaks
    .replace(/\\n/g, '\n')     // Convert \n to actual line breaks
    .replace(/\\r/g, '\n')     // Convert \r to line breaks
    .replace(/\\t/g, ' ')      // Convert \t to spaces
    .replace(/\\"/g, '"')      // Convert \" to actual quotes
    .replace(/\\'/g, "'")      // Convert \' to actual quotes
    .replace(/\\\\/g, '\\')    // Convert \\ to single backslash
    .trim();                   // Remove extra whitespace
}

// Fetch interactions for a specific legacy lead
export async function fetchLegacyInteractions(leadId: string, clientName?: string): Promise<TransformedLegacyInteraction[]> {
  try {
    // Extract the numeric ID from legacy lead ID (e.g., "legacy_123" -> 123)
    const numericId = parseInt(leadId.replace('legacy_', ''));
    

    
    const { data, error } = await supabase
      .from('leads_leadinteractions')
      .select('*')
      .eq('lead_id', numericId)
      .order('cdate', { ascending: false });

    if (error) {
      console.error('❌ Error fetching legacy interactions:', error);
      return [];
    }

    // Get unique employee IDs from the interactions (both creator_id and employee_id)
    const employeeIds = [...new Set((data || [])
      .flatMap(interaction => {
        const ids = [];
        
        // Add creator_id if valid
        if (interaction.creator_id && interaction.creator_id !== '\\N' && interaction.creator_id !== 'EMPTY' && interaction.creator_id !== '') {
          ids.push(interaction.creator_id);
        }
        
        // Add employee_id if valid
        if (interaction.employee_id && interaction.employee_id !== '\\N' && interaction.employee_id !== 'EMPTY' && interaction.employee_id !== '') {
          ids.push(interaction.employee_id);
        }
        
        return ids;
      })
    )];

    // Fetch employee data for all unique employee IDs
    let employeeMap: { [key: string]: { display_name: string | null; official_name: string | null } } = {};
    if (employeeIds.length > 0) {
      const { data: employeeData, error: employeeError } = await supabase
        .from('tenants_employee')
        .select('id, display_name, official_name')
        .in('id', employeeIds);
      
      if (!employeeError && employeeData) {
        employeeMap = employeeData.reduce((acc, employee) => {
          acc[employee.id.toString()] = {
            display_name: employee.display_name,
            official_name: employee.official_name
          };
          return acc;
        }, {} as { [key: string]: { display_name: string | null; official_name: string | null } });
      }
    }



    // Transform the data to match the InteractionsTab interface
    const transformedInteractions: TransformedLegacyInteraction[] = (data || []).map((interaction: LegacyInteraction) => {
      // Parse date and time
      let interactionDate = interaction.date || interaction.cdate?.split('T')[0] || '';
      let interactionTime = interaction.time || interaction.cdate?.split('T')[1]?.substring(0, 5) || '';
      
      // Clean up date and time if they contain extra signs
      if (interactionDate === '\\N' || interactionDate === 'EMPTY') interactionDate = '';
      if (interactionTime === '\\N' || interactionTime === 'EMPTY') interactionTime = '';
      
      // Determine direction based on kind and direction fields
      let direction: 'in' | 'out' = 'in';
      if (interaction.direction === 'o' || interaction.kind === 'c') {
        direction = 'out';
      }
      
      // Determine interaction type based on kind column
      let kind = interaction.kind || 'unknown';
      switch (kind) {
        case 'w': kind = 'whatsapp'; break;
        case 'c': kind = 'call'; break;
        case 'e': kind = 'email'; break;
        case 'EMPTY': kind = 'note'; break;
        default: kind = 'note'; break;
      }
      
      // Format content from content column
      let content = cleanLegacyText(interaction.content || '');
      if (!content) {
        content = 'No content';
      }
      
      // Format length (minutes)
      const length = interaction.minutes ? `${interaction.minutes} min` : '';
      
      // Get sender based on direction
      let sender: string;
      if (direction === 'in') {
        // For incoming messages, use the client name
        sender = clientName || 'Client';
      } else {
        // For outgoing messages, try creator_id first, then employee_id
        let employeeId = null;
        
        // Try creator_id first
        if (interaction.creator_id && interaction.creator_id !== '\\N' && interaction.creator_id !== 'EMPTY' && interaction.creator_id !== '') {
          employeeId = interaction.creator_id;
        }
        // If creator_id is not available, try employee_id
        else if (interaction.employee_id && interaction.employee_id !== '\\N' && interaction.employee_id !== 'EMPTY' && interaction.employee_id !== '') {
          employeeId = interaction.employee_id;
        }
        
        // Try to get employee name from employee map
        if (employeeId && employeeMap[employeeId]) {
          const employee = employeeMap[employeeId];
          sender = employee.display_name || employee.official_name || employeeId;
        } else if (employeeId) {
          sender = employeeId;
        } else {
          sender = 'Unknown';
        }
      }
      
      return {
        id: `legacy_${interaction.id}`,
        date: interactionDate ? new Date(interactionDate).toLocaleDateString('en-GB', { 
          day: '2-digit', 
          month: '2-digit', 
          year: '2-digit' 
        }) : 'Unknown',
        time: interactionTime || 'Unknown',
        raw_date: interaction.cdate || interactionDate || '',
        employee: sender, // Display creator_id as sender (cleaned)
        direction,
        kind,
        length,
        content: content, // Show full content for legacy interactions
        observation: cleanLegacyText(interaction.description || ''),
        editable: false, // Legacy interactions are read-only
        status: interaction.read === 't' ? 'read' : 'unread',
        subject: cleanLegacyText(interaction.description || ''),
      };
    });


    return transformedInteractions;

  } catch (error) {
    console.error('❌ Error in fetchLegacyInteractions:', error);
    return [];
  }
}

// Test function to check database access
export async function testLegacyInteractionsAccess(): Promise<void> {
  try {
    console.log('🧪 Testing legacy interactions database access...');
    
    // Test basic table access
    const { data: allData, error: allError } = await supabase
      .from('leads_leadinteractions')
      .select('*')
      .limit(5);
    
    console.log('🔍 All data test:', { data: allData, error: allError });
    
    // Check the structure of the first record
    if (allData && allData.length > 0) {
      console.log('📋 First record structure:', Object.keys(allData[0]));
      console.log('📋 First record data:', allData[0]);
    } else {
      console.log('⚠️ No data found in table');
    }
    
    // Test specific lead_id query
    const { data: specificData, error: specificError } = await supabase
      .from('leads_leadinteractions')
      .select('*')
      .eq('lead_id', 3395) // Example lead ID from your data
      .limit(3);
    
    console.log('🔍 Specific lead test:', { data: specificData, error: specificError });
    
  } catch (error) {
    console.error('❌ Legacy interactions access test failed:', error);
  }
}
