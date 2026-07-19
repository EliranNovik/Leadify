import type React from 'react';

export type CollectionFinancesSettingsMenuItem = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  disabled?: boolean;
  checked?: boolean;
};

export type CollectionFinancesSettingsSection = {
  title: string;
  items: CollectionFinancesSettingsMenuItem[];
};

export type CollectionFinancesRailAction = {
  id: string;
  label: string;
  title: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
};

/** Actions + settings published by CollectionFinancesReport when embedded in Finance Management. */
export type CollectionFinancesRailBridge = {
  actions: CollectionFinancesRailAction[];
  selectedLeadCount: number;
  settingsSections: CollectionFinancesSettingsSection[];
};
