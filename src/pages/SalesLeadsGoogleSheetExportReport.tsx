/**
 * Marketing: signed sales leads appended to the SalesLeads Google Sheet (export log).
 */
import React from 'react';
import GoogleSheetConversionExportReport from '../components/reports/GoogleSheetConversionExportReport';

const SalesLeadsGoogleSheetExportReport: React.FC = () => (
  <GoogleSheetConversionExportReport
    destination="sales_leads_capital_firm"
    syncFunction="google-sheets-salesleads-sync"
    logTag="SalesLeadsGoogleSheetExportReport"
    description="Capital firm sources at Client signed agreement (stage 60) or later. GCLID is included when present; otherwise the sheet cell is left empty. Conversion value is the lead balance in NIS."
  />
);

export default SalesLeadsGoogleSheetExportReport;
