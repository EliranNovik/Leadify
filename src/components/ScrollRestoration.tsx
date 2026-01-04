import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { cacheRouteInstance, getCachedRouteInstance } from '../utils/routeCache';

const RESTORE_DELAYS = [0, 100, 300, 500, 1000]; // Multiple attempts to ensure restoration works

/**
 * ScrollRestoration - Restores scroll positions using route cache
 * Works together with route caching system to preserve scroll positions
 */
export default function ScrollRestoration() {
  const location = useLocation();
  const navType = useNavigationType();
  const previousPathnameRef = useRef<string>('');
  const isInitialMountRef = useRef<boolean>(true);
  const currentScrollPositionRef = useRef<number>(0);

  console.log('[ScrollRestoration] Component render:', {
    pathname: location.pathname,
    navType,
    key: location.key,
    previousPathname: previousPathnameRef.current,
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
    const currentPathname = location.pathname;
    
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      previousPathnameRef.current = currentPathname;
      return;
    }

    // Cleanup function runs BEFORE the component updates with new pathname
    return () => {
      const pathnameToSave = previousPathnameRef.current || currentPathname;
      // Use the tracked scroll position
      const scrollPosition = currentScrollPositionRef.current;
      
      // Also try to get current position as fallback
      const mainElement = document.querySelector('main');
      const windowScrollY = window.scrollY;
      const mainScrollTop = mainElement?.scrollTop || 0;
      const fallbackScrollPosition = mainScrollTop || windowScrollY;
      const finalScrollPosition = scrollPosition || fallbackScrollPosition;
      
      console.log('[ScrollRestoration] Cleanup - saving scroll position:', {
        pathname: pathnameToSave,
        trackedScrollPosition: scrollPosition,
        windowScrollY,
        mainScrollTop,
        fallbackScrollPosition,
        finalScrollPosition,
        mainElementFound: !!mainElement,
        currentPathname,
        previousPathname: previousPathnameRef.current,
      });
      
      if (pathnameToSave) {
        cacheRouteInstance(pathnameToSave, finalScrollPosition);
      }
      
      // Reset tracked position for next route
      currentScrollPositionRef.current = 0;
    };
  }, [location.pathname]);
  
  // Update previous pathname after save
  useEffect(() => {
    previousPathnameRef.current = location.pathname;
  }, [location.pathname]);

  // Restore scroll position on back/forward
  useEffect(() => {
    console.log('[ScrollRestoration] Restore effect triggered:', {
      pathname: location.pathname,
      navType,
      isPOP: navType === 'POP',
    });

    if (navType === 'POP') {
      const cached = getCachedRouteInstance(location.pathname);
      console.log('[ScrollRestoration] POP navigation - checking cache:', {
        pathname: location.pathname,
        cached: cached ? {
          scrollPosition: cached.scrollPosition,
          timestamp: cached.timestamp,
        } : null,
        hasCachedPosition: !!cached && cached.scrollPosition > 0,
      });

      if (cached && cached.scrollPosition > 0) {
        const restoreScroll = (attempt: number) => {
          const mainElement = document.querySelector('main');
          const targetScroll = cached.scrollPosition;
          
          console.log(`[ScrollRestoration] Restore attempt ${attempt}:`, {
            targetScroll,
            mainElementFound: !!mainElement,
            currentWindowScrollY: window.scrollY,
            currentMainScrollTop: mainElement?.scrollTop || 0,
            currentDocElementScrollTop: document.documentElement.scrollTop,
            currentBodyScrollTop: document.body.scrollTop,
          });

          if (mainElement) {
            mainElement.scrollTop = targetScroll;
            console.log(`[ScrollRestoration] Set mainElement.scrollTop to ${targetScroll}, now: ${mainElement.scrollTop}`);
          }
          
          window.scrollTo({ top: targetScroll, left: 0, behavior: 'auto' });
          document.documentElement.scrollTop = targetScroll;
          document.body.scrollTop = targetScroll;

          // Log after scroll
          setTimeout(() => {
            console.log(`[ScrollRestoration] After restore attempt ${attempt}:`, {
              windowScrollY: window.scrollY,
              mainScrollTop: mainElement?.scrollTop || 0,
              docElementScrollTop: document.documentElement.scrollTop,
              bodyScrollTop: document.body.scrollTop,
              success: window.scrollY === targetScroll || (mainElement && mainElement.scrollTop === targetScroll),
            });
          }, 50);
        };

        console.log('[ScrollRestoration] Starting restore attempts with delays:', RESTORE_DELAYS);
        requestAnimationFrame(() => restoreScroll(0));
        RESTORE_DELAYS.forEach((delay, index) => {
          setTimeout(() => restoreScroll(index + 1), delay);
        });
      } else {
        console.log('[ScrollRestoration] No cached position found for POP navigation, scrolling to top');
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      }
    } else {
      // Normal navigation - scroll to top (but don't override if we have cached position)
      const cached = getCachedRouteInstance(location.pathname);
      console.log('[ScrollRestoration] Normal navigation (not POP):', {
        pathname: location.pathname,
        navType,
        hasCached: !!cached,
        cachedScrollPosition: cached?.scrollPosition || 0,
        willScrollToTop: !cached || cached.scrollPosition === 0,
      });

      if (!cached || cached.scrollPosition === 0) {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
        const mainElement = document.querySelector('main');
        if (mainElement) {
          mainElement.scrollTop = 0;
        }
        console.log('[ScrollRestoration] Scrolled to top (normal navigation)');
      } else {
        console.log('[ScrollRestoration] Has cached position but not POP, keeping cached scroll');
      }
    }
  }, [location.pathname, navType]);

  return null;
}

