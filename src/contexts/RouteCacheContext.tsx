import React, { createContext, useContext, useState, useRef, useEffect, ReactElement } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

interface CachedRoute {
  element: ReactElement | null;
  scrollPosition: number;
  pathname: string;
  componentKey: string;
}

interface RouteCacheContextType {
  cacheRoute: (pathname: string, element: ReactElement, componentKey: string) => void;
  getCachedRoute: (pathname: string) => CachedRoute | undefined;
  updateScrollPosition: (pathname: string, scrollPosition: number) => void;
  clearCache: () => void;
}

const RouteCacheContext = createContext<RouteCacheContextType | undefined>(undefined);

// Global cache storage
const routeCacheStorage = new Map<string, CachedRoute>();

export const RouteCacheProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const navType = useNavigationType();

  const cacheRoute = (pathname: string, element: ReactElement, componentKey: string) => {
    if (!routeCacheStorage.has(pathname)) {
      routeCacheStorage.set(pathname, {
        element,
        scrollPosition: 0,
        pathname,
        componentKey,
      });
    } else {
      const cached = routeCacheStorage.get(pathname)!;
      cached.element = element;
      cached.componentKey = componentKey;
    }
  };

  const getCachedRoute = (pathname: string) => {
    return routeCacheStorage.get(pathname);
  };

  const updateScrollPosition = (pathname: string, scrollPosition: number) => {
    const cached = routeCacheStorage.get(pathname);
    if (cached) {
      cached.scrollPosition = scrollPosition;
    }
  };

  const clearCache = () => {
    routeCacheStorage.clear();
  };

  return (
    <RouteCacheContext.Provider
      value={{
        cacheRoute,
        getCachedRoute,
        updateScrollPosition,
        clearCache,
      }}
    >
      {children}
    </RouteCacheContext.Provider>
  );
};

export const useRouteCache = () => {
  const context = useContext(RouteCacheContext);
  if (!context) {
    throw new Error('useRouteCache must be used within RouteCacheProvider');
  }
  return context;
};

