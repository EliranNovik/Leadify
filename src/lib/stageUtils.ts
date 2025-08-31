import { supabase } from './supabase';

// Cache for stage names to avoid repeated database calls
let stageNamesCache: { [key: string]: string } = {};
let isCacheInitialized = false;

/**
 * Fetches stage names from the lead_stages table and caches them
 */
export const fetchStageNames = async (): Promise<{ [key: string]: string }> => {
  if (isCacheInitialized) {
    return stageNamesCache;
  }

  try {
    const { data, error } = await supabase
      .from('lead_stages')
      .select('id, name')
      .order('name', { ascending: true });
    
    if (error) {
      console.error('Error fetching stages:', error);
      return {};
    }
    
    if (data) {
      // Create a mapping of stage ID to stage name
      const stageMapping: { [key: string]: string } = {};
      data.forEach(stage => {
        stageMapping[stage.id] = stage.name || stage.id;
      });
      
      // Update cache
      stageNamesCache = stageMapping;
      isCacheInitialized = true;
      
      return stageMapping;
    }
    
    return {};
  } catch (err) {
    console.error('Exception while fetching stages:', err);
    return {};
  }
};

/**
 * Gets the display name for a stage ID
 * @param stageId - The stage ID to get the name for
 * @returns The stage name or formatted stage ID as fallback
 */
export const getStageName = (stageId: string): string => {
  // Convert to string if it's a number
  const stageIdStr = String(stageId);
  
  // Special mapping for known stage IDs that might not be in the database
  const specialStageMappings: { [key: string]: string } = {
    '0': 'Precommunication',
    '1': 'Created',
    '91': 'Dropped (Spam/Irrelevant)',
    '51': 'Client declined price offer',
    '35': 'Meeting Irrelevant'
  };
  
  // Check special mappings first
  if (specialStageMappings[stageIdStr]) {
    return specialStageMappings[stageIdStr];
  }
  
  // First try to get the name from the cache
  if (stageNamesCache[stageIdStr]) {
    return stageNamesCache[stageIdStr];
  }
  
  // Fallback to formatting the stage ID if no name is found
  const fallbackName = (stageIdStr !== undefined && stageIdStr !== null && stageIdStr !== '' ? stageIdStr : 'No Stage')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase());
  
  return fallbackName;
};

/**
 * Normalizes a stage name for comparison by removing spaces, converting to lowercase,
 * and handling common variations between legacy and new stage names
 * @param stageName - The stage name to normalize
 * @returns Normalized stage name for comparison
 */
export const normalizeStageName = (stageName: string): string => {
  if (!stageName) return '';
  
  return stageName
    .toLowerCase()
    .replace(/\s+/g, '') // Remove all spaces
    .replace(/[_-]/g, '') // Remove underscores and hyphens
    .replace(/[^\w]/g, ''); // Remove special characters
};

/**
 * Checks if two stage names are equivalent (accounting for variations)
 * @param stage1 - First stage name
 * @param stage2 - Second stage name
 * @returns True if stages are equivalent
 */
export const areStagesEquivalent = (stage1: string, stage2: string): boolean => {
  const normalized1 = normalizeStageName(stage1);
  const normalized2 = normalizeStageName(stage2);
  
  // Direct match
  if (normalized1 === normalized2) {
    return true;
  }
  
  // Common stage name variations
  const stageVariations: { [key: string]: string[] } = {
    'created': ['created', 'new', 'initial'],
    'schedulerassigned': ['schedulerassigned', 'scheduler_assigned', 'assigned'],
    'clientsignedagreement': ['clientsigned', 'clientsignedagreement', 'client_signed_agreement'],
    'paymentrequestsent': ['paymentrequestsent', 'payment_request_sent', 'paymentrequest'],
    'meetingscheduled': ['meetingscheduled', 'meeting_scheduled', 'scheduled'],
    'waitingformtngsum': ['waitingformtngsum', 'waiting_for_mtng_sum', 'waitingformeetingsummary'],
    'communicationstarted': ['communicationstarted', 'communication_started', 'communication'],
    'mtngsumagreementsent': ['mtngsumagreementsent', 'mtng_sum_agreement_sent', 'meetingsummaryagreementsent'],
    'handlerassigned': ['handlerassigned', 'handler_assigned', 'handler'],
    'success': ['success', 'completed', 'finished'],
    'unactivated': ['unactivated', 'inactive', 'deactivated', 'droppedspamirrelevant', 'unactivatespam'],
    'clientdeclined': ['clientdeclined', 'client_declined', 'declined'],
    'revisedoffer': ['revisedoffer', 'revised_offer', 'revised'],
    'financesandpaymentsplan': ['financesandpaymentsplan', 'finances_and_payments_plan', 'financesplan']
  };
  
  // Check if both stages are in the same variation group
  for (const [key, variations] of Object.entries(stageVariations)) {
    if (variations.includes(normalized1) && variations.includes(normalized2)) {
      return true;
    }
  }
  
  return false;
};

/**
 * Clears the stage names cache (useful for testing or when data changes)
 */
export const clearStageNamesCache = () => {
  stageNamesCache = {};
  isCacheInitialized = false;
};

/**
 * Initializes the stage names cache (call this early in your app)
 */
export const initializeStageNames = async () => {
  await fetchStageNames();
};
