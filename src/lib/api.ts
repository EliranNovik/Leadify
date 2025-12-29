// API configuration for different environments
const getApiBaseUrl = () => {
  // In development, use relative URLs (proxy handles it)
  if (import.meta.env.DEV) {
    return '';
  }
  
  // In production, use the full backend URL
  return 'https://leadify-crm-backend.onrender.com';
};

export const apiBaseUrl = getApiBaseUrl();

// Helper function to build API URLs
export const buildApiUrl = (endpoint: string): string => {
  return `${apiBaseUrl}${endpoint}`;
};

// Frontend base URL - always use production domain for public links
// Public contract links need to work regardless of where they're generated from
export const getFrontendBaseUrl = (): string => {
  // Always use production domain for public contract links
  return 'https://rainmakerqueen.org';
};
