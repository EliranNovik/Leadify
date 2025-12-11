/**
 * Timezone helper functions for determining timezones based on country and phone numbers
 * Special handling for US (country ID 249) using area codes
 */

/**
 * Extract US area code from phone number (first 3 digits after +1)
 * @param phone - Phone number string (e.g., "+12125551234" or "12125551234")
 * @returns Area code string (e.g., "212") or null if not found
 */
export const getUSAreaCode = (phone: string | null | undefined): string | null => {
  if (!phone) return null;
  
  // Normalize phone: remove spaces, dashes, parentheses
  const normalized = phone.replace(/[\s\-\(\)]/g, '');
  
  console.log('📞 getUSAreaCode - Input:', { phone, normalized });
  
  // Check if phone starts with +1 or 1
  if (normalized.startsWith('+1')) {
    // Extract first 3 digits after +1
    const areaCode = normalized.substring(2, 5);
    console.log('📞 getUSAreaCode - Extracted area code from +1:', areaCode);
    if (areaCode.length === 3 && /^\d{3}$/.test(areaCode)) {
      return areaCode;
    }
  } else if (normalized.startsWith('1') && normalized.length >= 4) {
    // Phone starts with 1 (US country code without +)
    const areaCode = normalized.substring(1, 4);
    console.log('📞 getUSAreaCode - Extracted area code from 1:', areaCode);
    if (areaCode.length === 3 && /^\d{3}$/.test(areaCode)) {
      return areaCode;
    }
  }
  
  console.log('📞 getUSAreaCode - No area code found');
  return null;
};

/**
 * Map US area codes to IANA timezone identifiers
 * @param areaCode - 3-digit US area code (e.g., "212")
 * @returns IANA timezone string (e.g., "America/New_York") or null if not found
 */
export const getUSTimezoneFromAreaCode = (areaCode: string): string | null => {
  console.log('🗺️ getUSTimezoneFromAreaCode - Input area code:', areaCode);
  
  // Major US area codes mapped to timezones
  const areaCodeToTimezone: { [key: string]: string } = {
    // Eastern Time (ET)
    '201': 'America/New_York', // New Jersey
    '202': 'America/New_York', // Washington DC
    '203': 'America/New_York', // Connecticut
    '205': 'America/Chicago', // Alabama
    '206': 'America/Los_Angeles', // Washington
    '207': 'America/New_York', // Maine
    '212': 'America/New_York', // New York City
    '213': 'America/Los_Angeles', // Los Angeles
    '214': 'America/Chicago', // Texas
    '215': 'America/New_York', // Pennsylvania
    '216': 'America/New_York', // Ohio
    '217': 'America/Chicago', // Illinois
    '218': 'America/New_York', // West Virginia
    '219': 'America/Chicago', // Indiana
    '224': 'America/Chicago', // Wisconsin
    '225': 'America/Chicago', // Louisiana
    '228': 'America/New_York', // North Carolina
    '229': 'America/New_York', // Georgia
    '231': 'America/New_York', // Michigan
    '234': 'America/New_York', // Georgia
    '239': 'America/Chicago', // Tennessee
    '240': 'America/New_York', // Maryland
    '248': 'America/Chicago', // Michigan
    '251': 'America/New_York', // Massachusetts
    '252': 'America/New_York', // North Carolina
    '253': 'America/Los_Angeles', // Washington
    '254': 'America/Chicago', // Texas
    '256': 'America/Chicago', // Alabama
    '260': 'America/New_York', // Indiana
    '262': 'America/Chicago', // Wisconsin
    '267': 'America/New_York', // Pennsylvania
    '269': 'America/Chicago', // Michigan
    '270': 'America/New_York', // Kentucky
    '272': 'America/New_York', // Pennsylvania
    '274': 'America/Chicago', // Wisconsin
    '276': 'America/New_York', // Connecticut
    '278': 'America/New_York', // Michigan
    '281': 'America/Chicago', // Illinois
    '283': 'America/New_York', // New York
    '301': 'America/New_York', // Maryland
    '302': 'America/New_York', // Delaware
    '303': 'America/Denver', // Colorado
    '304': 'America/New_York', // West Virginia
    '305': 'America/New_York', // Florida
    '307': 'America/Denver', // Wyoming
    '308': 'America/Chicago', // North Dakota
    '309': 'America/Chicago', // Illinois
    '310': 'America/Los_Angeles', // California
    '312': 'America/Los_Angeles', // California
    '313': 'America/New_York', // Michigan
    '314': 'America/Denver', // Nebraska
    '315': 'America/New_York', // New York
    '316': 'America/Chicago', // Illinois
    '317': 'America/New_York', // Pennsylvania
    '318': 'America/New_York', // Massachusetts
    '319': 'America/New_York', // New York
    '320': 'America/New_York', // New York
    '321': 'America/New_York', // New York
    '323': 'America/New_York', // New York
    '325': 'America/Chicago', // Alabama
    '326': 'America/New_York', // Virginia
    '327': 'America/New_York', // Vermont
    '330': 'America/New_York', // Florida
    '331': 'America/New_York', // Florida
    '332': 'America/New_York', // New York
    '334': 'America/Chicago', // Alabama
    '336': 'America/New_York', // North Carolina
    '337': 'America/Chicago', // Louisiana
    '339': 'America/New_York', // Massachusetts
    '340': 'America/New_York', // US Virgin Islands
    '341': 'America/New_York', // Florida
    '346': 'America/New_York', // Texas
    '347': 'America/New_York', // Florida
    '351': 'America/New_York', // Massachusetts
    '352': 'America/New_York', // North Carolina
    '360': 'America/Los_Angeles', // Washington
    '361': 'America/New_York', // New York
    '364': 'America/New_York', // Kentucky
    '365': 'America/New_York', // Ohio
    '385': 'America/Denver', // Utah
    '386': 'America/New_York', // North Carolina
    '401': 'America/New_York', // Rhode Island
    '402': 'America/Chicago', // Nebraska
    '404': 'America/New_York', // Georgia
    '405': 'America/Chicago', // Oklahoma
    '406': 'America/Denver', // Montana
    '407': 'America/New_York', // Florida
    '408': 'America/New_York', // Florida
    '409': 'America/Chicago', // Texas
    '410': 'America/New_York', // Maryland
    '412': 'America/New_York', // Vermont
    '413': 'America/New_York', // Massachusetts
    '414': 'America/Chicago', // Wisconsin
    '415': 'America/Los_Angeles', // California
    '417': 'America/Chicago', // Missouri
    '419': 'America/New_York', // Ohio
    '423': 'America/Chicago', // Tennessee
    '424': 'America/Los_Angeles', // California
    '425': 'America/Los_Angeles', // Washington
    '430': 'America/Chicago', // Illinois
    '432': 'America/Chicago', // Texas
    '434': 'America/New_York', // North Carolina
    '435': 'America/Denver', // Colorado
    '440': 'America/New_York', // Ohio
    '442': 'America/Los_Angeles', // California
    '443': 'America/New_York', // Ohio
    '445': 'America/Los_Angeles', // California
    '447': 'America/Chicago', // Illinois
    '448': 'America/Denver', // Utah
    '450': 'America/Los_Angeles', // California
    '456': 'America/New_York', // West Virginia
    '458': 'America/Chicago', // Indiana
    '463': 'America/Chicago', // Kentucky
    '464': 'America/Chicago', // Utah
    '469': 'America/Chicago', // Texas
    '470': 'America/New_York', // Georgia
    '475': 'America/New_York', // North Carolina
    '478': 'America/New_York', // Georgia
    '479': 'America/Chicago', // Wisconsin
    '480': 'America/Phoenix', // Arizona
    '484': 'America/Chicago', // Texas
    '501': 'America/New_York', // Massachusetts
    '502': 'America/New_York', // New Hampshire
    '503': 'America/Los_Angeles', // Oregon
    '504': 'America/New_York', // Maine
    '505': 'America/Denver', // Colorado
    '507': 'America/New_York', // Massachusetts
    '508': 'America/New_York', // Massachusetts
    '509': 'America/Los_Angeles', // Washington
    '510': 'America/New_York', // Massachusetts
    '512': 'America/Chicago', // Texas
    '513': 'America/New_York', // Ohio
    '515': 'America/Chicago', // Nebraska
    '516': 'America/New_York', // Michigan
    '517': 'America/New_York', // Michigan
    '518': 'America/New_York', // Massachusetts
    '520': 'America/Phoenix', // Arizona
    '530': 'America/Los_Angeles', // California
    '531': 'America/New_York', // Ohio
    '534': 'America/Los_Angeles', // California
    '539': 'America/New_York', // Massachusetts
    '540': 'America/New_York', // West Virginia
    '541': 'America/Los_Angeles', // Oregon
    '551': 'America/New_York', // New Jersey
    '557': 'America/Chicago', // Missouri
    '559': 'America/Los_Angeles', // California
    '561': 'America/New_York', // Florida
    '562': 'America/Los_Angeles', // California
    '563': 'America/Chicago', // Iowa
    '564': 'America/Los_Angeles', // California
    '567': 'America/New_York', // Pennsylvania
    '570': 'America/New_York', // Pennsylvania
    '571': 'America/New_York', // Virginia
    '573': 'America/Chicago', // Missouri
    '574': 'America/New_York', // Wisconsin
    '575': 'America/New_York', // North Carolina
    '580': 'America/Chicago', // Oklahoma
    '585': 'America/New_York', // New York
    '586': 'America/Denver', // Utah
    '587': 'America/New_York', // Maine
    '601': 'America/Chicago', // Mississippi
    '602': 'America/Phoenix', // Arizona
    '603': 'America/New_York', // New Hampshire
    '605': 'America/New_York', // Massachusetts
    '606': 'America/New_York', // Kentucky
    '607': 'America/New_York', // New York
    '608': 'America/Chicago', // Wisconsin
    '609': 'America/New_York', // New Jersey
    '610': 'America/New_York', // Pennsylvania
    '612': 'America/Chicago', // Minnesota
    '614': 'America/New_York', // Ohio
    '615': 'America/Chicago', // Tennessee
    '616': 'America/New_York', // Michigan
    '617': 'America/New_York', // Massachusetts
    '618': 'America/Chicago', // Illinois
    '619': 'America/Los_Angeles', // California
    '620': 'America/New_York', // New York
    '623': 'America/Phoenix', // Arizona
    '626': 'America/Los_Angeles', // California
    '627': 'America/Chicago', // Missouri
    '628': 'America/Los_Angeles', // California
    '629': 'America/New_York', // North Carolina
    '630': 'America/Chicago', // Illinois
    '631': 'America/New_York', // New York
    '636': 'America/Chicago', // Missouri
    '641': 'America/Chicago', // Iowa
    '646': 'America/New_York', // Missouri
    '647': 'America/New_York', // Ontario, Canada (Eastern)
    '650': 'America/Los_Angeles', // California
    '651': 'America/Chicago', // Minnesota
    '657': 'America/Chicago', // Missouri
    '660': 'America/Chicago', // Missouri
    '661': 'America/Los_Angeles', // California
    '662': 'America/New_York', // Florida
    '667': 'America/Chicago', // Missouri
    '669': 'America/Los_Angeles', // California
    '670': 'America/New_York', // Northern Mariana Islands
    '671': 'Pacific/Guam', // Guam
    '678': 'America/New_York', // Georgia
    '679': 'America/Chicago', // Illinois
    '680': 'America/New_York', // New York
    '681': 'America/Denver', // Colorado
    '682': 'America/Phoenix', // Arizona
    '684': 'Pacific/Pago_Pago', // American Samoa
    '689': 'Pacific/Honolulu', // Hawaii
    '701': 'America/Chicago', // North Dakota
    '702': 'America/Los_Angeles', // Nevada
    '703': 'America/New_York', // Virginia
    '704': 'America/New_York', // North Carolina
    '706': 'America/New_York', // Georgia
    '707': 'America/Los_Angeles', // California
    '708': 'America/New_York', // Illinois
    '712': 'America/Chicago', // Iowa
    '713': 'America/Chicago', // Texas
    '714': 'America/Los_Angeles', // California
    '715': 'America/Chicago', // Wisconsin
    '716': 'America/New_York', // New York
    '717': 'America/New_York', // Pennsylvania
    '718': 'America/New_York', // New York
    '719': 'America/Denver', // Colorado
    '720': 'America/Denver', // Colorado
    '724': 'America/New_York', // Pennsylvania
    '725': 'America/Los_Angeles', // Nevada
    '727': 'America/New_York', // Florida
    '728': 'America/New_York', // Florida
    '730': 'America/Chicago', // Illinois
    '731': 'America/New_York', // New Hampshire
    '732': 'America/New_York', // New Jersey
    '734': 'America/New_York', // Michigan
    '737': 'America/Chicago', // Texas
    '740': 'America/New_York', // Ohio
    '743': 'America/New_York', // North Carolina
    '747': 'America/Los_Angeles', // California
    '754': 'America/New_York', // Florida
    '757': 'America/New_York', // Virginia
    '760': 'America/Los_Angeles', // California
    '762': 'America/New_York', // Georgia
    '763': 'America/Chicago', // Minnesota
    '764': 'America/Los_Angeles', // California
    '765': 'America/New_York', // Indiana
    '769': 'America/Chicago', // Mississippi
    '770': 'America/New_York', // Georgia
    '772': 'America/New_York', // Florida
    '773': 'America/Chicago', // Illinois
    '774': 'America/New_York', // Massachusetts
    '775': 'America/Los_Angeles', // Nevada
    '779': 'America/Chicago', // Illinois
    '781': 'America/New_York', // Massachusetts
    '785': 'America/Chicago', // Kansas
    '786': 'America/New_York', // Florida
    '787': 'America/Puerto_Rico', // Puerto Rico
    '801': 'America/Denver', // Utah
    '802': 'America/New_York', // Vermont
    '803': 'America/New_York', // South Carolina
    '804': 'America/New_York', // Virginia
    '805': 'America/Los_Angeles', // California
    '806': 'America/Chicago', // Texas
    '808': 'Pacific/Honolulu', // Hawaii
    '810': 'America/New_York', // Michigan
    '812': 'America/New_York', // Florida
    '813': 'America/New_York', // Florida
    '814': 'America/New_York', // Pennsylvania
    '815': 'America/Chicago', // Illinois
    '816': 'America/Chicago', // Missouri
    '817': 'America/Chicago', // Texas
    '818': 'America/Los_Angeles', // California
    '828': 'America/New_York', // North Carolina
    '830': 'America/Chicago', // Texas
    '831': 'America/Los_Angeles', // California
    '832': 'America/Chicago', // Texas
    '843': 'America/New_York', // South Carolina
    '845': 'America/New_York', // New York
    '847': 'America/Chicago', // Illinois
    '848': 'America/New_York', // New Jersey
    '850': 'America/Chicago', // Florida
    '856': 'America/New_York', // New Jersey
    '857': 'America/New_York', // Massachusetts
    '858': 'America/Los_Angeles', // California
    '859': 'America/New_York', // Kentucky
    '860': 'America/New_York', // Connecticut
    '862': 'America/New_York', // New Jersey
    '863': 'America/New_York', // Florida
    '864': 'America/Chicago', // South Carolina
    '865': 'America/New_York', // Tennessee
    '870': 'America/Chicago', // Arkansas
    '872': 'America/Chicago', // Illinois
    '878': 'America/New_York', // Pennsylvania
    '901': 'America/Chicago', // Tennessee
    '903': 'America/Chicago', // Texas
    '904': 'America/New_York', // Florida
    '906': 'America/New_York', // Michigan
    '907': 'America/New_York', // New York
    '908': 'America/New_York', // New Jersey
    '909': 'America/Los_Angeles', // California
    '910': 'America/New_York', // North Carolina
    '912': 'America/New_York', // Georgia
    '913': 'America/Chicago', // Kansas
    '914': 'America/New_York', // New York
    '915': 'America/Chicago', // Texas
    '916': 'America/New_York', // West Virginia
    '917': 'America/New_York', // New York
    '918': 'America/Chicago', // Oklahoma
    '919': 'America/New_York', // North Carolina
    '920': 'America/Chicago', // Wisconsin
    '925': 'America/Los_Angeles', // California
    '928': 'America/Phoenix', // Arizona
    '929': 'America/New_York', // New York
    '930': 'America/Los_Angeles', // California
    '931': 'America/Los_Angeles', // California
    '934': 'America/New_York', // South Carolina
    '936': 'America/Chicago', // Texas
    '937': 'America/New_York', // Ohio
    '938': 'America/New_York', // Alabama
    '939': 'America/Los_Angeles', // California
    '940': 'America/Los_Angeles', // California
    '941': 'America/New_York', // Florida
    '947': 'America/Los_Angeles', // California
    '949': 'America/Los_Angeles', // California
    '951': 'America/Los_Angeles', // California
    '952': 'America/Chicago', // Minnesota
    '954': 'America/New_York', // Florida
    '956': 'America/Chicago', // Texas
    '957': 'America/New_York', // Maine
    '958': 'America/Los_Angeles', // California
    '959': 'America/Los_Angeles', // California
    '970': 'America/Denver', // Colorado
    '971': 'America/Los_Angeles', // California
    '972': 'America/New_York', // New York
    '973': 'America/New_York', // New Jersey
    '974': 'America/New_York', // North Carolina
    '975': 'America/Los_Angeles', // California
    '978': 'America/New_York', // Massachusetts
    '979': 'America/Chicago', // Texas
    '980': 'America/Los_Angeles', // California
    '984': 'America/Denver', // Colorado
    '985': 'America/Los_Angeles', // California
    '986': 'America/New_York', // Maine
    '989': 'America/Los_Angeles', // California
  };
  
  const timezone = areaCodeToTimezone[areaCode] || null;
  console.log('🗺️ getUSTimezoneFromAreaCode - Result:', { areaCode, timezone });
  return timezone;
};

/**
 * Get timezone for US country using area code from phone number
 * @param phone - Phone number string
 * @param mobile - Mobile number string (fallback if phone is not available)
 * @returns IANA timezone string or null
 */
export const getUSTimezoneFromPhone = (phone?: string | null, mobile?: string | null): string | null => {
  const phoneToCheck = phone || mobile;
  if (!phoneToCheck) return null;
  
  const areaCode = getUSAreaCode(phoneToCheck);
  if (!areaCode) return null;
  
  return getUSTimezoneFromAreaCode(areaCode);
};

