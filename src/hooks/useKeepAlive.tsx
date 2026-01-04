import { useEffect, useRef, useState, ReactElement } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

interface CachedComponent {
  element: ReactElement;
  scrollPosition: number;
  timestamp: number;
}

// Global cache storage
const keepAliveCache = new Map<string, CachedComponent>();

/**
 * useKeepAlive - Hook to keep a component alive across navigation
 * Usage: Wrap your component with this hook to preserve its state
 */
export function useKeepAlive(cacheKey: string, element: ReactElement) {
  const location = useLocation();
  const navType = useNavigationType();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isActive, setIsActive] = useState(true);

  // Initialize or update cache
  useEffect(() => {
    const cached = keepAliveCache.get(cacheKey);
    if (!cached) {
      keepAliveCache.set(cacheKey, {
        element,
        scrollPosition: 0,
        timestamp: Date.now(),
      });
    } else {
      // Update element if it changed
      cached.element = element;
    }
  }, [element, cacheKey]);

  // Determine if active based on current pathname
  useEffect(() => {
    const pathname = location.pathname;
    const shouldBeActive = pathname === cacheKey || pathname.startsWith(cacheKey + '/');
    setIsActive(shouldBeActive);
  }, [location.pathname, cacheKey]);

  // Save scroll position
  useEffect(() => {
    return () => {
      const container = containerRef.current;
      const mainElement = document.querySelector('main');
      const scrollPosition = container?.scrollTop || mainElement?.scrollTop || window.scrollY;
      
      const cached = keepAliveCache.get(cacheKey);
      if (cached) {
        cached.scrollPosition = scrollPosition;
      }
    };
  }, [cacheKey, location.pathname]);

  // Restore scroll position
  useEffect(() => {
    if (isActive && navType === 'POP') {
      const cached = keepAliveCache.get(cacheKey);
      if (cached && cached.scrollPosition > 0) {
        const restoreScroll = () => {
          const container = containerRef.current;
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
  }, [isActive, cacheKey, navType]);

  const cached = keepAliveCache.get(cacheKey);

  return {
    containerRef,
    isActive,
    cachedElement: cached?.element || element,
  };
}

/**
 * KeepAlive component - Wraps children to keep them alive
 */
interface KeepAliveProps {
  cacheKey: string;
  children: ReactElement;
}

export function KeepAlive({ cacheKey, children }: KeepAliveProps) {
  const { containerRef, isActive, cachedElement } = useKeepAlive(cacheKey, children);

  return (
    <div
      ref={containerRef}
      style={{
        display: isActive ? 'block' : 'none',
        width: '100%',
        height: '100%',
      }}
      className={isActive ? '' : 'keep-alive-hidden'}
    >
      {cachedElement}
    </div>
  );
}

