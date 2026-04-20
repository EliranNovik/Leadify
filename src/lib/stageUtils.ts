import { supabase } from './supabase';

// Cache for stage names to avoid repeated database calls
let stageNamesCache: { [key: string]: string } = {};
let stageColoursCache: { [key: string]: string } = {};
let isCacheInitialized = false;

// Bump version when stage names are renamed in DB (forces refetch).
const STAGE_CACHE_STORAGE_KEY = 'leadStagesCache:v2';
const STAGE_CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24; // 24h

// Best-effort restore from localStorage so stage colours survive refresh.
(() => {
  try {
    if (typeof window === 'undefined') return;
    const raw = window.localStorage.getItem(STAGE_CACHE_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as {
      savedAt?: number;
      names?: { [key: string]: string };
      colours?: { [key: string]: string };
    };
    const savedAt = Number(parsed?.savedAt ?? 0);
    if (!Number.isFinite(savedAt) || savedAt <= 0) return;
    if (Date.now() - savedAt > STAGE_CACHE_MAX_AGE_MS) return;
    const names = parsed?.names && typeof parsed.names === 'object' ? parsed.names : null;
    const colours = parsed?.colours && typeof parsed.colours === 'object' ? parsed.colours : null;
    if (!names || !colours) return;
    stageNamesCache = names;
    stageColoursCache = colours;
    isCacheInitialized = Object.keys(stageNamesCache).length > 0 || Object.keys(stageColoursCache).length > 0;
  } catch {
    // ignore
  }
})();

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
      .select('id, name, colour')
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
        if (stage.colour) {
          stageColoursCache[stage.id] = stage.colour;
        }
      });

      // Update cache
      stageNamesCache = stageMapping;
      isCacheInitialized = true;

      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(
            STAGE_CACHE_STORAGE_KEY,
            JSON.stringify({ savedAt: Date.now(), names: stageNamesCache, colours: stageColoursCache })
          );
        }
      } catch {
        // ignore
      }
      
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
  
  // Prefer DB/cache mapping first so renames take effect immediately.
  if (stageNamesCache[stageIdStr]) {
    return stageNamesCache[stageIdStr];
  }

  // Special mapping for known stage IDs that might not be in the database
  const specialStageMappings: { [key: string]: string } = {
    '0': 'Created',
    '10': 'Scheduler assigned',
    '11': 'Precommunication',
    '15': 'Communication started',
    '20': 'Meeting scheduled',
    '21': 'Meeting rescheduling',
    '30': 'Meeting complete',
    '35': 'Meeting Irrelevant',
    '40': 'Waiting for Mtng sum',
    '50': 'Mtng sum+Agreement sent',
    '51': 'Client declined price offer',
    '55': 'Another meeting',
    '60': 'Client signed agreement',
    '70': 'Payment request sent',
    '91': 'Dropped (Spam/Irrelevant)',
    '100': 'Success',
    '105': 'Handler Set',
    '110': 'Handler Started',
    '150': 'Application submitted',
    'meeting_scheduled': 'Meeting scheduled',
    'scheduler_assigned': 'Scheduler assigned',
    'Staff Meeting': 'Staff Meeting'
  };

  // Check special mappings first
  if (specialStageMappings[stageIdStr]) {
    return specialStageMappings[stageIdStr];
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
  stageColoursCache = {};
  isCacheInitialized = false;
};

/**
 * Forces a refresh of the stage names cache
 */
export const refreshStageNames = async (): Promise<{ [key: string]: string }> => {
  clearStageNamesCache();
  return await fetchStageNames();
};

// Fallback colours for common stage IDs - used before async cache loads so badge appears immediately
const FALLBACK_STAGE_COLOURS: { [key: string]: string } = {
  '0': '#e5e7eb', '10': '#3b82f6', '11': '#93c5fd', '15': '#60a5fa', '20': '#22c55e',
  '21': '#f59e0b', '30': '#10b981', '35': '#6b7280', '40': '#8b5cf6', '50': '#6366f1',
  '51': '#ef4444', '55': '#f97316', '60': '#14b8a6', '70': '#ec4899', '91': '#9ca3af',
  '100': '#059669', '105': '#0d9488', '110': '#0891b2',
  // Application submitted — neon yellow (matches product stage badge)
  '150': '#EFFF2D',
  '200': '#4b5563',
};

/**
 * Gets the colour configured for a stage
 * @param stageId - The stage ID to get the colour for
 * @returns Hex colour string starting with # or empty string
 */
export const getStageColour = (stageId: string): string => {
  const stageIdStr = String(stageId);
  return stageColoursCache[stageIdStr] || FALLBACK_STAGE_COLOURS[stageIdStr] || '';
};

/**
 * Initializes the stage names cache (call this early in your app)
 */
export const initializeStageNames = async () => {
  await fetchStageNames();
};
