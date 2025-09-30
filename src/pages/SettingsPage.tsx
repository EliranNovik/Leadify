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

const SettingsPage: React.FC = () => {
  const [activeSection, setActiveSection] = useState('appearance');
  const [activeCalendarTab, setActiveCalendarTab] = useState('availability');
  const [settings, setSettings] = useState<Record<string, any>>({
    // Appearance Settings
    theme: localStorage.getItem('theme') || 'light',
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
          id: 'emailNotifications',
          label: 'Email Notifications',
          description: 'Receive notifications via email',
          type: 'toggle',
          value: settings.emailNotifications
        },
        {
          id: 'pushNotifications',
          label: 'Push Notifications',
          description: 'Browser push notifications',
          type: 'toggle',
          value: settings.pushNotifications
        },
        {
          id: 'leadAlerts',
          label: 'New Lead Alerts',
          description: 'Get notified when new leads are created',
          type: 'toggle',
          value: settings.leadAlerts
        },
        {
          id: 'meetingReminders',
          label: 'Meeting Reminders',
          description: 'Reminders before scheduled meetings',
          type: 'toggle',
          value: settings.meetingReminders
        },
        {
          id: 'stageChangeAlerts',
          label: 'Stage Change Alerts',
          description: 'Notifications when lead stages change',
          type: 'toggle',
          value: settings.stageChangeAlerts
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

  // Apply theme changes immediately
  useEffect(() => {
    const theme = settings.theme;
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [settings.theme]);

  const updateSetting = (settingId: string, value: any) => {
    setSettings(prev => ({ ...prev, [settingId]: value }));
    localStorage.setItem(settingId, value.toString());
  };

  const renderSettingItem = (item: SettingItem) => {
    switch (item.type) {
      case 'toggle':
        return (
          <div className="form-control">
            <label className="label cursor-pointer justify-start gap-4">
              <input
                type="checkbox"
                className="toggle toggle-primary"
                checked={item.value}
                onChange={(e) => updateSetting(item.id, e.target.checked)}
              />
              <div>
                <div className="font-medium text-base-content">{item.label}</div>
                <div className="text-sm text-base-content/70">{item.description}</div>
              </div>
            </label>
          </div>
        );

      case 'select':
        return (
          <div className="form-control w-full">
            <label className="label">
              <span className="label-text font-medium">{item.label}</span>
            </label>
            <select
              className="select select-bordered w-full"
              value={item.value}
              onChange={(e) => updateSetting(item.id, e.target.value)}
            >
              {item.options?.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <label className="label">
              <span className="label-text-alt text-base-content/70">{item.description}</span>
            </label>
          </div>
        );

      case 'number':
        return (
          <div className="form-control w-full">
            <label className="label">
              <span className="label-text font-medium">{item.label}</span>
            </label>
            <input
              type="number"
              className="input input-bordered w-full"
              value={item.value}
              min={item.min}
              max={item.max}
              onChange={(e) => updateSetting(item.id, parseInt(e.target.value))}
            />
            <label className="label">
              <span className="label-text-alt text-base-content/70">{item.description}</span>
            </label>
          </div>
        );

      case 'input':
        return (
          <div className="form-control w-full">
            <label className="label">
              <span className="label-text font-medium">{item.label}</span>
            </label>
            <input
              type="text"
              className="input input-bordered w-full"
              value={item.value}
              onChange={(e) => updateSetting(item.id, e.target.value)}
            />
            <label className="label">
              <span className="label-text-alt text-base-content/70">{item.description}</span>
            </label>
          </div>
        );

      default:
        return null;
    }
  };

  const activeSettingsSection = settingsSections.find(section => section.id === activeSection);

  return (
    <div className="min-h-screen bg-base-100 p-3 sm:p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 sm:mb-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 mb-4">
            <div className="p-2 sm:p-3 bg-primary/10 rounded-xl">
              <Cog6ToothIcon className="w-6 h-6 sm:w-8 sm:h-8 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-base-content">Settings</h1>
              <p className="text-sm sm:text-base text-base-content/70">Customize your CRM experience</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 sm:gap-6">
          {/* Settings Navigation */}
          <div className="lg:col-span-1">
            <div className="bg-base-200 dark:bg-base-300 rounded-xl p-3 sm:p-4">
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
                          isActive
                            ? 'bg-primary text-primary-content font-medium'
                            : 'text-base-content hover:bg-base-300 dark:hover:bg-base-100'
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
                        isActive
                          ? 'bg-primary text-primary-content font-medium'
                          : 'text-base-content hover:bg-base-300 dark:hover:bg-base-100'
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
              <div className="bg-base-200 dark:bg-base-300 rounded-xl p-3 sm:p-6">
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3 mb-4 sm:mb-6">
                  <activeSettingsSection.icon className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
                  <h2 className="text-xl sm:text-2xl font-semibold text-base-content">
                    {activeSettingsSection.title}
                  </h2>
                </div>
                
                <div className="space-y-4 sm:space-y-6">
                  {activeSettingsSection.items.map((item) => (
                    <div key={item.id} className="bg-base-100 dark:bg-base-300 rounded-lg p-3 sm:p-4">
                      {renderSettingItem(item)}
                    </div>
                  ))}
                  
                  {/* Special case for Calendar section - add tabbed interface */}
                  {activeSection === 'calendar' && (
                    <div className="bg-base-100 dark:bg-base-300 rounded-lg p-3 sm:p-4">
                      {/* Tab Navigation */}
                      <div className="flex border-b border-base-300 mb-4 sm:mb-6 overflow-x-auto">
                        <button
                          className={`flex-shrink-0 px-3 sm:px-4 py-2 font-medium text-xs sm:text-sm border-b-2 transition-colors ${
                            activeCalendarTab === 'availability'
                              ? 'border-primary text-primary'
                              : 'border-transparent text-base-content/70 hover:text-base-content'
                          }`}
                          onClick={() => setActiveCalendarTab('availability')}
                        >
                          <CalendarIcon className="w-3 h-3 sm:w-4 sm:h-4 inline mr-1 sm:mr-2" />
                          My Availability
                        </button>
                        <button
                          className={`flex-shrink-0 px-3 sm:px-4 py-2 font-medium text-xs sm:text-sm border-b-2 transition-colors ${
                            activeCalendarTab === 'manage'
                              ? 'border-primary text-primary'
                              : 'border-transparent text-base-content/70 hover:text-base-content'
                          }`}
                          onClick={() => setActiveCalendarTab('manage')}
                        >
                          <UserGroupIcon className="w-3 h-3 sm:w-4 sm:h-4 inline mr-1 sm:mr-2" />
                          Manage Others
                        </button>
                        <button
                          className={`flex-shrink-0 px-3 sm:px-4 py-2 font-medium text-xs sm:text-sm border-b-2 transition-colors ${
                            activeCalendarTab === 'outlook'
                              ? 'border-primary text-primary'
                              : 'border-transparent text-base-content/70 hover:text-base-content'
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
                            <h3 className="text-base sm:text-lg font-semibold text-base-content mb-1 sm:mb-2">My Availability</h3>
                            <p className="text-base-content/70 text-xs sm:text-sm">
                              Manage your unavailable times and sync with Microsoft Outlook calendar.
                            </p>
                          </div>
                          <EmployeeAvailability />
                        </div>
                      )}
                      
                      {activeCalendarTab === 'manage' && (
                        <div>
                          <div className="mb-3 sm:mb-4">
                            <h3 className="text-base sm:text-lg font-semibold text-base-content mb-1 sm:mb-2">Manage Employee Availability</h3>
                            <p className="text-base-content/70 text-xs sm:text-sm">
                              Set unavailable times and ranges for other team members.
                            </p>
                          </div>
                          <EmployeeAvailabilityManager />
                        </div>
                      )}
                      
                      {activeCalendarTab === 'outlook' && (
                        <div>
                          <OutlookSignature />
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
        <div className="mt-4 sm:mt-6 p-3 sm:p-4 bg-info/10 border border-info/20 rounded-lg">
          <div className="flex items-center gap-2 text-info">
            <svg className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="font-medium text-sm sm:text-base">Auto-Save Enabled</span>
          </div>
          <p className="text-info/80 text-xs sm:text-sm mt-1">
            All settings are automatically saved to your browser's local storage.
          </p>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;