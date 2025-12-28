import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

// Global flag to track if we're navigating (set by navigation interceptors)
// This flag is set when React Router navigates and cleared after state loads
const NAVIGATION_FLAG_KEY = '__react_router_navigating__';
const NAVIGATION_FLAG_TIMEOUT = 1000; // Flag expires after 1 second

// Flag to track if page is unloading (used to detect refreshes)
const PAGE_UNLOADING_KEY = '__page_unloading__';

// Cache refresh check result within the current page load (module-level variable, not sessionStorage)
let cachedRefreshCheckResult: boolean | null = null;

// Set up beforeunload listener to detect page refreshes
if (typeof window !== 'undefined') {
  // This runs when the page is about to unload (both refresh and navigation)
  // We'll use it to set a marker that gets checked on next page load
  window.addEventListener('beforeunload', () => {
    try {
      // Set a marker that page is unloading
      // This marker will exist if the page was refreshed (because sessionStorage persists)
      // But won't exist if it was a navigation (because we clear it before navigation)
      sessionStorage.setItem(PAGE_UNLOADING_KEY, Date.now().toString());
    } catch (e) {
      // Ignore
    }
  });
}

/**
 * Set a flag indicating we're navigating (not refreshing)
 * This should be called when React Router navigation happens
 */
function setNavigationFlag() {
  if (typeof window === 'undefined') return;
  try {
    const now = Date.now();
    sessionStorage.setItem(NAVIGATION_FLAG_KEY, now.toString());
  } catch (e) {
    // Ignore if sessionStorage is not available
  }
}

/**
 * Check if the current page load is a refresh
 * Uses beforeunload marker + navigation flag approach:
 * - On refresh: beforeunload sets PAGE_UNLOADING_KEY, and no NAVIGATION_FLAG_KEY exists
 * - On navigation: NAVIGATION_FLAG_KEY is set before navigation, PAGE_UNLOADING_KEY is cleared
 */
function isPageRefresh(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  
  // Check if we've already determined refresh status in this page load (using module-level cache)
  if (cachedRefreshCheckResult !== null) {
    console.log(`[usePersistedState] Using cached refresh check result: ${cachedRefreshCheckResult}`);
    return cachedRefreshCheckResult;
  }
  
  // Method 1: Check Navigation Timing API
  try {
    const navEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    if (navEntries.length > 0) {
      const navigationType = navEntries[0].type;
      console.log(`[usePersistedState] Navigation type: ${navigationType}`);
      
      // 'reload' definitely means refresh - clear state
      if (navigationType === 'reload') {
        console.log(`[usePersistedState] Page refresh detected via Navigation Timing API (reload)`);
        try {
          sessionStorage.removeItem(NAVIGATION_FLAG_KEY);
          sessionStorage.removeItem(PAGE_UNLOADING_KEY);
        } catch (e) {
          // Ignore
        }
        cachedRefreshCheckResult = true; // Cache result in module variable
        return true;
      }
      
      // 'back_forward' means browser back/forward navigation - preserve state
      if (navigationType === 'back_forward') {
        console.log(`[usePersistedState] Back/forward navigation detected via Navigation Timing API - preserving state`);
        try {
          sessionStorage.removeItem(PAGE_UNLOADING_KEY);
          sessionStorage.removeItem(NAVIGATION_FLAG_KEY); // Clear any stale flags
        } catch (e) {
          // Ignore
        }
        cachedRefreshCheckResult = false; // Cache as navigation
        return false; // This is navigation, preserve state
      }
      
      // 'navigate' means normal navigation (React Router or initial load)
      // We'll check flags below, but if a flag exists, it's likely navigation
      if (navigationType === 'navigate') {
        console.log(`[usePersistedState] Navigation type is 'navigate' - will check flags`);
      }
    }
  } catch (e) {
    console.warn('[usePersistedState] Navigation Timing API check failed:', e);
  }
  
  // Method 2: Default to refresh UNLESS we can definitively prove it's navigation
  // The problem: sessionStorage flags persist across refreshes, making detection unreliable
  // Solution: Only treat as navigation if flag was set BEFORE unloading marker
  // This means flag timestamp < unloading timestamp = navigation
  // If no flag or flag >= unloading timestamp = refresh
  const now = Date.now();
  try {
    const unloadingMarker = sessionStorage.getItem(PAGE_UNLOADING_KEY);
    if (unloadingMarker) {
      const unloadingTime = parseInt(unloadingMarker, 10);
      console.log(`[usePersistedState] PAGE_UNLOADING_KEY marker found, unloaded at: ${unloadingTime}`);
      
      const flagValue = sessionStorage.getItem(NAVIGATION_FLAG_KEY);
      if (flagValue) {
        const flagTime = parseInt(flagValue, 10);
        const timeSinceUnloading = now - unloadingTime;
        
        console.log(`[usePersistedState] Navigation flag found, set at: ${flagTime}, unloading at: ${unloadingTime}, diff: ${unloadingTime - flagTime}ms`);
        
        // Key check: Was flag set BEFORE unloading? (flagTime < unloadingTime)
        // If yes, it was set during navigation in the same session
        // If no (or flagTime >= unloadingTime), flag is from previous session or invalid
        if (flagTime < unloadingTime && (unloadingTime - flagTime) < 5000) {
          // Flag was set before unloading (within 5 seconds) → navigation
          console.log(`[usePersistedState] Navigation flag was set BEFORE unloading → navigation`);
          sessionStorage.removeItem(NAVIGATION_FLAG_KEY);
          sessionStorage.removeItem(PAGE_UNLOADING_KEY);
          cachedRefreshCheckResult = false; // Cache as navigation
          return false;
        } else {
          // Flag was set after unloading or way before (different session) → refresh
          console.log(`[usePersistedState] Navigation flag timing invalid (flag: ${flagTime}, unloading: ${unloadingTime}) → refresh`);
          sessionStorage.removeItem(NAVIGATION_FLAG_KEY);
        }
      }
      
      // No valid navigation flag → refresh
      sessionStorage.removeItem(PAGE_UNLOADING_KEY);
      console.log(`[usePersistedState] PAGE_UNLOADING_KEY found without valid navigation flag → refresh`);
      cachedRefreshCheckResult = true; // Cache as refresh
      return true;
    }
  } catch (e) {
    console.warn('[usePersistedState] PAGE_UNLOADING_KEY check failed:', e);
  }
  
  // Method 3: Check navigation flag (only if PAGE_UNLOADING_KEY doesn't exist)
  // This handles cases where beforeunload didn't fire or Navigation Timing API said 'navigate'
  try {
    const flagValue = sessionStorage.getItem(NAVIGATION_FLAG_KEY);
    if (flagValue) {
      const flagTime = parseInt(flagValue, 10);
      const timeDiff = now - flagTime;
      
      console.log(`[usePersistedState] Found navigation flag (no unloading marker), age: ${timeDiff}ms`);
      
      // Check Navigation Timing API type to decide how strict to be
      let navigationType = 'unknown';
      try {
        const navEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
        if (navEntries.length > 0) {
          navigationType = navEntries[0].type;
        }
      } catch (e) {
        // Ignore
      }
      
      // If Navigation Timing API says 'navigate' and flag exists (even if a bit old), treat as navigation
      // This handles React Router navigation where flags might persist
      if (navigationType === 'navigate' && timeDiff < 10000) { // 10 seconds window for navigate type
        console.log(`[usePersistedState] Navigation type 'navigate' with flag (age: ${timeDiff}ms) → navigation`);
        sessionStorage.removeItem(NAVIGATION_FLAG_KEY);
        cachedRefreshCheckResult = false; // Cache as navigation
        return false;
      }
      
      // Otherwise, use strict timeout check
      if (timeDiff < NAVIGATION_FLAG_TIMEOUT) {
        sessionStorage.removeItem(NAVIGATION_FLAG_KEY);
        console.log(`[usePersistedState] Recent navigation flag found, treating as navigation`);
        cachedRefreshCheckResult = false; // Cache as navigation
        return false;
      } else {
        // Flag is stale, clear it
        console.log(`[usePersistedState] Stale navigation flag found (${timeDiff}ms old), treating as refresh`);
        sessionStorage.removeItem(NAVIGATION_FLAG_KEY);
      }
    }
  } catch (e) {
    console.warn('[usePersistedState] Navigation flag check failed:', e);
  }
  
  // Default: no unloading marker and no navigation flag → likely a refresh
  // (first load or refresh where beforeunload didn't fire)
  console.log(`[usePersistedState] No unloading marker or navigation flag found, treating as refresh`);
  cachedRefreshCheckResult = true; // Cache as refresh
  return true;
}

// Intercept React Router navigations to set the flag
// This needs to be done at the app level, but we'll set it up here as a fallback
if (typeof window !== 'undefined') {
  // Listen for popstate events (back/forward navigation)
  window.addEventListener('popstate', () => {
    setNavigationFlag();
    // Clear cached refresh check result (module-level variable, resets on page load anyway)
    cachedRefreshCheckResult = null;
  });
  
  // Intercept history.pushState and history.replaceState
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  
  history.pushState = function(...args) {
    setNavigationFlag();
    cachedRefreshCheckResult = null; // Clear cached result on navigation
    return originalPushState.apply(history, args);
  };
  
  history.replaceState = function(...args) {
    setNavigationFlag();
    cachedRefreshCheckResult = null; // Clear cached result on navigation
    return originalReplaceState.apply(history, args);
  };
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
  const initializedRef = useRef(false);

  // Get storage key with prefix to avoid conflicts
  const storageKey = `persisted_state_${key}`;

  // Track previous location to detect navigation
  const prevLocationRef = useRef<string>(location.pathname + location.search);
  
  // Intercept location changes to set navigation flag
  useEffect(() => {
    const currentLocation = location.pathname + location.search;
    
    // Only set flag if location actually changed (not on initial mount)
    if (prevLocationRef.current !== currentLocation && initializedRef.current) {
      // Location changed, this is navigation (not refresh)
      setNavigationFlag();
      prevLocationRef.current = currentLocation;
    } else if (!initializedRef.current) {
      // First render - mark as initialized
      initializedRef.current = true;
      prevLocationRef.current = currentLocation;
    }
  }, [location.pathname, location.search]);

  // Initialize state
  const [state, setStateInternal] = useState<T>(() => {
    // Check if this is a page refresh (this must happen BEFORE we check storage)
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
        // Don't set navigation flag for URL updates within the same page
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

