/**
 * Marketing: leads appended to the BadLeads Google Sheet (export log).
 */
import React from 'react';
import GoogleSheetConversionExportReport from '../components/reports/GoogleSheetConversionExportReport';

const BadLeadsGoogleSheetExportReport: React.FC = () => (
  <GoogleSheetConversionExportReport
    destination="bad_leads_capital_firm"
    syncFunction="google-sheets-bad-leads-sync"
    logTag="BadLeadsGoogleSheetExportReport"
  />
);

export default BadLeadsGoogleSheetExportReport;
