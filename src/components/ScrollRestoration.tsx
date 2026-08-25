import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { cacheRouteInstance, getCachedRouteInstance } from '../utils/routeCache';
import { isKeepAlivePipelinePath } from '../lib/pipelineLiveCache';

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
    const timers: number[] = [];
    const frames: number[] = [];

    const restoreScroll = (targetScroll: number, attempt: number) => {
      // A later timer must not run after the user has already gone back to pipeline.
      if (isKeepAlivePipelinePath(window.location.pathname)) return;

      if (SCROLL_DEBUG) console.log(`[ScrollRestoration] Restore attempt ${attempt}:`, {
        routeKey: currentRouteKey,
        targetScroll,
      });

      const mainElement = document.querySelector('main');
      if (mainElement) mainElement.scrollTop = targetScroll;
      window.scrollTo({ top: targetScroll, left: 0, behavior: 'auto' });
      document.documentElement.scrollTop = targetScroll;
      document.body.scrollTop = targetScroll;
    };

    if (isKeepAlivePipelinePath(location.pathname)) {
      return () => {
        timers.forEach((t) => window.clearTimeout(t));
        frames.forEach((f) => window.cancelAnimationFrame(f));
      };
    }

    if (SCROLL_DEBUG) console.log('[ScrollRestoration] Restore effect triggered:', {
      routeKey: currentRouteKey,
      navType,
      isPOP: navType === 'POP',
    });

    const cached = getCachedRouteInstance(currentRouteKey);

    if (cached && cached.scrollPosition > 0) {
      const targetScroll = cached.scrollPosition;
      frames.push(window.requestAnimationFrame(() => restoreScroll(targetScroll, 0)));
      RESTORE_DELAYS.forEach((delay, index) => {
        timers.push(window.setTimeout(() => restoreScroll(targetScroll, index + 1), delay));
      });
    } else {
      restoreScroll(0, 0);
    }

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      frames.forEach((f) => window.cancelAnimationFrame(f));
    };
  }, [currentRouteKey, navType, location.pathname]);

  return null;
}

