/**
 * Marketing: quality leads appended to the QLeads Google Sheet (export log).
 */
import React from 'react';
import GoogleSheetConversionExportReport from '../components/reports/GoogleSheetConversionExportReport';

const QLeadsGoogleSheetExportReport: React.FC = () => (
  <GoogleSheetConversionExportReport
    destination="q_leads_capital_firm"
    syncFunction="google-sheets-qleads-sync"
    logTag="QLeadsGoogleSheetExportReport"
    description="Eligible leads (stages 0–20) and all leads from Meeting Scheduled (stage 20+) from Capital firm sources — exported as Google Ads offline conversions. GCLID is included when present; otherwise the sheet cell is left empty."
  />
);

export default QLeadsGoogleSheetExportReport;
