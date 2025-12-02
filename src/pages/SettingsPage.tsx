import React, { useState, useEffect } from 'react';
import {
  Cog6ToothIcon,
  MoonIcon,
  SunIcon,
  BellIcon,
  UserIcon,
  ShieldCheckIcon,
  DocumentTextIcon,
  ChartBarIcon,
  CurrencyDollarIcon,
  CalendarIcon,
  EnvelopeIcon,
  DevicePhoneMobileIcon,
  UserGroupIcon
} from '@heroicons/react/24/outline';
import EmployeeAvailability from '../components/EmployeeAvailability';
import EmployeeAvailabilityManager from '../components/EmployeeAvailabilityManager';
import OutlookSignature from '../components/OutlookSignature';
import CompanySignatureTemplate from '../components/CompanySignatureTemplate';
import {
  isPushNotificationSupported,
  getNotificationPermission,
  requestNotificationPermission,
  getPushSubscription,
  unsubscribeFromPush,
  savePushSubscription,
  removePushSubscription,
  sendTestNotification,
} from '../lib/pushNotifications';
import toast from 'react-hot-toast';

interface SettingsSection {
  id: string;
  title: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  items: SettingItem[];
}

interface SettingItem {
  id: string;
  label: string;
  description: string;
  type: 'toggle' | 'select' | 'input' | 'number';
  value: any;
  options?: { label: string; value: any }[];
  min?: number;
  max?: number;
}

// Helper function to get and validate theme from localStorage (defined outside component to avoid re-initialization issues)
const getValidatedTheme = (): string => {
  try {
    const storedTheme = localStorage.getItem('theme');
    // Only accept valid theme values - explicitly check each valid option
    const validThemes: string[] = ['light', 'dark', 'alternative'];
    if (storedTheme && validThemes.includes(storedTheme)) {
      return storedTheme;
    }
    // If invalid or missing, default to light and save it
    console.warn('Invalid or missing theme in localStorage, defaulting to light mode. Stored value:', storedTheme);
    localStorage.setItem('theme', 'light');
    return 'light';
  } catch (error) {
    console.error('Error reading theme from localStorage:', error);
    return 'light';
  }
};

const SettingsPage: React.FC = () => {
  const [activeSection, setActiveSection] = useState('appearance');
  const [activeCalendarTab, setActiveCalendarTab] = useState('availability');
  const [pushNotificationPermission, setPushNotificationPermission] = useState<NotificationPermission>('default');
  const [isPushSupported, setIsPushSupported] = useState(false);
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);

  const [settings, setSettings] = useState<Record<string, any>>({
    // Appearance Settings
    theme: getValidatedTheme(),
    compactMode: localStorage.getItem('compactMode') === 'true',
    sidebarCollapsed: localStorage.getItem('sidebarCollapsed') === 'true',
    
    // Notification Settings
    emailNotifications: localStorage.getItem('emailNotifications') !== 'false',
    pushNotifications: localStorage.getItem('pushNotifications') !== 'false',
    leadAlerts: localStorage.getItem('leadAlerts') !== 'false',
    meetingReminders: localStorage.getItem('meetingReminders') !== 'false',
    stageChangeAlerts: localStorage.getItem('stageChangeAlerts') !== 'false',
    
    // CRM Settings
    defaultLeadSource: localStorage.getItem('defaultLeadSource') || 'website',
    autoAssignLeads: localStorage.getItem('autoAssignLeads') === 'true',
    followUpInterval: parseInt(localStorage.getItem('followUpInterval') || '7'),
    defaultCurrency: localStorage.getItem('defaultCurrency') || 'EUR',
    proposalTemplate: localStorage.getItem('proposalTemplate') || 'standard',
    
    
    // Security Settings
    sessionTimeout: parseInt(localStorage.getItem('sessionTimeout') || '480'),
    twoFactorAuth: localStorage.getItem('twoFactorAuth') === 'true',
    activityLogging: localStorage.getItem('activityLogging') !== 'false',
    
    // Data & Privacy
    dataRetention: parseInt(localStorage.getItem('dataRetention') || '365'),
    anonymizeData: localStorage.getItem('anonymizeData') === 'true',
    shareAnalytics: localStorage.getItem('shareAnalytics') !== 'false',
  });

  const settingsSections: SettingsSection[] = [
    {
      id: 'appearance',
      title: 'Appearance',
      icon: Cog6ToothIcon,
      items: [
        {
          id: 'theme',
          label: 'Theme',
          description: 'Choose between light and dark mode',
          type: 'select',
          value: settings.theme,
          options: [
            { label: 'Light', value: 'light' },
            { label: 'Dark', value: 'dark' },
            { label: 'Alternative (Green)', value: 'alternative' },
          ]
        },
        {
          id: 'compactMode',
          label: 'Compact Mode',
          description: 'Reduce spacing and padding throughout the interface',
          type: 'toggle',
          value: settings.compactMode
        },
        {
          id: 'sidebarCollapsed',
          label: 'Collapsed Sidebar',
          description: 'Start with sidebar in collapsed state',
          type: 'toggle',
          value: settings.sidebarCollapsed
        }
      ]
    },
    {
      id: 'notifications',
      title: 'Notifications',
      icon: BellIcon,
      items: [
        {
          id: 'pushNotifications',
          label: 'Push Notifications',
          description: isPushSupported
            ? pushNotificationPermission === 'granted'
              ? 'Push notifications are enabled'
              : pushNotificationPermission === 'denied'
              ? 'Permission denied. Enable in browser settings.'
              : 'Enable browser push notifications for mobile'
            : 'Not supported in this browser',
          type: 'toggle',
          value: settings.pushNotifications && pushNotificationPermission === 'granted'
        }
      ]
    },
    {
      id: 'crm',
      title: 'CRM Settings',
      icon: UserIcon,
      items: [
        {
          id: 'defaultLeadSource',
          label: 'Default Lead Source',
          description: 'Default source for new leads',
          type: 'select',
          value: settings.defaultLeadSource,
          options: [
            { label: 'Website', value: 'website' },
            { label: 'Phone', value: 'phone' },
            { label: 'Email', value: 'email' },
            { label: 'Referral', value: 'referral' },
            { label: 'Social Media', value: 'social' },
            { label: 'Other', value: 'other' }
          ]
        },
        {
          id: 'autoAssignLeads',
          label: 'Auto-Assign Leads',
          description: 'Automatically assign new leads to available team members',
          type: 'toggle',
          value: settings.autoAssignLeads
        },
        {
          id: 'followUpInterval',
          label: 'Follow-up Interval (days)',
          description: 'Default interval for follow-up reminders',
          type: 'number',
          value: settings.followUpInterval,
          min: 1,
          max: 30
        },
        {
          id: 'defaultCurrency',
          label: 'Default Currency',
          description: 'Default currency for proposals and payments',
          type: 'select',
          value: settings.defaultCurrency,
          options: [
            { label: 'EUR (€)', value: 'EUR' },
            { label: 'USD ($)', value: 'USD' },
            { label: 'GBP (£)', value: 'GBP' },
            { label: 'CHF', value: 'CHF' }
          ]
        },
        {
          id: 'proposalTemplate',
          label: 'Proposal Template',
          description: 'Default template for client proposals',
          type: 'select',
          value: settings.proposalTemplate,
          options: [
            { label: 'Standard', value: 'standard' },
            { label: 'Premium', value: 'premium' },
            { label: 'Express', value: 'express' },
            { label: 'Family', value: 'family' }
          ]
        }
      ]
    },
    {
      id: 'calendar',
      title: 'Calendar & Meetings',
      icon: CalendarIcon,
      items: []
    },
    {
      id: 'security',
      title: 'Security',
      icon: ShieldCheckIcon,
      items: [
        {
          id: 'sessionTimeout',
          label: 'Session Timeout (minutes)',
          description: 'Automatic logout after inactivity',
          type: 'number',
          value: settings.sessionTimeout,
          min: 30,
          max: 720
        },
        {
          id: 'twoFactorAuth',
          label: 'Two-Factor Authentication',
          description: 'Enable 2FA for enhanced security',
          type: 'toggle',
          value: settings.twoFactorAuth
        },
        {
          id: 'activityLogging',
          label: 'Activity Logging',
          description: 'Log user activities for audit trail',
          type: 'toggle',
          value: settings.activityLogging
        }
      ]
    },
    {
      id: 'data',
      title: 'Data & Privacy',
      icon: DocumentTextIcon,
      items: [
        {
          id: 'dataRetention',
          label: 'Data Retention (days)',
          description: 'How long to keep inactive lead data',
          type: 'number',
          value: settings.dataRetention,
          min: 90,
          max: 2555
        },
        {
          id: 'anonymizeData',
          label: 'Anonymize Old Data',
          description: 'Automatically anonymize data after retention period',
          type: 'toggle',
          value: settings.anonymizeData
        },
        {
          id: 'shareAnalytics',
          label: 'Share Analytics',
          description: 'Help improve the product by sharing usage analytics',
          type: 'toggle',
          value: settings.shareAnalytics
        }
      ]
    }
  ];

  // Check push notification support and permission on mount
  useEffect(() => {
    const checkPushSupport = async () => {
      const supported = isPushNotificationSupported();
      setIsPushSupported(supported);
      
      if (supported) {
        const permission = await getNotificationPermission();
        setPushNotificationPermission(permission);
        
        // If permission is granted, ensure subscription exists
        if (permission === 'granted') {
          try {
            const subscription = await getPushSubscription();
            if (subscription) {
              await savePushSubscription(subscription);
            }
          } catch (error) {
            console.error('Error checking push subscription:', error);
          }
        }
      }
    };

    checkPushSupport();
  }, []);

  // Apply theme changes immediately - explicitly remove all theme classes first to prevent stale classes
  useEffect(() => {
    const theme = settings.theme;
    const isDark = theme === 'dark';
    const isAlt = theme === 'alternative';
    const rootEl = document.getElementById('root');

    // First, explicitly remove all theme classes to prevent stale classes from previous sessions
    document.documentElement.classList.remove('dark', 'theme-alt');
    document.body.classList.remove('dark', 'theme-alt');
    rootEl?.classList.remove('dark', 'theme-alt');

    // Set the data-theme attribute
    document.documentElement.setAttribute('data-theme', theme);

    // Then apply the correct theme classes
    if (isDark) {
      document.documentElement.classList.add('dark');
      document.body.classList.add('dark');
      rootEl?.classList.add('dark');
    } else if (isAlt) {
      document.documentElement.classList.add('theme-alt');
      document.body.classList.add('theme-alt');
      rootEl?.classList.add('theme-alt');
    }

    localStorage.setItem('theme', theme);
    
    // Debug log to help troubleshoot theme issues
    console.log('Theme applied:', theme, {
      isDark,
      isAlt,
      hasDarkClass: document.documentElement.classList.contains('dark'),
      hasAltClass: document.documentElement.classList.contains('theme-alt'),
      dataTheme: document.documentElement.getAttribute('data-theme')
    });
  }, [settings.theme]);

  // Ensure theme is applied on initial mount (runs once)
  useEffect(() => {
    // Validate and apply theme on mount to catch any initialization issues
    const currentTheme = getValidatedTheme();
    if (currentTheme !== settings.theme) {
      // If there's a mismatch, update the settings
      setSettings(prev => ({ ...prev, theme: currentTheme }));
    }
  }, []); // Empty dependency array - runs only on mount

  // Handle push notification toggle
  const handlePushNotificationToggle = async (enabled: boolean) => {
    if (!isPushSupported) {
      toast.error('Push notifications are not supported in this browser');
      return;
    }

    if (enabled) {
      // Request permission
      setIsRequestingPermission(true);
      try {
        const permission = await requestNotificationPermission();
        setPushNotificationPermission(permission);

        if (permission === 'granted') {
          // Get or create subscription
          try {
            // Debug: Check if VAPID key is available
            const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
            console.log('🔍 Debug - VAPID key check:', {
              exists: !!vapidKey,
              length: vapidKey?.length || 0,
              firstChars: vapidKey ? `${vapidKey.substring(0, 20)}...` : 'empty',
              fullKey: vapidKey // Log full key for debugging (remove in production)
            });

            const subscription = await getPushSubscription();
            if (subscription) {
              try {
                await savePushSubscription(subscription);
                updateSetting('pushNotifications', true);
                toast.success('Push notifications enabled!');
              } catch (saveError: any) {
                console.error('Save subscription error:', saveError);
                updateSetting('pushNotifications', false);
                toast.error(saveError?.message || 'Failed to save push subscription. Please check the console for details.');
              }
            } else {
              updateSetting('pushNotifications', false);
              toast.error('Failed to create push subscription. Please check your VAPID key configuration.');
            }
          } catch (subscriptionError: any) {
            console.error('Subscription error:', subscriptionError);
            console.error('Full error details:', {
              message: subscriptionError?.message,
              stack: subscriptionError?.stack,
              name: subscriptionError?.name
            });
            updateSetting('pushNotifications', false);
            toast.error(subscriptionError?.message || 'Failed to set up push notifications');
          }
        } else if (permission === 'denied') {
          updateSetting('pushNotifications', false);
          toast.error('Notification permission denied. Please enable it in your browser settings.');
        } else {
          updateSetting('pushNotifications', false);
        }
      } catch (error: any) {
        console.error('Error enabling push notifications:', error);
        updateSetting('pushNotifications', false);
        toast.error(error?.message || 'Failed to enable push notifications');
      } finally {
        setIsRequestingPermission(false);
      }
    } else {
      // Disable push notifications
      try {
        const subscription = await getPushSubscription();
        if (subscription) {
          await unsubscribeFromPush();
          await removePushSubscription(subscription.endpoint);
        }
        updateSetting('pushNotifications', false);
        toast.success('Push notifications disabled');
      } catch (error) {
        console.error('Error disabling push notifications:', error);
        toast.error('Failed to disable push notifications');
      }
    }
  };

  const updateSetting = (settingId: string, value: any) => {
    setSettings(prev => ({ ...prev, [settingId]: value }));
    localStorage.setItem(settingId, value.toString());
  };

  const renderSettingItem = (item: SettingItem) => {
    const labelClass = isDarkMode ? 'text-white' : isAltTheme ? 'text-emerald-900' : 'text-base-content';
    const descClass = isDarkMode ? 'text-white/70' : isAltTheme ? 'text-emerald-700' : 'text-base-content/70';
    const inputClass = isDarkMode 
      ? 'input input-bordered w-full bg-white/10 border-white/20 text-white placeholder-white/50 focus:bg-white/15 focus:border-white/40'
      : isAltTheme
        ? 'input input-bordered w-full bg-white border-emerald-200 text-emerald-900 placeholder-emerald-500 focus:border-lime-500 focus:ring-emerald-400'
        : 'input input-bordered w-full';
    const selectClass = isDarkMode
      ? 'select select-bordered w-full bg-white/10 border-white/20 text-white focus:bg-white/15 focus:border-white/40'
      : isAltTheme
        ? 'select select-bordered w-full bg-white border-emerald-200 text-emerald-900 focus:border-lime-500 focus:ring-emerald-400'
        : 'select select-bordered w-full';
    const toggleClass = `toggle ${isAltTheme ? 'toggle-success' : 'toggle-primary'}`;

    switch (item.type) {
      case 'toggle':
        return (
          <div className="form-control">
            <label className="label cursor-pointer justify-start gap-4">
              <input
                type="checkbox"
                className={toggleClass}
                checked={item.value}
                disabled={item.id === 'pushNotifications' && (isRequestingPermission || !isPushSupported || pushNotificationPermission === 'denied')}
                onChange={(e) => {
                  if (item.id === 'pushNotifications') {
                    handlePushNotificationToggle(e.target.checked);
                  } else {
                    updateSetting(item.id, e.target.checked);
                  }
                }}
              />
              <div className="flex-1">
                <div className={`font-medium ${labelClass}`}>
                  {item.label}
                  {item.id === 'pushNotifications' && isRequestingPermission && (
                    <span className="loading loading-spinner loading-xs ml-2"></span>
                  )}
                </div>
                <div className={`text-sm ${descClass}`}>{item.description}</div>
                {item.id === 'pushNotifications' && pushNotificationPermission === 'granted' && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await sendTestNotification();
                        toast.success('Test notification sent!');
                      } catch (error: any) {
                        toast.error(error?.message || 'Failed to send test notification');
                      }
                    }}
                    className="btn btn-xs btn-outline mt-2"
                  >
                    Send Test Notification
                  </button>
                )}
              </div>
            </label>
          </div>
        );

      case 'select':
        if (item.id === 'theme') {
          return (
            <div className="form-control w-full">
              <label className="label">
                <span className={`label-text font-medium ${labelClass}`}>{item.label}</span>
              </label>
              <div className="flex flex-col gap-2">
                <p className={`text-sm ${descClass}`}>{item.description}</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {item.options?.map(option => {
                    const isActive = item.value === option.value;
                    const baseClasses = `w-full px-4 py-3 rounded-xl border transition-all duration-200 text-center font-semibold focus:outline-none focus-visible:outline focus-visible:outline-2`;
                    let stateClasses = '';
                    if (isDarkMode) {
                      stateClasses = isActive
                        ? 'bg-white text-purple-700 border-white shadow-lg'
                        : 'bg-white/10 text-white/80 border-white/30 hover:bg-white/15';
                    } else if (isAltTheme) {
                      stateClasses = isActive
                        ? 'bg-gradient-to-r from-emerald-900 to-lime-500 text-white border-lime-200 shadow-lg'
                        : 'bg-white/80 text-emerald-800 border-emerald-200 hover:bg-lime-50';
                    } else {
                      stateClasses = isActive
                        ? 'bg-primary text-primary-content border-primary shadow-lg'
                        : 'bg-base-100 text-base-content border-base-300 hover:bg-base-200';
                    }

                    return (
                      <button
                        type="button"
                        key={option.value}
                        className={`${baseClasses} ${stateClasses}`}
                        onClick={() => updateSetting(item.id, option.value)}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        }

        return (
          <div className="form-control w-full">
            <label className="label">
              <span className={`label-text font-medium ${labelClass}`}>{item.label}</span>
            </label>
            <select
              className={selectClass}
              value={item.value}
              onChange={(e) => updateSetting(item.id, e.target.value)}
            >
              {item.options?.map(option => (
                <option key={option.value} value={option.value} className={isDarkMode ? 'bg-purple-900 text-white' : ''}>
                  {option.label}
                </option>
              ))}
            </select>
            <label className="label">
              <span className={`label-text-alt ${descClass}`}>{item.description}</span>
            </label>
          </div>
        );

      case 'number':
        return (
          <div className="form-control w-full">
            <label className="label">
              <span className={`label-text font-medium ${labelClass}`}>{item.label}</span>
            </label>
            <input
              type="number"
              className={inputClass}
              value={item.value}
              min={item.min}
              max={item.max}
              onChange={(e) => updateSetting(item.id, parseInt(e.target.value))}
            />
            <label className="label">
              <span className={`label-text-alt ${descClass}`}>{item.description}</span>
            </label>
          </div>
        );

      case 'input':
        return (
          <div className="form-control w-full">
            <label className="label">
              <span className={`label-text font-medium ${labelClass}`}>{item.label}</span>
            </label>
            <input
              type="text"
              className={inputClass}
              value={item.value}
              onChange={(e) => updateSetting(item.id, e.target.value)}
            />
            <label className="label">
              <span className={`label-text-alt ${descClass}`}>{item.description}</span>
            </label>
          </div>
        );

      default:
        return null;
    }
  };

  const activeSettingsSection = settingsSections.find(section => section.id === activeSection);
  const isDarkMode = settings.theme === 'dark';
  const isAltTheme = settings.theme === 'alternative';

  const pageWrapperClass = `min-h-screen transition-all duration-500 ${
    activeSection === 'calendar' ? 'p-0 sm:p-6' : 'p-3 sm:p-6'
  } ${
    isDarkMode
      ? 'bg-gradient-to-br from-[#0b1e3d] via-[#0f4c75] to-[#06b6d4] text-white'
      : isAltTheme
        ? 'bg-[#f7fbf5] text-emerald-900'
        : 'bg-base-100 text-base-content'
  }`;

  const shellCardClass = `rounded-xl shadow-lg transition-all duration-300 ${
    isDarkMode
      ? 'p-3 sm:p-4 bg-white/10 border border-white/20 backdrop-blur-md shadow-[0_8px_32px_rgba(0,0,0,0.3)]'
      : isAltTheme
        ? 'p-3 sm:p-4 bg-gradient-to-br from-emerald-950 via-emerald-900 to-lime-600 text-white border border-lime-300 shadow-[0_20px_45px_rgba(6,95,70,0.35)]'
        : 'p-3 sm:p-4'
  }`;

  const contentShellClass = `rounded-xl transition-all duration-300 ${
    activeSection === 'calendar' 
      ? (isDarkMode
          ? 'p-0 sm:p-6 bg-white/10 border-0 sm:border border-white/20 backdrop-blur-md shadow-[0_8px_32px_rgba(0,0,0,0.3)]'
          : isAltTheme
            ? 'p-0 sm:p-6 bg-gradient-to-br from-emerald-950 via-emerald-900 to-lime-600 text-white border-0 sm:border border-lime-300 shadow-[0_30px_60px_rgba(6,95,70,0.35)]'
            : 'p-0 sm:p-6')
      : (isDarkMode
          ? 'p-3 sm:p-6 bg-white/10 border border-white/20 backdrop-blur-md shadow-[0_8px_32px_rgba(0,0,0,0.3)]'
          : isAltTheme
            ? 'p-3 sm:p-6 bg-gradient-to-br from-emerald-950 via-emerald-900 to-lime-600 text-white border border-lime-300 shadow-[0_30px_60px_rgba(6,95,70,0.35)]'
            : 'p-3 sm:p-6')
  }`;

  const innerCardClass = `rounded-lg transition-all duration-300 ${
    isDarkMode
      ? 'p-3 sm:p-4 bg-white/5 border border-white/10 shadow-md'
      : isAltTheme
        ? 'p-3 sm:p-4 bg-emerald-950/60 border border-lime-400/60 text-white shadow-[0_12px_30px_rgba(0,0,0,0.35)]'
        : 'p-3 sm:p-4 bg-base-100'
  }`;

  const headerBadgeClass = `rounded-xl transition-all duration-300 ${
    isDarkMode ? 'bg-white/20 text-white' : isAltTheme ? 'bg-gradient-to-r from-emerald-900 to-lime-500 text-white shadow' : 'bg-primary/10 text-primary'
  }`;

  const headerTextClass = isDarkMode ? 'text-white' : isAltTheme ? 'text-emerald-900' : 'text-base-content';
  const mutedTextClass = isDarkMode ? 'text-white/80' : isAltTheme ? 'text-emerald-700' : 'text-base-content/70';

  const navButtonBase = isDarkMode
    ? 'text-white/90 hover:bg-white/15 transition-all duration-200'
    : isAltTheme
      ? 'text-emerald-800 border border-emerald-200 bg-white/80 hover:bg-lime-50 transition-all duration-200'
      : 'text-base-content hover:bg-base-300';
  const navButtonActive = isDarkMode
    ? 'bg-white text-purple-700 shadow-lg font-semibold'
    : isAltTheme
      ? 'bg-gradient-to-r from-emerald-900 to-lime-500 text-white shadow-lg font-semibold border border-lime-200'
      : 'bg-primary text-primary-content font-medium';

  const tabBorderClass = isDarkMode ? 'border-white/20' : isAltTheme ? 'border-emerald-200' : 'border-base-300';
  const tabInactiveClass = isDarkMode
    ? 'border-transparent text-white/70 hover:text-white'
    : isAltTheme
      ? 'border-transparent text-emerald-700 hover:text-emerald-900'
      : 'border-transparent text-base-content/70 hover:text-base-content';
  const tabActiveClass = isDarkMode ? 'border-white text-white' : isAltTheme ? 'border-lime-500 text-emerald-900' : 'border-primary text-primary';

  const saveNoticeClass = isDarkMode
    ? 'p-3 sm:p-4 bg-white/10 border border-white/20 text-white shadow-lg backdrop-blur-md'
    : isAltTheme
      ? 'p-3 sm:p-4 bg-gradient-to-r from-emerald-900 to-lime-500 text-white border border-lime-200 shadow-lg'
      : 'p-3 sm:p-4 bg-info/10 border border-info/20 text-info';

  return (
    <>
      <div className={pageWrapperClass}>
        <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 sm:mb-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 mb-4">
            <div className={`hidden sm:flex p-2 sm:p-3 ${headerBadgeClass}`}>
              <Cog6ToothIcon className={`w-6 h-6 sm:w-8 sm:h-8 ${isDarkMode ? 'text-white' : 'text-primary'}`} />
            </div>
            <div className="px-2 sm:px-0">
              <h1 className={`text-2xl sm:text-3xl font-bold ${headerTextClass}`}>Settings</h1>
              <p className={`text-sm sm:text-base ${mutedTextClass}`}>Customize your CRM experience</p>
            </div>
          </div>
        </div>

        <div className={`grid grid-cols-1 lg:grid-cols-4 ${activeSection === 'calendar' ? 'gap-0 sm:gap-6' : 'gap-4 sm:gap-6'}`}>
          {/* Settings Navigation */}
          <div className="lg:col-span-1">
            <div className={shellCardClass}>
              {/* Mobile: Horizontal scrolling navigation */}
              <div className="lg:hidden">
                <div className="flex gap-2 overflow-x-auto pb-2 hide-scrollbar">
                  {settingsSections.map((section) => {
                    const Icon = section.icon;
                    const isActive = activeSection === section.id;
                    return (
                      <button
                        key={section.id}
                        onClick={() => setActiveSection(section.id)}
                        className={`flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg transition-colors duration-200 whitespace-nowrap text-sm ${
                          isActive ? navButtonActive : navButtonBase
                        }`}
                      >
                        <Icon className="w-4 h-4 flex-shrink-0" />
                        <span>{section.title}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              
              {/* Desktop: Vertical navigation */}
              <nav className="hidden lg:block space-y-1">
                {settingsSections.map((section) => {
                  const Icon = section.icon;
                  const isActive = activeSection === section.id;
                  return (
                    <button
                      key={section.id}
                      onClick={() => setActiveSection(section.id)}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors duration-200 ${
                        isActive ? navButtonActive : navButtonBase
                      }`}
                    >
                      <Icon className="w-5 h-5 flex-shrink-0" />
                      <span className="text-left">{section.title}</span>
                    </button>
                  );
                })}
              </nav>
            </div>
            
            <style>
              {`
                .hide-scrollbar {
                  -ms-overflow-style: none;
                  scrollbar-width: none;
                }
                .hide-scrollbar::-webkit-scrollbar {
                  display: none;
                }
              `}
            </style>
          </div>

          {/* Settings Content */}
          <div className="lg:col-span-3">
            {activeSettingsSection && (
              <div className={contentShellClass}>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3 mb-4 sm:mb-6 px-2 sm:px-0">
                  <activeSettingsSection.icon className={`hidden sm:block w-5 h-5 sm:w-6 sm:h-6 ${isDarkMode ? 'text-white' : 'text-primary'}`} />
                  <h2 className={`text-xl sm:text-2xl font-semibold ${headerTextClass}`}>
                    {activeSettingsSection.title}
                  </h2>
                </div>
                
                <div className="space-y-4 sm:space-y-6">
                  {/* Show "In progress..." for crm, security, and data sections */}
                  {(activeSection === 'crm' || activeSection === 'security' || activeSection === 'data') ? (
                    <div className={`text-center py-8 ${mutedTextClass}`}>
                      <p className="text-lg">In progress...</p>
                    </div>
                  ) : (
                    <>
                      {activeSettingsSection.items.map((item) => (
                        <div key={item.id} className={innerCardClass}>
                          {renderSettingItem(item)}
                        </div>
                      ))}
                    </>
                  )}
                  
                  {/* Special case for Calendar section - add tabbed interface */}
                  {activeSection === 'calendar' && (
                    <div className={`${activeSection === 'calendar' ? 'p-2 sm:p-4' : innerCardClass} ${
                      isDarkMode
                        ? 'bg-white/5 border border-white/10 shadow-md'
                        : isAltTheme
                          ? 'bg-emerald-950/60 border border-lime-400/60 text-white shadow-[0_12px_30px_rgba(0,0,0,0.35)]'
                          : 'bg-base-100'
                    } rounded-lg transition-all duration-300`}>
                      {/* Tab Navigation */}
                      <div className={`flex border-b ${tabBorderClass} mb-4 sm:mb-6 overflow-x-auto`}>
                        <button
                          className={`flex-shrink-0 px-3 sm:px-4 py-2 font-medium text-xs sm:text-sm border-b-2 transition-colors ${
                            activeCalendarTab === 'availability' ? tabActiveClass : tabInactiveClass
                          }`}
                          onClick={() => setActiveCalendarTab('availability')}
                        >
                          <CalendarIcon className="w-3 h-3 sm:w-4 sm:h-4 inline mr-1 sm:mr-2" />
                          My Availability
                        </button>
                        <button
                          className={`flex-shrink-0 px-3 sm:px-4 py-2 font-medium text-xs sm:text-sm border-b-2 transition-colors ${
                            activeCalendarTab === 'manage' ? tabActiveClass : tabInactiveClass
                          }`}
                          onClick={() => setActiveCalendarTab('manage')}
                        >
                          <UserGroupIcon className="w-3 h-3 sm:w-4 sm:h-4 inline mr-1 sm:mr-2" />
                          Manage Others
                        </button>
                        <button
                          className={`flex-shrink-0 px-3 sm:px-4 py-2 font-medium text-xs sm:text-sm border-b-2 transition-colors ${
                            activeCalendarTab === 'outlook' ? tabActiveClass : tabInactiveClass
                          }`}
                          onClick={() => setActiveCalendarTab('outlook')}
                        >
                          <EnvelopeIcon className="w-3 h-3 sm:w-4 sm:h-4 inline mr-1 sm:mr-2" />
                          Outlook
                        </button>
                      </div>
                      
                      {/* Tab Content */}
                      {activeCalendarTab === 'availability' && (
                        <div>
                          <div className="mb-3 sm:mb-4">
                            <h3 className={`text-base sm:text-lg font-semibold ${headerTextClass} mb-1 sm:mb-2`}>My Availability</h3>
                            <p className={`${mutedTextClass} text-xs sm:text-sm`}>
                              Manage your unavailable times and sync with Microsoft Outlook calendar.
                            </p>
                          </div>
                          <EmployeeAvailability />
                        </div>
                      )}
                      
                      {activeCalendarTab === 'manage' && (
                        <div>
                          <div className="mb-3 sm:mb-4">
                            <h3 className={`text-base sm:text-lg font-semibold ${headerTextClass} mb-1 sm:mb-2`}>Manage Employee Availability</h3>
                            <p className={`${mutedTextClass} text-xs sm:text-sm`}>
                              Set unavailable times and ranges for other team members.
                            </p>
                          </div>
                          <EmployeeAvailabilityManager />
                        </div>
                      )}
                      
                      {activeCalendarTab === 'outlook' && (
                        <div className="space-y-6">
                          <div className="border-b border-base-300 pb-4">
                            <OutlookSignature />
                          </div>
                          <div className="pt-4">
                            <CompanySignatureTemplate />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Save Notice */}
        <div className={`mt-4 sm:mt-6 rounded-lg ${saveNoticeClass}`}>
          <div className={`flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-info'}`}>
            <svg className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="font-medium text-sm sm:text-base">Auto-Save Enabled</span>
          </div>
          <p className={`${isDarkMode ? 'text-white/70' : 'text-info/80'} text-xs sm:text-sm mt-1`}>
            All settings are automatically saved to your browser's local storage.
          </p>
        </div>
      </div>
    </div>
  </>
  );
};

export default SettingsPage;