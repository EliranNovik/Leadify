import React, { useEffect, useRef, useState, ReactElement, useMemo } from 'react';
import { useLocation, useNavigationType, useOutlet } from 'react-router-dom';

interface CachedOutlet {
  outlet: ReactElement | null;
  scrollPosition: number;
  pathname: string;
}

// Global cache for route outlets
const outletCache = new Map<string, CachedOutlet>();

/**
 * RouteKeepAlive - Preserves route components using React Router's Outlet
 * This is a simpler approach that works with React Router's Outlet system
 */
const RouteKeepAlive: React.FC = () => {
  const location = useLocation();
  const outlet = useOutlet();
  const navType = useNavigationType();
  const containerRefsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const previousPathnameRef = useRef<string>(location.pathname);
  const [renderCache, setRenderCache] = useState<Map<string, ReactElement | null>>(new Map());

  // Update cache when outlet changes
  useEffect(() => {
    if (outlet) {
      const cached = outletCache.get(location.pathname);
      if (cached) {
        cached.outlet = outlet;
      } else {
        outletCache.set(location.pathname, {
          outlet,
          scrollPosition: 0,
          pathname: location.pathname,
        });
      }

      // Update render cache
      setRenderCache((prev) => {
        const next = new Map(prev);
        next.set(location.pathname, outlet);
        return next;
      });
    }
  }, [outlet, location.pathname]);

  // Save scroll position when leaving
  useEffect(() => {
    const previousPathname = previousPathnameRef.current;
    if (previousPathname && previousPathname !== location.pathname) {
      const container = containerRefsRef.current.get(previousPathname);
      const mainElement = document.querySelector('main');
      const scrollPosition = container?.scrollTop || mainElement?.scrollTop || window.scrollY;
      
      const cached = outletCache.get(previousPathname);
      if (cached) {
        cached.scrollPosition = scrollPosition;
        console.log('[RouteKeepAlive] Saved scroll for', previousPathname, ':', scrollPosition);
      }
    }
    previousPathnameRef.current = location.pathname;
  }, [location.pathname]);

  // Restore scroll position when returning to a cached route
  useEffect(() => {
    if (navType === 'POP') {
      const cached = outletCache.get(location.pathname);
      if (cached && cached.scrollPosition > 0) {
        const restoreScroll = () => {
          const container = containerRefsRef.current.get(location.pathname);
          const mainElement = document.querySelector('main');
          
          if (container) {
            container.scrollTop = cached.scrollPosition;
          }
          if (mainElement) {
            mainElement.scrollTop = cached.scrollPosition;
          }
          window.scrollTo({ top: cached.scrollPosition, left: 0, behavior: 'auto' });
          document.documentElement.scrollTop = cached.scrollPosition;
          document.body.scrollTop = cached.scrollPosition;
        };

        requestAnimationFrame(restoreScroll);
        [100, 300, 500, 1000].forEach((delay) => {
          setTimeout(restoreScroll, delay);
        });

        console.log('[RouteKeepAlive] Restored scroll for', location.pathname, ':', cached.scrollPosition);
      }
    } else {
      // Normal navigation - scroll to top
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      const mainElement = document.querySelector('main');
      if (mainElement) {
        mainElement.scrollTop = 0;
      }
    }
  }, [location.pathname, navType]);

  // Render all cached outlets, but only show the active one
  const cacheEntries = useMemo(() => Array.from(outletCache.entries()), [renderCache]);

  return (
    <>
      {cacheEntries.map(([pathname, cached]) => {
        const isActive = pathname === location.pathname;
        const element = cached.outlet;

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

export default RouteKeepAlive;

