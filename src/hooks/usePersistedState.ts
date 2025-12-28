import { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Check if the current page load is a refresh using Navigation Timing API
 * This is the most reliable way to detect page refresh vs navigation
 */
function isPageRefresh(): boolean {
  if (typeof window === 'undefined' || !window.performance) {
    return false;
  }
  
  try {
    const navEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    if (navEntries.length > 0) {
      const type = navEntries[0].type;
      // 'reload' means page was refreshed (F5, refresh button, etc.)
      // 'navigate' means initial navigation (typing URL, opening link)
      // 'back_forward' means back/forward button navigation
      // For React Router SPAs, 'navigate' usually means initial load or direct navigation
      // 'reload' means actual page refresh
      return type === 'reload';
    }
  } catch (e) {
    // Fallback: if Navigation Timing API is not available, assume it's navigation
    return false;
  }
  
  return false;
}

/**
 * Custom hook to persist state across page navigation (but not across page refresh)
 * Supports both localStorage and URL query parameters
 * 
 * @param key - Unique key for storing state (used for localStorage)
 * @param initialState - Initial state value
 * @param options - Configuration options
 * @returns [state, setState, clearState] - State tuple similar to useState
 */
export function usePersistedState<T>(
  key: string,
  initialState: T,
  options: {
    storage?: 'localStorage' | 'sessionStorage' | 'url' | 'both';
    syncWithUrl?: boolean; // If true, syncs with URL query params
    urlKey?: string; // Key for URL query param (defaults to 'key' parameter)
  } = {}
): [T, (value: T | ((prev: T) => T)) => void, () => void] {
  const {
    storage = 'sessionStorage',
    syncWithUrl = false,
    urlKey = key,
  } = options;

  const location = useLocation();
  const navigate = useNavigate();

  // Get storage key with prefix to avoid conflicts
  const storageKey = `persisted_state_${key}`;

  // Initialize state
  const [state, setStateInternal] = useState<T>(() => {
    // Check if this is a page refresh
    const wasRefresh = isPageRefresh();
    
    if (wasRefresh) {
      // This is a refresh - clear all persisted state for this key
      console.log(`[usePersistedState] Page refresh detected, clearing state for key: ${key}`);
      if (storage === 'localStorage' || storage === 'both') {
        try {
          localStorage.removeItem(storageKey);
        } catch (e) {
          console.warn(`Failed to clear localStorage for ${storageKey}:`, e);
        }
      }
      if (storage === 'sessionStorage' || storage === 'both') {
        try {
          sessionStorage.removeItem(storageKey);
        } catch (e) {
          console.warn(`Failed to clear sessionStorage for ${storageKey}:`, e);
        }
      }
      
      return initialState;
    }

    // This is a navigation (not a refresh) - try to load from storage
    // Try URL first if syncWithUrl is enabled
    if (syncWithUrl) {
      const params = new URLSearchParams(location.search);
      const urlValue = params.get(urlKey);
      if (urlValue) {
        try {
          const parsed = JSON.parse(decodeURIComponent(urlValue));
          return parsed;
        } catch (e) {
          console.warn(`Failed to parse URL state for ${urlKey}:`, e);
        }
      }
    }

    // Try storage
    if (storage === 'localStorage' || storage === 'both') {
      try {
        const item = localStorage.getItem(storageKey);
        if (item) {
          const parsed = JSON.parse(item);
          console.log(`[usePersistedState] Loaded state from localStorage for key: ${key}`, parsed);
          return parsed;
        }
      } catch (e) {
        console.warn(`Failed to read localStorage for ${storageKey}:`, e);
      }
    }

    if (storage === 'sessionStorage' || storage === 'both') {
      try {
        const item = sessionStorage.getItem(storageKey);
        if (item) {
          const parsed = JSON.parse(item);
          console.log(`[usePersistedState] Loaded state from sessionStorage for key: ${key}`, parsed);
          return parsed;
        }
      } catch (e) {
        console.warn(`Failed to read sessionStorage for ${storageKey}:`, e);
      }
    }

    return initialState;
  });

  // Update URL when state changes (if syncWithUrl is enabled)
  const updateUrl = useCallback((newState: T) => {
    if (syncWithUrl) {
      const params = new URLSearchParams(location.search);
      try {
        const serialized = encodeURIComponent(JSON.stringify(newState));
        params.set(urlKey, serialized);
        navigate({ search: params.toString() }, { replace: true });
      } catch (e) {
        console.warn(`Failed to serialize state for URL:`, e);
      }
    }
  }, [syncWithUrl, urlKey, location.search, navigate]);

  // Update storage when state changes
  const updateStorage = useCallback((newState: T) => {
    try {
      const serialized = JSON.stringify(newState);
      
      if (storage === 'localStorage' || storage === 'both') {
        localStorage.setItem(storageKey, serialized);
      }
      
      if (storage === 'sessionStorage' || storage === 'both') {
        sessionStorage.setItem(storageKey, serialized);
      }
    } catch (e) {
      console.warn(`Failed to save state to storage for ${storageKey}:`, e);
    }
  }, [storage, storageKey]);

  // Set state function that also persists
  const setState = useCallback((value: T | ((prev: T) => T)) => {
    setStateInternal((prev) => {
      const newState = typeof value === 'function' 
        ? (value as (prev: T) => T)(prev)
        : value;
      
      updateStorage(newState);
      updateUrl(newState);
      
      return newState;
    });
  }, [updateStorage, updateUrl]);

  // Clear state function
  const clearState = useCallback(() => {
    if (storage === 'localStorage' || storage === 'both') {
      localStorage.removeItem(storageKey);
    }
    if (storage === 'sessionStorage' || storage === 'both') {
      sessionStorage.removeItem(storageKey);
    }
    if (syncWithUrl) {
      const params = new URLSearchParams(location.search);
      params.delete(urlKey);
      navigate({ search: params.toString() }, { replace: true });
    }
    setStateInternal(initialState);
  }, [storage, storageKey, syncWithUrl, urlKey, location.search, navigate, initialState]);

  // Sync state when URL changes (if syncWithUrl is enabled)
  useEffect(() => {
    if (syncWithUrl) {
      const params = new URLSearchParams(location.search);
      const urlValue = params.get(urlKey);
      if (urlValue) {
        try {
          const parsed = JSON.parse(decodeURIComponent(urlValue));
          setStateInternal(parsed);
          updateStorage(parsed);
        } catch (e) {
          console.warn(`Failed to parse URL state for ${urlKey}:`, e);
        }
      }
    }
  }, [location.search, syncWithUrl, urlKey, updateStorage]);

  return [state, setState, clearState];
}

/**
 * Simplified hook for persisting filter states
 * Automatically handles common filter patterns
 */
export function usePersistedFilters<T extends Record<string, any>>(
  key: string,
  initialState: T,
  options: {
    storage?: 'localStorage' | 'sessionStorage' | 'url' | 'both';
    syncWithUrl?: boolean;
  } = {}
) {
  return usePersistedState<T>(`filters_${key}`, initialState, options);
}

