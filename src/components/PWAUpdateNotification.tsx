import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { ArrowPathIcon, XMarkIcon } from '@heroicons/react/24/outline';

const PWAUpdateNotification: React.FC = () => {
  const [showUpdate, setShowUpdate] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const location = useLocation();

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then((reg) => {
        setRegistration(reg);

        // Check for updates
        const checkForUpdates = () => {
          reg.update().catch((error) => {
            console.warn('⚠️ PWAUpdateNotification: Update check failed:', error);
          });
        };

        // Listen for service worker updates
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // New service worker is installed and waiting
                setShowUpdate(true);
              }
            });
          }
        });

        // Check for updates every 60 seconds (aggressive checking)
        const interval = setInterval(() => {
          console.log('🔄 PWAUpdateNotification: Periodic update check...');
          checkForUpdates();
        }, 60 * 1000);
        checkForUpdates(); // Initial check

        // Also check when window regains focus (user switches back to tab/window)
        const handleFocus = () => {
          console.log('🔄 PWAUpdateNotification: Window focused - checking for updates...');
          checkForUpdates();
        };
        window.addEventListener('focus', handleFocus);

        // Cleanup
        return () => {
          clearInterval(interval);
          window.removeEventListener('focus', handleFocus);
        };
      });
    }
  }, []);

  // Check for updates whenever route changes
  useEffect(() => {
    if (registration && location.pathname) {
      console.log('🔄 PWAUpdateNotification: Route changed - checking for updates...', location.pathname);
      registration.update().catch((error) => {
        console.warn('⚠️ PWAUpdateNotification: Update check failed on route change:', error);
      });
    }
  }, [location.pathname, registration]);

  const handleUpdate = () => {
    if (registration?.waiting) {
      // Tell the service worker to skip waiting and activate
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      
      // Reload the page
      window.location.reload();
    }
  };

  const handleDismiss = () => {
    setShowUpdate(false);
    // Don't show again for this session
    sessionStorage.setItem('pwa-update-dismissed', 'true');
  };

  // Don't show if dismissed in this session
  if (sessionStorage.getItem('pwa-update-dismissed') === 'true') {
    return null;
  }

  if (!showUpdate || !registration) {
    return null;
  }

  return (
    <div className="fixed top-4 left-4 right-4 md:left-auto md:right-4 md:w-96 z-50 animate-slide-down">
      <div className="bg-blue-50 border border-blue-200 rounded-lg shadow-lg p-4 flex items-start gap-3">
        <div className="flex-shrink-0">
          <ArrowPathIcon className="w-6 h-6 text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-blue-900 mb-1">
            Update Available
          </h3>
          <p className="text-xs text-blue-700 mb-3">
            A new version of RMQ 2.0 is available. Update now to get the latest features.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleUpdate}
              className="btn btn-primary btn-sm text-xs"
            >
              Update Now
            </button>
            <button
              onClick={handleDismiss}
              className="btn btn-ghost btn-sm text-xs"
            >
              Later
            </button>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="flex-shrink-0 text-blue-400 hover:text-blue-600"
          aria-label="Close"
        >
          <XMarkIcon className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};

export default PWAUpdateNotification;

