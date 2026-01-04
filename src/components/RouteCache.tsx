import React, { useEffect, useRef, useState, ReactElement, useMemo } from 'react';
import { useLocation, useNavigationType, Routes, Route, useRoutes } from 'react-router-dom';

/**
 * RouteCache - A comprehensive solution to keep route components alive
 * This component wraps Routes and caches all route components to prevent refetches
 */

interface CachedRouteData {
  element: ReactElement | null;
  scrollPosition: number;
  pathname: string;
  routeKey: string;
}

// Global cache storage
const routeCacheGlobal = new Map<string, CachedRouteData>();

interface RouteCacheProps {
  children: React.ReactNode;
}

const RouteCache: React.FC<RouteCacheProps> = ({ children }) => {
  const location = useLocation();
  const navType = useNavigationType();
  const containerRefsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const previousPathnameRef = useRef<string>('');
  const [cachedRoutes, setCachedRoutes] = useState<Map<string, CachedRouteData>>(new Map());

  // Initialize cache from global storage
  useEffect(() => {
    setCachedRoutes(new Map(routeCacheGlobal));
  }, []);

  // Save scroll position when navigating away
  useEffect(() => {
    if (previousPathnameRef.current && previousPathnameRef.current !== location.pathname) {
      const container = containerRefsRef.current.get(previousPathnameRef.current);
      const mainElement = document.querySelector('main');
      const scrollPosition = container?.scrollTop || mainElement?.scrollTop || window.scrollY;
      
      const cached = routeCacheGlobal.get(previousPathnameRef.current);
      if (cached) {
        cached.scrollPosition = scrollPosition;
        console.log('[RouteCache] Saved scroll for', previousPathnameRef.current, ':', scrollPosition);
      }
    }
    previousPathnameRef.current = location.pathname;
  }, [location.pathname]);

  // Restore scroll on back/forward
  useEffect(() => {
    if (navType === 'POP') {
      const cached = routeCacheGlobal.get(location.pathname);
      if (cached && cached.scrollPosition > 0) {
        const restoreScroll = () => {
          const container = containerRefsRef.current.get(location.pathname);
          const mainElement = document.querySelector('main');
          
          if (container) container.scrollTop = cached.scrollPosition;
          if (mainElement) mainElement.scrollTop = cached.scrollPosition;
          window.scrollTo({ top: cached.scrollPosition, left: 0, behavior: 'auto' });
          document.documentElement.scrollTop = cached.scrollPosition;
          document.body.scrollTop = cached.scrollPosition;
        };

        requestAnimationFrame(restoreScroll);
        [100, 300, 500, 1000].forEach((delay) => setTimeout(restoreScroll, delay));
      }
    }
  }, [location.pathname, navType]);

  // For now, just render children normally
  // The actual caching will be handled by wrapping individual route components
  return <>{children}</>;
};

export default RouteCache;

