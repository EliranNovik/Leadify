import React, { useEffect, useRef, ReactElement, useState, useMemo } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { cacheRouteInstance, getCachedRouteInstance, updateCachedScrollPosition } from '../utils/routeCache';

interface PageKeepAliveProps {
  children: ReactElement;
  pathname: string;
}

/**
 * PageKeepAlive - Wrapper component to keep page components alive
 * This prevents refetches and preserves component state when navigating away
 */
const PageKeepAlive: React.FC<PageKeepAliveProps> = ({ children, pathname }) => {
  const location = useLocation();
  const navType = useNavigationType();
  const containerRef = useRef<HTMLDivElement>(null);
  const isActiveRef = useRef<boolean>(true);
  const previousPathnameRef = useRef<string>(pathname);
  const [mounted, setMounted] = useState(true);

  // Determine if this page should be active
  const isActive = useMemo(() => {
    return location.pathname === pathname || location.pathname.startsWith(pathname + '/');
  }, [location.pathname, pathname]);

  // Update active state
  useEffect(() => {
    isActiveRef.current = isActive;
    setMounted(true); // Keep mounted even when not active
  }, [isActive]);

  // Save scroll position when leaving
  useEffect(() => {
    if (previousPathnameRef.current !== location.pathname) {
      const container = containerRef.current;
      const mainElement = document.querySelector('main');
      const scrollPosition = container?.scrollTop || mainElement?.scrollTop || window.scrollY;
      
      updateCachedScrollPosition(previousPathnameRef.current, scrollPosition);
      previousPathnameRef.current = location.pathname;
    }
  }, [location.pathname]);

  // Restore scroll position when returning
  useEffect(() => {
    if (isActive && navType === 'POP') {
      const cached = getCachedRouteInstance(pathname);
      if (cached && cached.scrollPosition > 0) {
        const restoreScroll = () => {
          const container = containerRef.current;
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
      }
    }
  }, [isActive, pathname, navType]);

  // Keep component mounted but hidden when not active
  if (!mounted) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      style={{
        display: isActive ? 'block' : 'none',
        width: '100%',
        height: '100%',
      }}
      className={isActive ? '' : 'keep-alive-hidden'}
      data-pathname={pathname}
    >
      {React.cloneElement(children, { key: pathname })}
    </div>
  );
};

export default PageKeepAlive;

