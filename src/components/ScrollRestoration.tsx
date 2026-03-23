import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { cacheRouteInstance, getCachedRouteInstance } from '../utils/routeCache';

const RESTORE_DELAYS = [0, 100, 300, 500, 1000]; // Multiple attempts to ensure restoration works
const SCROLL_DEBUG = typeof window !== 'undefined' && (window as any).__SCROLL_DEBUG__ === true;

/**
 * ScrollRestoration - Restores scroll positions using route cache
 * Works together with route caching system to preserve scroll positions
 */
export default function ScrollRestoration() {
  const location = useLocation();
  const navType = useNavigationType();
  const previousRouteKeyRef = useRef<string>('');
  const isInitialMountRef = useRef<boolean>(true);
  const currentScrollPositionRef = useRef<number>(0);
  const currentRouteKey = `${location.pathname}${location.search}`;

  if (SCROLL_DEBUG) console.log('[ScrollRestoration] Component render:', {
    routeKey: currentRouteKey,
    navType,
    key: location.key,
    previousRouteKey: previousRouteKeyRef.current,
    isInitialMount: isInitialMountRef.current,
    currentScrollPosition: currentScrollPositionRef.current,
  });

  // Continuously track scroll position
  useEffect(() => {
    const handleScroll = () => {
      const mainElement = document.querySelector('main');
      const windowScrollY = window.scrollY;
      const mainScrollTop = mainElement?.scrollTop || 0;
      const scrollPosition = mainScrollTop || windowScrollY;
      
      currentScrollPositionRef.current = scrollPosition;
    };

    // Listen to both main element scroll and window scroll
    const mainElement = document.querySelector('main');
    if (mainElement) {
      mainElement.addEventListener('scroll', handleScroll, { passive: true });
    }
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      if (mainElement) {
        mainElement.removeEventListener('scroll', handleScroll);
      }
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // Save scroll position when leaving (use cleanup to save BEFORE navigation)
  useEffect(() => {
    const routeKeyAtRender = currentRouteKey;
    
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      previousRouteKeyRef.current = routeKeyAtRender;
      return;
    }

    // Cleanup function runs BEFORE the component updates with new pathname
    return () => {
      const routeKeyToSave = previousRouteKeyRef.current || routeKeyAtRender;
      // Use the tracked scroll position
      const scrollPosition = currentScrollPositionRef.current;
      
      // Also try to get current position as fallback
      const mainElement = document.querySelector('main');
      const windowScrollY = window.scrollY;
      const mainScrollTop = mainElement?.scrollTop || 0;
      const fallbackScrollPosition = mainScrollTop || windowScrollY;
      const finalScrollPosition = scrollPosition || fallbackScrollPosition;
      
      if (SCROLL_DEBUG) console.log('[ScrollRestoration] Cleanup - saving scroll position:', {
        routeKey: routeKeyToSave,
        trackedScrollPosition: scrollPosition,
        windowScrollY,
        mainScrollTop,
        fallbackScrollPosition,
        finalScrollPosition,
        mainElementFound: !!mainElement,
        routeKeyAtRender,
        previousRouteKey: previousRouteKeyRef.current,
      });
      
      if (routeKeyToSave) {
        cacheRouteInstance(routeKeyToSave, finalScrollPosition);
      }
      
      // Reset tracked position for next route
      currentScrollPositionRef.current = 0;
    };
  }, [currentRouteKey]);
  
  // Update previous route key after save
  useEffect(() => {
    previousRouteKeyRef.current = currentRouteKey;
  }, [currentRouteKey]);

  // Restore scroll position whenever we navigate to a route with cached state.
  useEffect(() => {
    if (SCROLL_DEBUG) console.log('[ScrollRestoration] Restore effect triggered:', {
      routeKey: currentRouteKey,
      navType,
      isPOP: navType === 'POP',
    });

    const cached = getCachedRouteInstance(currentRouteKey);
    const restoreScroll = (targetScroll: number, attempt: number) => {
      const mainElement = document.querySelector('main');
      
      if (SCROLL_DEBUG) console.log(`[ScrollRestoration] Restore attempt ${attempt}:`, {
        routeKey: currentRouteKey,
        targetScroll,
        mainElementFound: !!mainElement,
        currentWindowScrollY: window.scrollY,
        currentMainScrollTop: mainElement?.scrollTop || 0,
        currentDocElementScrollTop: document.documentElement.scrollTop,
        currentBodyScrollTop: document.body.scrollTop,
      });

      if (mainElement) {
        mainElement.scrollTop = targetScroll;
      }
      window.scrollTo({ top: targetScroll, left: 0, behavior: 'auto' });
      document.documentElement.scrollTop = targetScroll;
      document.body.scrollTop = targetScroll;
    };

    if (cached && cached.scrollPosition > 0) {
      const targetScroll = cached.scrollPosition;
      if (SCROLL_DEBUG) console.log('[ScrollRestoration] Found cached position, restoring:', {
        routeKey: currentRouteKey,
        navType,
        targetScroll,
      });

      requestAnimationFrame(() => restoreScroll(targetScroll, 0));
      RESTORE_DELAYS.forEach((delay, index) => {
        setTimeout(() => restoreScroll(targetScroll, index + 1), delay);
      });
    } else {
      if (SCROLL_DEBUG) console.log('[ScrollRestoration] No cached position, scrolling to top:', {
        routeKey: currentRouteKey,
        navType,
      });
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      const mainElement = document.querySelector('main');
      if (mainElement) {
        mainElement.scrollTop = 0;
      }
    }
  }, [currentRouteKey, navType]);

  return null;
}

