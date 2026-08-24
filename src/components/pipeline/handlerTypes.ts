export type HandlerBucket = 'new' | 'active' | 'non_active' | 'closed';

export type HandlerPipelineRow = {
  id: string;
  navId: string;
  lead_number: string;
  name: string;
  assigned_date: string | null;
  next_followup: string | null;
  category: string;
  mainCategory: string;
  language: string | null;
  country: string | null;
  country_id: number | null;
  timezone: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  applicants: number | null;
  value: number | null;
  currency: string | null;
  valueNis: number;
  stage: string;
  stageId: number | null;
  retentionHandlerName: string | null;
  handlerName?: string | null;
  retentionHandlerStarted?: boolean;
  bucket: HandlerBucket;
  isInactive: boolean;
  isNewLead: boolean;
  active_handler_type: 1 | 2;
  isFirstPaymentPaid: boolean;
  hasReadyToPay: boolean;
  hasUnpaidPayment: boolean;
  hasPaymentPlan: boolean;
  handlerAssignedDate?: string | null;
  firstHandlerAssignedDate?: string | null;
  previousHandlerName?: string | null;
  previousHandlerAssignedDate?: string | null;
  stage105Date?: string | null;
  stage110Date?: string | null;
};

export function handlerDbId(row: HandlerPipelineRow): string {
  return row.id.replace(/^legacy_/, '');
}
