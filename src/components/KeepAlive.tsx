import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';

interface KeepAliveProps {
  children: React.ReactElement;
  cacheKey: string;
}

interface CachedRoute {
  element: React.ReactElement;
  scrollPosition: number;
  cacheKey: string;
  pathname: string;
}

// Global cache to store mounted components
const routeCache = new Map<string, CachedRoute>();

/**
 * KeepAlive component that preserves component state across navigation
 * by keeping components mounted but hidden instead of unmounting them.
 */
const KeepAlive: React.FC<KeepAliveProps> = ({ children, cacheKey }) => {
  const location = useLocation();
  const navType = useNavigationType();
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeKey, setActiveKey] = useState<string>(cacheKey);
  const isBackForward = navType === 'POP';

  // Save scroll position when leaving
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const saveScrollPosition = () => {
      const scrollTop = container.scrollTop || window.scrollY;
      const cached = routeCache.get(cacheKey);
      if (cached) {
        cached.scrollPosition = scrollTop;
        cached.pathname = location.pathname;
      }
    };

    // Save on unmount or before navigation
    return () => {
      saveScrollPosition();
    };
  }, [cacheKey, location.pathname]);

  // Restore scroll position when activating
  useEffect(() => {
    const cached = routeCache.get(cacheKey);
    if (cached && containerRef.current) {
      // Wait for next frame to ensure DOM is ready
      requestAnimationFrame(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop = cached.scrollPosition;
        }
        // Also restore window scroll
        window.scrollTo(0, cached.scrollPosition);
        document.documentElement.scrollTop = cached.scrollPosition;
        document.body.scrollTop = cached.scrollPosition;
      });

      // Multiple attempts to handle async content
      [100, 300, 500].forEach((delay) => {
        setTimeout(() => {
          if (containerRef.current) {
            containerRef.current.scrollTop = cached.scrollPosition;
          }
          window.scrollTo(0, cached.scrollPosition);
          document.documentElement.scrollTop = cached.scrollPosition;
          document.body.scrollTop = cached.scrollPosition;
        }, delay);
      });
    }
  }, [cacheKey, activeKey]);

  // Cache the component if not already cached
  useEffect(() => {
    if (!routeCache.has(cacheKey)) {
      routeCache.set(cacheKey, {
        element: React.cloneElement(children, { key: cacheKey }),
        scrollPosition: 0,
        cacheKey,
        pathname: location.pathname,
      });
    } else {
      // Update the cached element's pathname if it changed
      const cached = routeCache.get(cacheKey);
      if (cached) {
        cached.pathname = location.pathname;
      }
    }
  }, [children, cacheKey, location.pathname]);

  // Set active key when location changes
  useEffect(() => {
    setActiveKey(cacheKey);
  }, [cacheKey]);

  // Clone children with key to ensure React preserves component state
  const cachedElement = routeCache.get(cacheKey)?.element || children;

  return (
    <div
      ref={containerRef}
      style={{
        display: activeKey === cacheKey ? 'block' : 'none',
        width: '100%',
        height: '100%',
      }}
      className={activeKey === cacheKey ? '' : 'keep-alive-hidden'}
    >
      {cachedElement}
    </div>
  );
};

export default KeepAlive;

