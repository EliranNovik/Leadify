/**
 * Marketing: high-quality leads appended to the HQLeads Google Sheet (export log).
 */
import React from 'react';
import GoogleSheetConversionExportReport from '../components/reports/GoogleSheetConversionExportReport';

const HQLeadsGoogleSheetExportReport: React.FC = () => (
  <GoogleSheetConversionExportReport
    destination="hq_leads_capital_firm"
    syncFunction="google-sheets-hqleads-sync"
    logTag="HQLeadsGoogleSheetExportReport"
    description="Q leads at Meeting Scheduled (stage 20+) with potential ≥ 50% (legal, seriousness, financial) and balance ≥ ₪20,000 NIS — Capital firm sources. GCLID is included when present; otherwise the sheet cell is left empty."
  />
);

export default HQLeadsGoogleSheetExportReport;
