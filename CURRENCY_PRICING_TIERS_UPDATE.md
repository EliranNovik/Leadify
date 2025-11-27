# Currency Pricing Tiers Update

## Summary

Updated the contract template system to support separate pricing tiers for USD/GBP/EUR and NIS currencies, addressing the requirement that USD, GBP, and EUR share the same pricing while NIS has its own pricing structure.

## Changes Made

### 1. Database Schema (`sql/add_currency_pricing_tiers.sql`)

- Added `default_pricing_tiers_usd` column (JSONB) to `contract_templates` table
- Added `default_pricing_tiers_nis` column (JSONB) to `contract_templates` table
- Migrated existing `default_pricing_tiers` data to both new columns
- Added indexes for better query performance

**⚠️ IMPORTANT: You must run the SQL migration script before the changes will work:**

```sql
-- Run: sql/add_currency_pricing_tiers.sql
```

### 2. Contract Templates Manager (`src/components/admin/ContractTemplatesManager.tsx`)

- Updated Template interface to include `default_pricing_tiers_usd` and `default_pricing_tiers_nis`
- Added separate state variables for USD and NIS pricing tiers
- Updated UI with tabs to switch between USD/GBP/EUR and NIS pricing tiers
- Updated save/load logic to handle both pricing tier sets
- Updated fetch templates query to include new columns

### 3. Contract Page (`src/components/ContractPage.tsx`)

- Added currency type selector (USD/NIS) in the sidebar
- Added sub-currency selector (USD/GBP/EUR) when USD type is selected
- Updated contract loading logic to use template pricing tiers based on selected currency
- Initializes pricing tiers from template when creating a new contract
- Automatically determines currency type from lead's currency

### 4. Contact Info Tab (`src/components/client-tabs/ContactInfoTab.tsx`)

- Updated contract creation logic to use appropriate pricing tiers from template:
  - NIS currency → uses `default_pricing_tiers_nis`
  - USD/GBP/EUR currencies → uses `default_pricing_tiers_usd`
- Falls back to legacy `default_pricing_tiers` if new columns are not available

## How It Works

### For Admin Users (Contract Templates Manager)

1. When editing a template, you'll see tabs for "USD/GBP/EUR" and "NIS"
2. Set pricing tiers separately for each currency type
3. USD, GBP, and EUR share the same pricing tiers (only currency symbol differs)
4. NIS has its own separate pricing tiers

### For Users Creating/Editing Contracts

1. **In ContactInfoTab (Contract Creation)**:

   - Currency is selected from the dropdown (already existed)
   - System automatically uses the correct pricing tiers based on selected currency

2. **In ContractPage**:
   - Currency Type selector: Choose between "USD/GBP/EUR" or "NIS"
   - Sub-Currency selector (for USD type): Choose between USD ($), GBP (£), or EUR (€)
   - Pricing tiers automatically update when currency type changes
   - Pricing tiers are loaded from the template's appropriate column

## Next Steps

1. **Run the SQL migration**:

   ```bash
   # Execute the SQL file on your database
   sql/add_currency_pricing_tiers.sql
   ```

2. **Update existing templates** (if needed):

   - Open Contract Templates Manager in admin
   - Edit each template and set the USD and NIS pricing tiers separately
   - Save each template

3. **Test the flow**:
   - Create a new contract from ContactInfoTab
   - Verify pricing tiers match the template
   - Open ContractPage and test currency switching
   - Verify pricing tiers update correctly when changing currency type

## Notes

- Legacy `default_pricing_tiers` column is kept for backward compatibility
- The system falls back to legacy column if new columns are not available
- Currency symbols: $ (USD), £ (GBP), € (EUR), ₪ (NIS)
- All changes are backward compatible with existing contracts
