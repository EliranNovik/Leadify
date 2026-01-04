import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useLocation, useOutlet, useNavigationType } from 'react-router-dom';

interface CachedRoute {
  element: React.ReactElement | null;
  scrollPosition: number;
  pathname: string;
}

// Global cache to store mounted components by pathname
const routeCache = new Map<string, CachedRoute>();

/**
 * KeepAliveOutlet component that wraps React Router's Outlet
 * to preserve route components in memory instead of unmounting them.
 * This prevents refetches and preserves all component state.
 */
const KeepAliveOutlet: React.FC = () => {
  const location = useLocation();
  const outlet = useOutlet();
  const navType = useNavigationType();
  const containerRefsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const isBackForward = navType === 'POP';
  const [activePathname, setActivePathname] = useState<string>(location.pathname);

  // Get or create cache entry for current pathname
  const currentCache = useMemo(() => {
    if (!routeCache.has(location.pathname)) {
      routeCache.set(location.pathname, {
        element: null,
        scrollPosition: 0,
        pathname: location.pathname,
      });
    }
    return routeCache.get(location.pathname)!;
  }, [location.pathname]);

  // Save scroll position when leaving a route
  useEffect(() => {
    const previousPathname = activePathname;
    if (previousPathname && previousPathname !== location.pathname) {
      const container = containerRefsRef.current.get(previousPathname);
      const mainElement = document.querySelector('main');
      const scrollPosition = container?.scrollTop || mainElement?.scrollTop || window.scrollY;
      
      const cached = routeCache.get(previousPathname);
      if (cached) {
        cached.scrollPosition = scrollPosition;
      }
    }
    setActivePathname(location.pathname);
  }, [location.pathname, activePathname]);

  // Update cached element when outlet changes
  useEffect(() => {
    if (outlet) {
      const cached = routeCache.get(location.pathname);
      if (cached && cached.element !== outlet) {
        cached.element = outlet;
      }
    }
  }, [outlet, location.pathname]);

  // Restore scroll position when activating a cached route
  useEffect(() => {
    const cached = routeCache.get(location.pathname);
    if (cached && cached.scrollPosition > 0) {
      const restoreScroll = () => {
        const container = containerRefsRef.current.get(location.pathname);
        const mainElement = document.querySelector('main');
        
        // Restore container scroll
        if (container) {
          container.scrollTop = cached.scrollPosition;
        }
        
        // Restore main element scroll
        if (mainElement) {
          mainElement.scrollTop = cached.scrollPosition;
        }
        
        // Restore window scroll
        window.scrollTo(0, cached.scrollPosition);
        document.documentElement.scrollTop = cached.scrollPosition;
        document.body.scrollTop = cached.scrollPosition;
      };

      // Immediate restore
      requestAnimationFrame(() => {
        restoreScroll();
      });

      // Multiple delayed restores to handle async content
      [100, 300, 500, 1000].forEach((delay) => {
        setTimeout(() => {
          restoreScroll();
        }, delay);
      });
    }
  }, [location.pathname, activePathname]);

  // Render all cached routes, but only show the active one
  return (
    <>
      {Array.from(routeCache.entries()).map(([pathname, cached]) => {
        const isActive = pathname === location.pathname;
        const element = cached.element || (isActive ? outlet : null);

        if (!element) return null;

        return (
          <div
            key={pathname}
            ref={(el) => {
              if (el) {
                containerRefsRef.current.set(pathname, el);
              } else {
                containerRefsRef.current.delete(pathname);
              }
            }}
            style={{
              display: isActive ? 'block' : 'none',
              width: '100%',
              height: '100%',
            }}
            className={isActive ? '' : 'keep-alive-hidden'}
            data-pathname={pathname}
          >
            {element}
          </div>
        );
      })}
    </>
  );
};

export default KeepAliveOutlet;

