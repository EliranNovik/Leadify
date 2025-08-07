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
