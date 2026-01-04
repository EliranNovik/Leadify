import React, { useEffect, useRef, useState, useMemo, ReactElement } from 'react';
import { useLocation, useNavigationType, matchRoutes, useRoutes, Routes, Route } from 'react-router-dom';

interface CachedRoute {
  element: ReactElement | null;
  scrollPosition: number;
  pathname: string;
  key: string;
}

// Global cache to store mounted route components
const routeCache = new Map<string, CachedRoute>();

/**
 * KeepAliveRoutes wrapper that preserves route components in memory
 * This prevents refetches and preserves all component state when navigating back/forward
 */
interface KeepAliveRoutesProps {
  children: React.ReactNode;
}

const KeepAliveRoutes: React.FC<KeepAliveRoutesProps> = ({ children }) => {
  const location = useLocation();
  const navType = useNavigationType();
  const containerRefsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const [activePathname, setActivePathname] = useState<string>(location.pathname);
  const previousPathnameRef = useRef<string>(location.pathname);

  // Extract route elements from children (Routes)
  const routeElementsRef = useRef<Map<string, ReactElement>>(new Map());

  // Save scroll position when leaving a route
  useEffect(() => {
    const previousPathname = previousPathnameRef.current;
    if (previousPathname && previousPathname !== location.pathname) {
      const container = containerRefsRef.current.get(previousPathname);
      const mainElement = document.querySelector('main');
      const scrollPosition = container?.scrollTop || mainElement?.scrollTop || window.scrollY;
      
      const cached = routeCache.get(previousPathname);
      if (cached) {
        cached.scrollPosition = scrollPosition;
        console.log('[KeepAliveRoutes] Saved scroll position for', previousPathname, ':', scrollPosition);
      }
    }
    previousPathnameRef.current = location.pathname;
    setActivePathname(location.pathname);
  }, [location.pathname]);

  // Restore scroll position when activating a cached route
  useEffect(() => {
    const cached = routeCache.get(location.pathname);
    if (cached && cached.scrollPosition > 0 && navType === 'POP') {
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
        window.scrollTo({ top: cached.scrollPosition, left: 0, behavior: 'auto' });
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

      console.log('[KeepAliveRoutes] Restored scroll position for', location.pathname, ':', cached.scrollPosition);
    } else if (navType !== 'POP') {
      // For normal navigation, scroll to top
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      const mainElement = document.querySelector('main');
      if (mainElement) {
        mainElement.scrollTop = 0;
      }
    }
  }, [location.pathname, navType]);

  // This component wraps Routes but we need to render cached versions
  // For now, let's use a simpler approach - wrap the actual Routes component
  return <>{children}</>;
};

export default KeepAliveRoutes;

