import { supabase } from './supabase';
import { fetchLeadCaseFileForAi, withRequiredDocumentLinks } from './leadFollowupAiApi';
import { getStageName } from './stageUtils';
import { fetchStage60RecordsInRange, resolveStage60SignTimestamp, toSignCalendarDateKey } from './stage60SignDate';
import {
  fetchActiveClockInLocations,
  resolveWorkplaceName,
  type ClockInLocationOption,
} from './clockInLocations';
import { fetchActiveStaffEmployeesWithDepartment } from './employeeSalaries';
import { buildJerusalemEndOfDayIso, buildJerusalemStartOfDayIso } from './leadDateFilters';
import {
  UNAVAILABILITY_SELECT,
  isGeneralUnavailability,
  isUnavailabilityCounted,
  unavailabilityGeneralTimeRange,
  unavailabilityReasonText,
  unavailabilityTypeLabel,
  type EmployeeUnavailabilityEntry,
} from './employeeUnavailabilities';
import { createRmqExcelFile, type ExcelSheetInput } from './rmqAiExcel';
import { findCrmAppPlaces } from './crmAppMap';
import { resolveLeadShareClientRoute } from './calendarClientRoute';
import {
  fetchFinanceExpenseEntries,
  formatFinanceExpenseAmount,
  type FinanceExpenseKind,
} from './financeExpenseCreate';
import {
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_CATEGORY_ORDER,
  fetchAllExpensesBreakdown,
  formatNis,
  listExpenseMonthsInRange,
  marketingExpenseTotal,
  type ExpenseCategoryKey,
} from './allExpensesReport';
import { fetchInvoicedTotalDueNisForDateRange } from './fetchInvoicedLast30TotalDueNis';
import { managementAmountToNis } from './firmManagementCosts';
import {
  currentLeadAsToolArgs,
  getRmqAiCurrentLead,
  isOpenClientRoleQuestion,
  isThisClientQuery,
  queryMatchesOpenLead,
} from './rmqAiChatContext';
import { requireResolvedLead } from './rmqAiLeadResolver';
import { logRmqAiToolRouting } from './rmqAiRoutingLog';
import { getValidTeamsLink } from './meetingJoinLink';
import { formatMeetingValue } from './meetingValue';
import { ensureLeadCategories, resolveLeadCategoryName } from './leadMetaDisplay';
import {
  clickableLeadNumber,
  leadDisplayName,
  lookupLeadsByIds,
  resolveMeetingLead,
} from './rmqAiLeadDisplay';
import {
  executeDraftClientMessage,
  executeListMySalesDay,
  executeListStaleSalesLeads,
  executeLogManualNote,
  executePrepMeeting,
  executeSetFollowUp,
  executeWrapUpMeeting,
} from './rmqAiSalesTools';

export const RMQ_AI_ALLOWED_TABLES = {
  leads: [
    'id',
    'lead_number',
    'name',
    'email',
    'phone',
    'mobile',
    'topic',
    'category',
    'stage',
    'status',
    'source',
    'language',
    'created_at',
    'expert',
    'closer',
    'scheduler',
    'manager',
    'helper',
    'handler',
    'case_handler_id',
    'retainer_handler_id',
    'proposal_total',
    'proposal_currency',
    'balance',
    'balance_currency',
    'date_signed',
    'next_followup',
    'follow_up_date',
    'meeting_date',
    'meeting_time',
    'meeting_brief',
    'facts',
    'special_notes',
    'general_notes',
    'expert_notes',
    'handler_notes',
    'eligibility_status',
    'section_eligibility',
    'eligible',
    'expert_examination',
    'probability',
    'number_of_applicants_meeting',
    'potential_applicants_meeting',
    'tags',
  ],
  leads_lead: [
    'id',
    'name',
    'lead_number',
    'email',
    'phone',
    'mobile',
    'topic',
    'stage',
    'source',
    'language',
    'cdate',
    'expert',
    'closer',
    'proposal',
    'balance',
    'total',
    'total_base',
    'category',
    'meeting_date',
    'meeting_time',
    'meeting_brief',
    'status',
    'expert_notes',
    'expert_opinion',
    'handler_notes',
    'eligibility_status',
    'section_eligibility',
    'eligibile',
    'expert_examination',
    'closer_id',
    'meeting_scheduler_id',
    'case_handler_id',
    'retainer_handler_id',
  ],
  meetings: [
    'id',
    'client_id',
    'legacy_lead_id',
    'meeting_date',
    'meeting_time',
    'status',
    'meeting_brief',
    'meeting_summary_notes',
    'meeting_location',
    'meeting_amount',
    'meeting_currency',
    'created_at',
  ],
  payment_plans: [
    'id',
    'lead_id',
    'value',
    'due_date',
    'paid',
    'paid_at',
    'cancel_date',
    'currency',
  ],
  contracts: [
    'id',
    'client_id',
    'legacy_id',
    'contact_id',
    'status',
    'signed_at',
    'total_amount',
    'created_at',
    'updated_at',
    'public_token',
  ],
  leads_leadstage: [
    'id',
    'lead_id',
    'newlead_id',
    'stage',
    'date',
    'cdate',
    'creator_id',
  ],
  office_expenses: [
    'id',
    'firm_id',
    'amount',
    'currency',
    'expense_type_id',
    'description',
    'paid',
    'paid_at',
    'created_at',
    'created_by',
  ],
  firm_management_costs: [
    'id',
    'firm_id',
    'amount',
    'currency',
    'notes',
    'billing_month',
    'expense_type_id',
    'created_at',
  ],
  employee_salary: [
    'id',
    'employee_id',
    'gross_salary',
    'net_salary',
    'salary_month',
    'salary_year',
    'uploaded_by',
  ],
  source_media_expense: [
    'id',
    'amount',
    'expense_month',
    'lead_source_id',
    'created_at',
    'created_by',
  ],
  office_rent_expense: [
    'id',
    'amount_nis',
    'expense_month',
    'office_id',
    'created_at',
    'created_by',
  ],
  partner_draw_expense: [
    'id',
    'amount_nis',
    'expense_month',
    'employee_id',
    'created_at',
    'created_by',
  ],
  lead_expenses: [
    'id',
    'amount',
    'expense_date',
    'notes',
    'lead_number',
    'created_at',
    'created_by',
  ],
  lead_subcontractor_fees: [
    'id',
    'amount',
    'notes',
    'lead_number',
    'firm_id',
    'created_at',
    'created_by',
  ],
  finance_expense_entries: [
    'id',
    'kind',
    'expense_date',
    'amount',
    'currency_code',
    'category_label',
    'vendor_label',
    'notes',
    'created_at',
    'created_by',
  ],
} as const;

const ALLOWED_OPERATIONS = ['count', 'avg', 'sum', 'min', 'max', 'distinct', 'select'] as const;
const ALLOWED_OPERATORS = ['=', '!=', '<', '<=', '>', '>=', 'like', 'ilike'] as const;

type AllowedTable = keyof typeof RMQ_AI_ALLOWED_TABLES;

export const RMQ_AI_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_lead_case_file',
      description:
        'Load a full CRM snapshot for one lead (new or legacy): ASSIGNED ROLES (Handler, Expert, Manager, Closer, Scheduler), EXPERT ELIGIBILITY, EXPERT OPINION, handler notes, identity, stage, proposal, facts, meetings, WhatsApp, email, calls, and manuals. ALWAYS use this for who the expert / handler / manager / closer / scheduler is — then answer from the matching ASSIGNED ROLES line only. Manager is Roles tab Manager, not the case handler. ALWAYS use this for eligibility, expert opinion, what was said, or a communication summary. Uses the open client page when query is omitted. Identify another lead only when they named a different number.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Lead number, name, email, phone, or id',
          },
          lead_id: {
            type: 'string',
            description: 'Exact lead id when already known (UUID or legacy_123)',
          },
          is_legacy: {
            type: 'boolean',
            description: 'True when lead_id is a legacy numeric id',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_calendar_day',
      description:
        'Get the office calendar for ONE date in Asia/Jerusalem (today, tomorrow, or YYYY-MM-DD). Use for “who has meetings today”, “my meetings today”, or meetings scheduled by an employee. Returns JSON; the UI renders one card per meeting. Reply with one short sentence only. Do NOT use this to find meetings for a particular client or the open lead — call list_client_meetings instead.',
      parameters: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description:
              'Calendar day: today, tomorrow, yesterday, or YYYY-MM-DD. Defaults to today in Asia/Jerusalem.',
          },
          scope: {
            type: 'string',
            enum: ['mine', 'all'],
            description:
              'mine = only meetings where the logged-in user is meeting manager, helper, guest (extern1/extern2), or a meeting participant. Use mine for “my meetings today” / the Meetings today button. all = every meeting that day. Default all unless they asked for their own meetings.',
          },
          scheduler: {
            type: 'string',
            description:
              'Scheduler employee name (lead scheduler role), e.g. Dana. Typos and partial names are fuzzy-matched to the closest employee. Do not put the scheduler name in query.',
          },
          query: {
            type: 'string',
            description: 'Optional client / lead name or lead number filter. Not the scheduler.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_meetings',
      description:
        'Alias of list_calendar_day. Prefer list_calendar_day. Office calendar for ONE date in Asia/Jerusalem. Do NOT use this for one client’s next meeting — call list_client_meetings.',
      parameters: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description:
              'Calendar day: today, tomorrow, yesterday, or YYYY-MM-DD. Defaults to today in Asia/Jerusalem.',
          },
          scope: {
            type: 'string',
            enum: ['mine', 'all'],
            description:
              'mine = only meetings where the logged-in user is meeting manager, helper, guest (extern1/extern2), or a meeting participant. all = every meeting that day.',
          },
          scheduler: {
            type: 'string',
            description: 'Scheduler employee name. Do not put the scheduler name in query.',
          },
          query: {
            type: 'string',
            description: 'Optional client / lead name or lead number filter. Not the scheduler.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_client_meetings',
      description:
        'Get meetings for one specific CRM lead or the currently open client. Use for next meeting, previous meeting, meeting brief, or meeting summary for this client / this lead. Do not use list_calendar_day for that.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Lead number, name, or id. Omit when the client page is open.',
          },
          lead_id: {
            type: 'string',
            description: 'Exact lead id when already known (UUID or legacy_123)',
          },
          is_legacy: {
            type: 'boolean',
            description: 'True when lead_id is a legacy numeric id',
          },
          date: {
            type: 'string',
            description: 'Optional specific day (today, tomorrow, YYYY-MM-DD, or DD.MM.YYYY) to highlight that meeting.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_signed_contracts',
      description:
        'Stats and a list of signed/closed client agreements in a date range (Asia/Jerusalem). ALWAYS use this for “how many signed”, “closed deals”, “who closed”, or “contracts closed by X”. Closed deals = the lead closer employee role (leads.closer / leads_lead.closer_id), not the client name. Sign date is leads_leadstage stage 60. Returns counts (new vs legacy), amounts, lead numbers, closer names, and the full list.',
      parameters: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description:
              'Single day or period: today, yesterday, this week, last week, this month, last month, last 7 days, last 30 days, or YYYY-MM-DD. Ignored when date_from/date_to are set. Defaults to today.',
          },
          date_from: {
            type: 'string',
            description: 'Range start: today, yesterday, or YYYY-MM-DD / DD/MM/YYYY.',
          },
          date_to: {
            type: 'string',
            description: 'Range end: today, yesterday, or YYYY-MM-DD / DD/MM/YYYY.',
          },
          period: {
            type: 'string',
            description: 'Same values as date (this month, last 30 days, …).',
          },
          lead_type: {
            type: 'string',
            enum: ['all', 'new', 'legacy'],
            description: 'Limit to new leads, legacy leads, or both. Default all.',
          },
          closer: {
            type: 'string',
            description:
              'Closer employee name (lead closer role), e.g. Yehonatan. Typos and partial names are fuzzy-matched to the closest employee. Do not put the closer name in query.',
          },
          query: {
            type: 'string',
            description: 'Optional client / lead name or lead number filter. Not the closer.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_employee_presence',
      description:
        'Who is available now, who is clocked in/out, and where (office). ALWAYS use this for “who is in the office”, “who is available in Ramat Gan / Jerusalem / home”, “who clocked in”, or an employee’s clock-in/out location. Uses live employee_clock_in rows plus approved leave and calendar unavailability. Available at an office = currently clocked in there and not on blocking leave/unavailability.',
      parameters: {
        type: 'object',
        properties: {
          office: {
            type: 'string',
            description:
              'Office / workplace, e.g. Ramat Gan, Jerusalem, Home. Typos and short names are fuzzy-matched. Pass this for “available in X office”.',
          },
          employee: {
            type: 'string',
            description:
              'Optional employee name. Typos and partial names are fuzzy-matched. Use for “where did Dana clock in”.',
          },
          query: {
            type: 'string',
            description:
              'Fallback if you did not split office vs employee: an office name or an employee name. Prefer office/employee instead.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_excel_sheet',
      description:
        'Create a real .xlsx spreadsheet and a working download link. ALWAYS use this when the user asks for Excel, a spreadsheet, a downloadable table, or to export a list. For who is available / clocked in at an office, pass source=employee_presence with the same office/employee filters instead of retyping rows. For other data, pass columns and rows from prior tool results. Never invent a URL — copy the exact markdown from this tool.',
      parameters: {
        type: 'object',
        properties: {
          filename: {
            type: 'string',
            description: 'File name, e.g. ramat-gan-available. .xlsx is added if missing.',
          },
          sheet_name: {
            type: 'string',
            description: 'Worksheet tab name. Default Sheet1.',
          },
          title: {
            type: 'string',
            description: 'Optional title used in the filename if filename is omitted.',
          },
          source: {
            type: 'string',
            enum: ['custom', 'employee_presence'],
            description:
              'employee_presence builds the sheet from live clock-in and unavailability. custom uses columns/rows you provide.',
          },
          office: {
            type: 'string',
            description: 'When source=employee_presence, workplace filter such as Ramat Gan.',
          },
          employee: {
            type: 'string',
            description: 'When source=employee_presence, optional employee name.',
          },
          filter: {
            type: 'string',
            enum: ['all', 'available', 'clocked_in'],
            description:
              'When source=employee_presence: all matching people, only available now, or anyone currently clocked in. Default all.',
          },
          columns: {
            type: 'array',
            items: { type: 'string' },
            description: 'Column headers for a custom sheet.',
          },
          rows: {
            type: 'array',
            description:
              'Custom rows: objects keyed by column name, or arrays in column order. Required when source is custom.',
          },
          sheets: {
            type: 'array',
            description: 'Optional multiple worksheets: [{ name, columns, rows }].',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                columns: { type: 'array', items: { type: 'string' } },
                rows: { type: 'array' },
              },
            },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_app_page',
      description:
        'Map of the CRM: find where a screen lives and return a clickable in-app path. ALWAYS use this when the user asks where to find something, how to open a page, or “take me to…”. Examples: calendar, working hours, expenses, HR, collection, create lead, client finances tab.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'What they want to find, in their words. Include a lead number if they named one.',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_crm',
      description:
        'Run a safe read-only query against CRM tables for counts, lists, or aggregates. Use for questions like how many leads are in a stage or average proposal. Do not use this for signed-contract stats by date — use list_signed_contracts. Do not use this for who is in the office, clocked in/out, or available employees — use list_employee_presence. Do not use this for where a page is in the app — use find_app_page. Do not use this for a single-lead narrative — use get_lead_case_file instead. Do not use this for office expenses, salaries, external firms, rent, marketing, or income/P&L — use list_expenses or get_firm_financials.',
      parameters: {
        type: 'object',
        properties: {
          table: {
            type: 'string',
            enum: Object.keys(RMQ_AI_ALLOWED_TABLES),
          },
          operation: {
            type: 'string',
            enum: [...ALLOWED_OPERATIONS],
          },
          column: {
            type: 'string',
            description: 'Column for select/aggregate. Omit on count or full-row select.',
          },
          filters: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                column: { type: 'string' },
                operator: { type: 'string', enum: [...ALLOWED_OPERATORS] },
                value: { type: 'string' },
              },
              required: ['column', 'operator', 'value'],
            },
          },
          limit: { type: 'number' },
        },
        required: ['table', 'operation'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_expenses',
      description:
        'List expenses as they appear on the Expenses page. KIND is the summary card (Client, Office, Subcontractor, …). CATEGORY is the table CATEGORY column (Courier and delivery, government fee, translation, …). CREATED BY is the employee who added the row. ALWAYS use for spend, who added an expense, or which expense category. Defaults to this month (Asia/Jerusalem). Pass date=today when they say today.',
      parameters: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description:
              'Day or period: today, yesterday, this week, last week, this month, last month, this year, last year, last 7 days, last 30 days, or YYYY-MM-DD. Ignored when date_from/date_to are set. Defaults to this month.',
          },
          date_from: {
            type: 'string',
            description: 'Range start: today, yesterday, or YYYY-MM-DD / DD/MM/YYYY.',
          },
          date_to: {
            type: 'string',
            description: 'Range end: today, yesterday, or YYYY-MM-DD / DD/MM/YYYY.',
          },
          period: {
            type: 'string',
            description: 'Same values as date (this month, this year, last 30 days, …).',
          },
          kind: {
            type: 'string',
            enum: [
              'all',
              'office',
              'salaries',
              'other_firm',
              'marketing',
              'rent',
              'partner_draws',
              'lead',
              'subcontractor',
            ],
            description:
              'all = every expense type. office = office expenses. salaries = payroll. other_firm = external firms / firm management. marketing = ads / source media. rent, partner_draws, lead (client expenses), subcontractor. Default all.',
          },
          added_by: {
            type: 'string',
            description: 'Filter line items by the person who added them (name, fuzzy).',
          },
          search: {
            type: 'string',
            description: 'Optional vendor, category, notes, or lead number filter.',
          },
          limit: {
            type: 'number',
            description: 'Max line items to list. Default 30, max 80.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_firm_financials',
      description:
        'Firm P&L snapshot: income vs all expenses, so you can say where the firm stands and what to improve. Income is the Sales Contribution total (90% of invoiced due in the date range). Expenses are All Expenses report totals in NIS (office, salaries, external firms, marketing, rent, partner draws). ALWAYS use this for profit, loss, how we are doing, income this month, burn rate, or “are we spending too much”. Defaults to this month (Asia/Jerusalem).',
      parameters: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description:
              'Period: today, this week, this month, last month, this year, last year, last 30 days, or YYYY-MM-DD. Ignored when date_from/date_to are set. Defaults to this month.',
          },
          date_from: { type: 'string', description: 'Range start YYYY-MM-DD.' },
          date_to: { type: 'string', description: 'Range end YYYY-MM-DD.' },
          period: {
            type: 'string',
            description: 'Same values as date (this month, this year, …).',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_my_sales_day',
      description:
        'The logged-in salesperson’s work queue for today (Asia/Jerusalem): my meetings today/tomorrow, overdue and today follow-ups, and my leads waiting in reschedule (21), price offer (40), or unsigned (50). ALWAYS use for “my day”, what should I do now, or my follow-ups.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'draft_client_message',
      description:
        'Load the full case file so you can write a detailed, professional client email or WhatsApp — never a short check-in. ALWAYS use when they ask to draft, write, or rephrase outreach. Analyze meetings, last messages, contracts/POA, payments, and next steps. Stop after Best regards / בברכה — no name, title, phone, or email signature. Uses the open client if no lead is named. Intents: first_contact, confirm_meeting, no_show, follow_up, after_meeting, price_offer, signature_chase.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Lead number or name. Omit if a client page is open.' },
          lead_id: { type: 'string' },
          is_legacy: { type: 'boolean' },
          channel: { type: 'string', enum: ['email', 'whatsapp', 'sms'] },
          intent: {
            type: 'string',
            enum: [
              'first_contact',
              'confirm_meeting',
              'no_show',
              'follow_up',
              'after_meeting',
              'price_offer',
              'signature_chase',
            ],
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'prep_meeting',
      description:
        'Meeting prep pack: time, attendees, case facts, last comms. Use for “prep me”, “prep my next meeting”, or prep a named lead. Uses the open client or the user’s next meeting.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          lead_id: { type: 'string' },
          is_legacy: { type: 'boolean' },
          date: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wrap_up_meeting',
      description:
        'After-meeting wrap: existing/polished summary, case facts, suggested next follow-up. Use for “wrap up”, “after the meeting”, or meeting summary. Then call set_follow_up to save a date, and draft_client_message intent=price_offer if they need an offer email.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          lead_id: { type: 'string' },
          is_legacy: { type: 'boolean' },
          notes: { type: 'string', description: 'Optional raw notes to polish into a summary.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_follow_up',
      description:
        'Save a follow-up date (YYYY-MM-DD) for the current user on a lead. Use after wrap-up or when they ask to set/move a follow-up. Uses the open client if no lead is named.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          query: { type: 'string' },
          lead_id: { type: 'string' },
          is_legacy: { type: 'boolean' },
          note: { type: 'string' },
        },
        required: ['date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'log_manual_note',
      description:
        'Log a call / WhatsApp / note on a new lead timeline. Use when they say log this call or save this note.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string' },
          kind: { type: 'string', enum: ['note', 'call', 'whatsapp', 'email'] },
          query: { type: 'string' },
          lead_id: { type: 'string' },
          is_legacy: { type: 'boolean' },
        },
        required: ['content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_stale_sales_leads',
      description:
        'My closer/scheduler leads that went quiet (default 5 days) or sit in stages 21/40/50. ALWAYS use for “who hasn’t answered”, stale deals, or chase list.',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Days without a touch. Default 5.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_lead',
      description: 'Create a new lead in the CRM.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
          topic: { type: 'string' },
          language: { type: 'string' },
        },
        required: ['name', 'topic'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_meeting',
      description: 'Set meeting date/time/brief on a new lead by lead number.',
      parameters: {
        type: 'object',
        properties: {
          lead_number: { type: 'string' },
          meeting_date: { type: 'string' },
          meeting_time: { type: 'string' },
          meeting_brief: { type: 'string' },
          manager: { type: 'string' },
          helper: { type: 'string' },
        },
        required: ['lead_number', 'meeting_date', 'meeting_time'],
      },
    },
  },
];

export const RMQ_AI_SYSTEM_PROMPT =
  'You are RMQ AI, the assistant inside Leadify CRM (Rainmaker Queen). ' +
  'You can look up any lead and query CRM tables through tools. ' +
  'When the user asks about a specific client, call get_lead_case_file first, then answer the question they asked from that data. Do not turn a specific question into a full lead recap. For next meeting / brief / summary questions, call list_client_meetings instead. ' +
  'Identify leads by lead number (L226999), name, email, phone, or id. If they say this client / this lead and a client page is open, omit query — tools use that lead. ' +
  'When an OPEN CLIENT block is present, NEVER ask for a lead number. Use that lead immediately. ' +
  'When they ask for this client’s next meeting, what the meeting is for, or the meeting summary / brief, ALWAYS call list_client_meetings using the open client. If they name a date (e.g. 02.09.2026), pass date=. Reply with one short sentence only. The UI shows date, time, location, brief, and summary in a card. Do not repeat those fields in prose. Do not say there is no brief if the tool JSON has text. list_calendar_day is only for a calendar day across many leads. ' +
  'When listing leads or meetings, ALWAYS copy the lead number from the tool (L214188 or 209994/9) as a bare token so it stays clickable. Never write Unnamed if the tool gave a number, name, or Internal meeting. Never list a client by name only. ' +
  'When they ask for my day, what to do now, or my follow-ups, ALWAYS call list_my_sales_day. Reply as a short numbered list with lead numbers and one next action each. ' +
  'When they ask to draft, write, or rephrase an email or WhatsApp, ALWAYS call draft_client_message, then reply with ONLY the draft in the client language. The draft must be detailed and professional: read the case file, use real facts, and write 4–7 short paragraphs — never a one-line follow-up. Stop after Best regards / בברכה. Do not add a signature, name, title, phone, or email — the CRM appends that. ' +
  'When they ask for a contract, agreement, signing link, POA, or power of attorney link, ALWAYS call get_lead_case_file or draft_client_message and copy the exact https URL from REQUIRED LINKS / signing_link / poa_link onto its own line. Never invent a URL. Never use example.com. ' +
  'When they ask to prep a meeting or prep my next meeting, ALWAYS call prep_meeting. ' +
  'When they ask to wrap up a meeting or write the meeting summary, ALWAYS call wrap_up_meeting. Call set_follow_up to save a date. Call draft_client_message with intent=price_offer for an offer email. ' +
  'When they ask who has not answered or who is stale, ALWAYS call list_stale_sales_leads. ' +
  'When they ask to set a follow-up date, call set_follow_up. When they ask to log a call or note, call log_manual_note. ' +
  'When they ask who a role is (handler, expert, manager, closer, scheduler, helper), ALWAYS call get_lead_case_file and copy only that line from ASSIGNED ROLES. ' +
  'Handler = Roles tab Handler (case handler). Manager = Roles tab Manager (meeting manager), not the handler. Closer = Roles tab Closer. Expert = Roles tab / Expert tab Expert. Scheduler = Roles tab Scheduler. ' +
  'Only say a role is unassigned if THAT specific ASSIGNED ROLES line is —. Do not answer a manager/closer/expert question with the handler line. Do not name Yehonatan D unless that role line is that person. ' +
  'When they ask if the client is eligible, eligibility, eligibility status, or eligibility decided, ALWAYS call get_lead_case_file. Answer ONLY from the EXPERT ELIGIBILITY block. Copy Expert assessment, Eligibility decided, and Citizenship section. At most 4 short lines. Do not recap family history, expert opinion text, stage, or proposal. Do not guess from notes. Do not say the expert has not stated eligibility if Expert assessment is not Not checked. Do not tell them to consult the expert when those fields are set. ' +
  'When they ask what the expert says, the expert opinion, expert notes, or what the expert thinks/wrote, ALWAYS call get_lead_case_file. Answer ONLY from the EXPERT OPINION block (Expert tab). Quote or paraphrase that text. Do not recap stage, proposal, last communication, team, or other CRM fields. If that block is empty or (none on file), check Meeting expert notes; if those are also empty, say there is no expert opinion on file. ' +
  'When they ask what the handler wrote or handler notes, use the HANDLER NOTES block the same way — not a general lead recap. ' +
  'When they ask who has meetings today/tomorrow or on a date, or meetings scheduled by an employee, ALWAYS call list_calendar_day first. ' +
  'When they ask for my meetings, meetings today (their own), or use the Meetings today shortcut, call list_calendar_day with scope=mine. That list is only meetings where the logged-in user is meeting manager, helper, guest, or a participant. ' +
  'When they ask who has meetings (everyone) or meetings scheduled by a named employee, use scope=all and pass scheduler= if they named someone. ' +
  'Reply with one short sentence only (e.g. Here are the meetings scheduled for tomorrow). The UI shows each meeting as a card. Do not list times, lead numbers, names, or roles in prose. Do not number the meetings. ' +
  'Scheduled meetings use the lead scheduler employee role. Pass scheduler= the name as typed; the tool fuzzy-matches typos and closest employees. Never put the scheduler name in query — query is the client. ' +
  'Do not say there are no meetings unless list_calendar_day returned none. ' +
  'When they ask about signed contracts, closed deals, who closed, or how many clients signed in a date range, ALWAYS call list_signed_contracts first. ' +
  'Closed deals use the lead closer employee role. Pass closer= the name as typed; the tool fuzzy-matches typos and closest employees (Yehonatan → Yehonatan D.). Never put the closer name in query — query is the client. ' +
  'That tool covers both new leads (leads.closer + contracts.client_id) and legacy leads (leads_lead.closer_id + contracts.legacy_id) using leads_leadstage stage 60 as the sign date. ' +
  'Do not say there are no signed/closed contracts unless list_signed_contracts returned none. Do not query only the contracts table for those stats. ' +
  'When they ask who is available now, who is in an office (Ramat Gan, Jerusalem, Home), who clocked in or out, or where an employee clocked in, ALWAYS call list_employee_presence first. ' +
  'Pass office= the workplace as typed (e.g. Ramat Gan). Pass employee= only when asking about a specific person. Do not guess presence — use the tool. ' +
  'Available at an office means clocked in at that workplace right now and not on approved leave or a current unavailability window. ' +
  'Do not say you cannot access employee availability or clock-in data. Do not say nobody is available unless list_employee_presence returned none. ' +
  'When they ask for Excel, a spreadsheet, a downloadable table, or to export a list, ALWAYS call create_excel_sheet. ' +
  'For office availability exports, pass source=employee_presence and office= as typed. Use filter=available when they only want people available now. Do not invent a download URL — paste the exact markdown from the tool result. ' +
  'When they ask where to find a page, how to open a screen, or “take me to…”, ALWAYS call find_app_page. ' +
  'Paste the exact markdown links from that tool so they stay clickable and open the page. Do not invent routes. ' +
  'When they ask about expenses, spend, who added a cost, expense category, office expenses, salaries, payroll, external firms, marketing, rent, or partner draws, ALWAYS call list_expenses first. ' +
  'Pass date=today when they say today. Pass kind= only to filter a summary card (office, salaries, other_firm, marketing, rent, lead, subcontractor) or kind=all. Pass added_by= only if they named who created the expense. ' +
  'KIND is the summary card (Client, Office, …). CATEGORY is the table CATEGORY column (Courier and delivery, government fee, translation, …). Never answer a category question with KIND. Quote category= and added_by= from LINE ITEMS. Never invent an employee or a fee name. ' +
  'When they ask what expenses were recorded, number only each expense category (1. Courier and delivery — NIS 200). Put Added by and Lead on the next lines with no extra numbers or bullets. If they only asked for the total, reply with one line: TOTAL: NIS X. ' +
  'Do not say you cannot see expenses. Use the tool; do not invent amounts. ' +
  'When they ask about income, profit, loss, how the firm is doing, burn, or whether spending is too high, ALWAYS call get_firm_financials. ' +
  'Income is the Sales Contribution total: 90% of invoiced due in the date range (same large number as Sales Contribution). Compare it to all expenses and give practical advice (which categories are largest, expense ratio vs income). ' +
  'When they ask other counts, lists, or aggregates, use query_crm. ' +
  'Never invent CRM facts. If a tool finds no match and no OPEN CLIENT is present, say so and ask for a lead number. If OPEN CLIENT is present, retry with that lead_id instead of asking. ' +
  'Answer only what they asked. When they ask for a lead overview or summary, cover stage, topic, team, proposal/balance, meetings, last communication, next follow-up, and risks. Do not dump that recap for a specific question such as eligibility, expert opinion, handler notes, or what was said. ' +
  'When listing signed leads or meetings, write the lead number as plain text (L228016), never as [L228016](#). Plain lead numbers stay clickable. ' +
  'Write CRM stage names as the exact stage label from the tool, with no quotation marks. Do not write "Meeting Scheduled" or \'Price offer\' — write Meeting Scheduled. The UI shows stages as badges. ' +
  'When they ask what was said, discussed, talked about, or a summary of communication / emails / WhatsApp / notes, use the EMAIL, WHATSAPP, CALLS, and MANUAL NOTES blocks from get_lead_case_file. Quote or paraphrase that actual text. Manual notes often record WhatsApp or phone conversations. Do not say there were no emails or WhatsApp if those blocks contain text. Do not tell them to look in the CRM for content that is already in the case file. ' +
  'When the user shares images, analyze them when relevant.';

function clip(value: unknown, max = 240): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function columnsFor(table: string): string[] {
  return [...(RMQ_AI_ALLOWED_TABLES[table as AllowedTable] || [])];
}

function jerusalemTodayIso(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addIsoDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

function normalizeCrmDateValue(raw: string): string {
  const value = String(raw || '').trim();
  const lower = value.toLowerCase();
  if (!value || lower === 'today') return jerusalemTodayIso();
  if (lower === 'tomorrow') return addIsoDays(jerusalemTodayIso(), 1);
  if (lower === 'yesterday') return addIsoDays(jerusalemTodayIso(), -1);
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = value.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (dmy) {
    const day = dmy[1].padStart(2, '0');
    const month = dmy[2].padStart(2, '0');
    const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    return `${year}-${month}-${day}`;
  }
  return value;
}

function isCrmDateColumn(column: string): boolean {
  return /date|signed_at|paid_at|created_at|cdate|updated_at|_at$/i.test(column);
}

function applyFilters(query: any, filters: Array<{ column: string; operator: string; value: string }>) {
  let next = query;
  for (const filter of filters) {
    const { column, operator } = filter;
    const value = isCrmDateColumn(column) ? normalizeCrmDateValue(filter.value) : filter.value;
    const dayOnly = isCrmDateColumn(column) && /^\d{4}-\d{2}-\d{2}$/.test(value);
    if (operator === '=' && dayOnly) {
      next = next.gte(column, value).lt(column, addIsoDays(value, 1));
    } else if (operator === '=') next = next.eq(column, value);
    else if (operator === '!=') next = next.neq(column, value);
    else if (operator === '<') next = next.lt(column, value);
    else if (operator === '<=' && dayOnly) next = next.lt(column, addIsoDays(value, 1));
    else if (operator === '<=') next = next.lte(column, value);
    else if (operator === '>') next = next.gt(column, value);
    else if (operator === '>=') next = next.gte(column, value);
    else if (operator === 'like' || operator === 'ilike') {
      const pattern = String(value).includes('%') ? value : `%${value}%`;
      next = next.ilike(column, pattern);
    }
  }
  return next;
}

function isNamedOtherLead(query: string, fallback: { query?: string; lead_id?: string }): boolean {
  const raw = String(query || '').trim();
  if (!raw || isThisClientQuery(raw)) return false;
  if (queryMatchesOpenLead(raw, fallback)) return false;
  if (isOpenClientRoleQuestion(raw, fallback)) return false;
  return true;
}

function roleDisplayName(name: string): string {
  const value = String(name || '').trim();
  if (!value || value === '---' || /^not[_ ]assigned$/i.test(value)) return '—';
  return value;
}

function isUnresolvedRoleName(name: string): boolean {
  const value = String(name || '').trim();
  return !value || value === '—' || value === '---' || /^\d+$/.test(value);
}

/** Same lookup as ExpertTab.getExpertName — tenants_employee by id, then employees.full_name. */
async function lookupEmployeeNameById(id: unknown): Promise<string> {
  if (id == null) return '';
  const raw = String(id).trim();
  if (!raw || raw === '---' || raw === '--' || /^not[_ ]assigned$/i.test(raw)) return '';
  const asNum = Number(raw);
  const idFilter = Number.isFinite(asNum) && String(asNum) === raw ? asNum : raw;
  const { data: employee } = await supabase
    .from('tenants_employee')
    .select('display_name')
    .eq('id', idFilter)
    .maybeSingle();
  const fromEmployee = String(employee?.display_name || '').trim();
  if (fromEmployee) return fromEmployee;
  const { data: fallback } = await supabase.from('employees').select('full_name').eq('id', idFilter).maybeSingle();
  return String(fallback?.full_name || '').trim();
}

function hasRoleValue(value: unknown): boolean {
  if (value == null) return false;
  const raw = String(value).trim();
  return raw !== '' && raw !== '—' && raw !== '---' && raw !== '--' && !/^not[_ ]assigned$/i.test(raw);
}

function legacyRoleKey(rawId: string): string | number {
  return /^\d+$/.test(rawId) ? Number(rawId) : rawId;
}

type LeadRoleFields = {
  caseHandler?: unknown;
  retentionHandler?: unknown;
  closer?: unknown;
  expert?: unknown;
  scheduler?: unknown;
  manager?: unknown;
  helper?: unknown;
  legacyLeadId?: unknown;
};

async function resolveRoleEmployeeName(raw: unknown, employees: EmployeeHit[]): Promise<string> {
  if (!hasRoleValue(raw)) return '—';
  const fromList = roleDisplayName(resolveCloserLabel(raw, raw, employees).name);
  if (!isUnresolvedRoleName(fromList)) return fromList;
  const fromDb = await lookupEmployeeNameById(raw);
  return fromDb ? roleDisplayName(fromDb) : fromList;
}

async function fetchLegacyRoleFields(rawId: string): Promise<LeadRoleFields | null> {
  const { data, error } = await supabase
    .from('leads_lead')
    .select(
      'case_handler_id, retainer_handler_id, closer_id, expert_id, meeting_scheduler_id, meeting_manager_id, meeting_lawyer_id',
    )
    .eq('id', legacyRoleKey(rawId))
    .maybeSingle();
  if (error || !data) return null;
  return {
    caseHandler: data.case_handler_id,
    retentionHandler: data.retainer_handler_id,
    closer: data.closer_id,
    expert: data.expert_id,
    scheduler: data.meeting_scheduler_id,
    manager: data.meeting_manager_id,
    helper: data.meeting_lawyer_id,
  };
}

async function fetchNewRoleFields(rawId: string): Promise<LeadRoleFields | null> {
  const full = await supabase
    .from('leads')
    .select(
      'handler, case_handler_id, retainer_handler_id, closer, expert, scheduler, manager, helper, legacy_lead_id, meeting_manager_id',
    )
    .eq('id', rawId)
    .maybeSingle();
  const row = full.error
    ? (
        await supabase
          .from('leads')
          .select('handler, case_handler_id, retainer_handler_id, closer, expert, scheduler, manager, helper, legacy_lead_id')
          .eq('id', rawId)
          .maybeSingle()
      ).data
    : full.data;
  if (!row) return null;
  return {
    caseHandler: row.case_handler_id || row.handler,
    retentionHandler: row.retainer_handler_id,
    closer: row.closer,
    expert: row.expert,
    scheduler: row.scheduler,
    manager: row.manager || row.meeting_manager_id,
    helper: row.helper,
    legacyLeadId: row.legacy_lead_id,
  };
}

function fillEmptyRoleFields(primary: LeadRoleFields, fallback: LeadRoleFields): LeadRoleFields {
  return {
    caseHandler: hasRoleValue(primary.caseHandler) ? primary.caseHandler : fallback.caseHandler,
    retentionHandler: hasRoleValue(primary.retentionHandler) ? primary.retentionHandler : fallback.retentionHandler,
    closer: hasRoleValue(primary.closer) ? primary.closer : fallback.closer,
    expert: hasRoleValue(primary.expert) ? primary.expert : fallback.expert,
    scheduler: hasRoleValue(primary.scheduler) ? primary.scheduler : fallback.scheduler,
    manager: hasRoleValue(primary.manager) ? primary.manager : fallback.manager,
    helper: hasRoleValue(primary.helper) ? primary.helper : fallback.helper,
    legacyLeadId: primary.legacyLeadId ?? fallback.legacyLeadId,
  };
}

async function loadLeadTeamRoles(
  leadId: string,
  isLegacy: boolean,
): Promise<{
  assignedExpert: string;
  assignedHandler: string;
  assignedManager: string;
  assignedCloser: string;
  assignedScheduler: string;
  block: string;
}> {
  const empty = {
    assignedExpert: '—',
    assignedHandler: '—',
    assignedManager: '—',
    assignedCloser: '—',
    assignedScheduler: '—',
    block: 'TEAM ROLES: (unavailable)',
  };
  try {
    const employees = await loadCloserEmployees();
    const rawId = String(leadId || '').replace(/^legacy_/i, '');
    let fields = isLegacy ? await fetchLegacyRoleFields(rawId) : await fetchNewRoleFields(rawId);
    if (!fields) {
      fields = isLegacy ? await fetchNewRoleFields(rawId) : await fetchLegacyRoleFields(rawId);
    }
    if (fields?.legacyLeadId != null && String(fields.legacyLeadId).trim() !== '') {
      const linked = await fetchLegacyRoleFields(String(fields.legacyLeadId));
      if (linked) fields = fillEmptyRoleFields(fields, linked);
    }
    if (!fields) return empty;

    const [dbHandler, dbRetention, dbCloser, dbExpert, dbScheduler, dbManager, dbHelper] = await Promise.all([
      resolveRoleEmployeeName(fields.caseHandler, employees),
      resolveRoleEmployeeName(fields.retentionHandler, employees),
      resolveRoleEmployeeName(fields.closer, employees),
      resolveRoleEmployeeName(fields.expert, employees),
      resolveRoleEmployeeName(fields.scheduler, employees),
      resolveRoleEmployeeName(fields.manager, employees),
      resolveRoleEmployeeName(fields.helper, employees),
    ]);

    const open = getRmqAiCurrentLead();
    const fill = async (fromDb: string, ...openVals: unknown[]) => {
      if (!isUnresolvedRoleName(fromDb)) return fromDb;
      for (const value of openVals) {
        const fromOpen = await resolveRoleEmployeeName(value, employees);
        if (!isUnresolvedRoleName(fromOpen)) return fromOpen;
      }
      return fromDb;
    };

    const caseHandler = await fill(dbHandler, open?.handler, open?.case_handler_id);
    const retentionHandler = await fill(dbRetention, open?.retainer_handler_id);
    const closer = await fill(dbCloser, open?.closer, open?.closer_id);
    const expert = await fill(dbExpert, open?.expert, open?.expert_id);
    const scheduler = await fill(dbScheduler, open?.scheduler, open?.meeting_scheduler_id);
    const manager = await fill(dbManager, open?.manager, open?.meeting_manager_id);
    const helper = await fill(dbHelper, open?.helper, open?.meeting_lawyer_id);

    return {
      assignedExpert: expert,
      assignedHandler: caseHandler,
      assignedManager: manager,
      assignedCloser: closer,
      assignedScheduler: scheduler,
      block: [
        'ASSIGNED ROLES (Roles tab — copy the matching line only):',
        `Handler: ${caseHandler}`,
        `Retention Handler: ${retentionHandler}`,
        `Closer: ${closer}`,
        `Expert: ${expert}`,
        `Scheduler: ${scheduler}`,
        `Manager: ${manager}`,
        `Helper: ${helper}`,
        'Handler is the Roles tab Handler. Manager is the Roles tab Manager, not the handler. Expert is the Expert tab person, not the closer.',
      ].join('\n'),
    };
  } catch (error) {
    console.warn('[rmq-ai] loadLeadTeamRoles', error);
    return empty;
  }
}

async function executeGetLeadCaseFile(args: {
  query?: string;
  lead_id?: string;
  is_legacy?: boolean;
}): Promise<string> {
  const lead = await requireResolvedLead(args);
  const [caseFile, team] = await Promise.all([
    fetchLeadCaseFileForAi({
      leadId: lead.leadId,
      isLegacy: lead.isLegacy,
    }),
    loadLeadTeamRoles(lead.leadId, lead.isLegacy),
  ]);
  return [
    `Matched: ${lead.leadNumber} ${lead.displayName}`,
    '',
    team.block,
    '',
    `ASSIGNED EXPERT: ${team.assignedExpert}`,
    `ASSIGNED HANDLER: ${team.assignedHandler}`,
    `ASSIGNED MANAGER: ${team.assignedManager}`,
    `ASSIGNED CLOSER: ${team.assignedCloser}`,
    `ASSIGNED SCHEDULER: ${team.assignedScheduler}`,
    '',
    withRequiredDocumentLinks(caseFile),
  ].join('\n');
}

function formatMeetingClock(value: unknown): string {
  const text = String(value ?? '').trim();
  return text.slice(0, 5) || '—';
}

function meetingDateIso(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return normalizeCrmDateValue(raw);
}

async function fetchMeetingsForResolvedLead(lead: {
  isLegacy: boolean;
  legacyLeadId?: string;
  clientId?: string;
  leadId: string;
}) {
  const rawId = String(lead.legacyLeadId || lead.clientId || lead.leadId || '').replace(/^legacy_/i, '');
  const meetingSelect =
    'id, meeting_date, meeting_time, status, meeting_brief, meeting_summary_notes, meeting_location, client_id, legacy_lead_id';
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const pushRows = (data: unknown) => {
    for (const row of (Array.isArray(data) ? data : []) as Record<string, unknown>[]) {
      const key = String(row.id ?? `${row.meeting_date}-${row.meeting_time}`);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
  };

  if (lead.isLegacy) {
    const numericId = /^\d+$/.test(rawId) ? Number(rawId) : rawId;
    const byLegacy = await supabase
      .from('meetings')
      .select(meetingSelect)
      .eq('legacy_lead_id', numericId)
      .order('meeting_date', { ascending: true })
      .limit(40);
    if (byLegacy.error) throw byLegacy.error;
    pushRows(byLegacy.data);
  } else {
    const byClient = await supabase
      .from('meetings')
      .select(meetingSelect)
      .eq('client_id', rawId)
      .order('meeting_date', { ascending: true })
      .limit(40);
    if (byClient.error) throw byClient.error;
    pushRows(byClient.data);
  }

  return rows;
}

export type ClientMeetingToolUi = {
  nextMeetingId?: string;
  askedMeetingId?: string;
  internalLeadId?: string;
  leadNumber?: string;
};

let lastClientMeetingUi: ClientMeetingToolUi | null = null;

export function takeClientMeetingToolUi(): ClientMeetingToolUi | null {
  const value = lastClientMeetingUi;
  lastClientMeetingUi = null;
  return value;
}

async function executeListClientMeetings(args: {
  query?: string;
  lead_id?: string;
  is_legacy?: boolean;
  date?: string;
}): Promise<string> {
  const lead = await requireResolvedLead(args);
  const rawId = String(lead.legacyLeadId || lead.clientId || lead.leadId).replace(/^legacy_/i, '');
  const today = jerusalemTodayIso();
  const askedDate = args.date ? meetingDateIso(args.date) : '';

  const leadQuery = lead.isLegacy
    ? supabase.from('leads_lead').select('id, name, lead_number, meeting_brief, meeting_date, meeting_time, meeting_location_old').eq('id', rawId).maybeSingle()
    : supabase.from('leads').select('id, name, lead_number, meeting_brief, meeting_date, meeting_time, meeting_location').eq('id', rawId).maybeSingle();

  const [meetingRows, { data: leadRow }] = await Promise.all([
    fetchMeetingsForResolvedLead(lead),
    leadQuery,
  ]);

  const leadBrief = String((leadRow as { meeting_brief?: unknown } | null)?.meeting_brief ?? '').trim();
  const rows = meetingRows.filter((row) => {
    const status = String(row.status || '').toLowerCase();
    return status !== 'canceled' && status !== 'cancelled';
  });

  const leadMeetingDate = meetingDateIso((leadRow as { meeting_date?: unknown } | null)?.meeting_date);
  const alreadyHasLeadDate = rows.some((row) => meetingDateIso(row.meeting_date) === leadMeetingDate);
  if (leadMeetingDate && !alreadyHasLeadDate) {
    rows.push({
      id: 'lead-row',
      meeting_date: leadMeetingDate,
      meeting_time: (leadRow as { meeting_time?: unknown } | null)?.meeting_time,
      status: 'scheduled',
      meeting_brief: leadBrief,
      meeting_summary_notes: null,
      meeting_location:
        (leadRow as { meeting_location?: unknown; meeting_location_old?: unknown } | null)?.meeting_location
        || (leadRow as { meeting_location_old?: unknown } | null)?.meeting_location_old,
    });
  }

  rows.sort((a, b) => {
    const aKey = `${meetingDateIso(a.meeting_date)}T${formatMeetingClock(a.meeting_time)}`;
    const bKey = `${meetingDateIso(b.meeting_date)}T${formatMeetingClock(b.meeting_time)}`;
    return aKey.localeCompare(bKey);
  });

  const upcoming = rows.filter((row) => meetingDateIso(row.meeting_date) >= today);
  const past = rows.filter((row) => meetingDateIso(row.meeting_date) < today).reverse();
  const next = upcoming[0] || null;
  const asked = askedDate
    ? rows.find((row) => meetingDateIso(row.meeting_date) === askedDate) || null
    : null;

  const toMeetingFact = (row: Record<string, unknown> | null) => {
    if (!row) return null;
    return {
      date: meetingDateIso(row.meeting_date),
      time: formatMeetingClock(row.meeting_time),
      location: String(row.meeting_location || '').trim() || null,
      status: String(row.status || 'scheduled'),
      summary: String(row.meeting_summary_notes || '').trim() || null,
      brief: String(row.meeting_brief || '').trim() || null,
    };
  };

  lastClientMeetingUi = {
    nextMeetingId: next && String(next.id || '') !== 'lead-row' ? String(next.id) : undefined,
    askedMeetingId: asked && String(asked.id || '') !== 'lead-row' ? String(asked.id) : undefined,
    internalLeadId: lead.leadId,
    leadNumber: lead.leadNumber,
  };

  return JSON.stringify({
    leadNumber: lead.leadNumber,
    displayName: lead.displayName,
    caseBrief: leadBrief || null,
    nextMeeting: toMeetingFact(next),
    askedMeeting: asked
      ? toMeetingFact(asked)
      : askedDate
        ? { date: askedDate, missing: true }
        : null,
    otherUpcoming: upcoming.slice(1).map((row) => toMeetingFact(row)),
    recentPast: past.slice(0, 8).map((row) => toMeetingFact(row)),
  });
}

async function executeQueryCrm(args: {
  table: string;
  operation: string;
  column?: string;
  filters?: Array<{ column: string; operator: string; value: string }>;
  limit?: number;
}): Promise<string> {
  const table = String(args.table || '');
  const operation = String(args.operation || '');
  const allowed = columnsFor(table);
  if (!allowed.length) {
    throw new Error(`Table '${table}' is not allowed. Allowed: ${Object.keys(RMQ_AI_ALLOWED_TABLES).join(', ')}`);
  }
  if (!ALLOWED_OPERATIONS.includes(operation as (typeof ALLOWED_OPERATIONS)[number])) {
    throw new Error(`Operation '${operation}' is not allowed.`);
  }

  const filters = Array.isArray(args.filters) ? args.filters : [];
  for (const filter of filters) {
    if (!allowed.includes(filter.column)) {
      throw new Error(`Filter column '${filter.column}' is not allowed on ${table}.`);
    }
    if (!ALLOWED_OPERATORS.includes(filter.operator as (typeof ALLOWED_OPERATORS)[number])) {
      throw new Error(`Operator '${filter.operator}' is not allowed.`);
    }
  }

  if (args.column && !allowed.includes(args.column)) {
    throw new Error(`Column '${args.column}' is not allowed on ${table}. Allowed: ${allowed.join(', ')}`);
  }

  const limit = Math.min(Math.max(Number(args.limit) || 12, 1), 25);

  if (operation === 'count') {
    let query = supabase.from(table).select(args.column || 'id', { count: 'exact', head: true });
    query = applyFilters(query, filters);
    const { count, error } = await query;
    if (error) throw error;
    return `${count ?? 0} rows in ${table}${filters.length ? ' matching filters' : ''}.`;
  }

  if (['avg', 'sum', 'min', 'max', 'distinct'].includes(operation)) {
    if (!args.column) throw new Error(`Column is required for ${operation}.`);
    const { data, error } = await supabase.rpc('execute_aggregate_query', {
      p_table: table,
      p_operation: operation,
      p_column: args.column,
      p_filters: filters,
      p_group_by: null,
    });
    if (error) throw error;
    return `${operation} ${args.column} on ${table}: ${data?.result ?? JSON.stringify(data)}`;
  }

  const selectColumns = args.column ? [args.column] : allowed.slice(0, 18);
  const joinedSelect =
    table === 'meetings' && !args.column
      ? 'id, meeting_date, meeting_time, status, meeting_brief, meeting_summary_notes, meeting_location, client_id, legacy_lead_id, lead:leads!client_id(id, name, lead_number, topic), legacy_lead:leads_lead!legacy_lead_id(id, name, lead_number, category)'
      : table === 'contracts' && !args.column
        ? 'id, client_id, legacy_id, contact_id, status, signed_at, total_amount, created_at, lead:leads!client_id(id, name, lead_number, topic, date_signed), legacy_lead:leads_lead!legacy_id(id, name, lead_number, category)'
        : table === 'leads_leadstage' && !args.column
          ? 'id, lead_id, newlead_id, stage, date, cdate, creator_id, lead:leads!newlead_id(id, name, lead_number, topic, date_signed), legacy_lead:leads_lead!lead_id(id, name, lead_number, category)'
          : selectColumns.join(',');
  let query = supabase.from(table).select(joinedSelect);
  query = applyFilters(query, filters);
  if (table === 'meetings' && !args.column) {
    query = query.order('meeting_time', { ascending: true });
  }
  if ((table === 'contracts' || table === 'leads_leadstage') && !args.column) {
    query = query.order(table === 'contracts' ? 'signed_at' : 'date', { ascending: false });
  }
  let { data, error } = await query.limit(
    table === 'meetings' || table === 'contracts' || table === 'leads_leadstage'
      ? Math.max(limit, 60)
      : limit,
  );
  if (error && (table === 'contracts' || table === 'leads_leadstage')) {
    query = supabase.from(table).select(selectColumns.join(','));
    query = applyFilters(query, filters);
    const fallback = await query.limit(Math.max(limit, 60));
    data = fallback.data;
    error = fallback.error;
  }
  if (error) throw error;
  if (!data?.length) return `No ${table} rows matched.`;

  const lines = data.map((row: Record<string, unknown>, index: number) => {
    const stage = row.stage != null ? getStageName(String(row.stage)) || row.stage : null;
    const formatted = { ...row, ...(stage ? { stage } : {}) };
    return `${index + 1}. ${Object.entries(formatted)
      .map(([key, value]) => `${key}: ${clip(value, 80)}`)
      .join(' | ')}`;
  });
  return `Found ${data.length} ${table} row(s):\n${lines.join('\n')}`;
}

type MeetingListRow = {
  time: string;
  name: string;
  leadNumber: string;
  location?: string;
  joinUrl?: string;
  source: 'meetings' | 'leads_lead' | 'leads';
  status?: string;
  stage?: string;
  category?: string;
  topic?: string;
  totalValue?: string;
  meetingAmount?: number | string | null;
  meetingCurrency?: string | null;
  key: string;
  meetingId?: number;
  newLeadId?: string;
  legacyLeadId?: string;
  scheduler: string;
  schedulerId: string;
  managerRaw?: unknown;
  helperRaw?: unknown;
  extern1?: unknown;
  extern2?: unknown;
  managerName: string;
  helperName: string;
  guestNames: string[];
  participantNames: string[];
  myRoles: string[];
};

function meetingDayFilter(dateStr: string) {
  const next = addIsoDays(dateStr, 1);
  return { dateStr, next };
}

async function loadSchedulerMaps(
  newIds: string[],
  legacyIds: number[],
  employees: EmployeeHit[],
): Promise<{
  newMap: Map<string, { name: string; id: string }>;
  legacyMap: Map<string, { name: string; id: string }>;
}> {
  const newMap = new Map<string, { name: string; id: string }>();
  const legacyMap = new Map<string, { name: string; id: string }>();
  if (newIds.length) {
    const leads = await fetchRowsInChunks(newIds, async (chunk) => {
      const { data, error } = await supabase.from('leads').select('id, scheduler').in('id', chunk);
      if (error) return [];
      return data || [];
    });
    for (const lead of leads) {
      newMap.set(String(lead.id), resolveCloserLabel(lead.scheduler, lead.scheduler, employees));
    }
  }
  if (legacyIds.length) {
    const leads = await fetchRowsInChunks(legacyIds, async (chunk) => {
      const { data, error } = await supabase
        .from('leads_lead')
        .select(
          'id, meeting_scheduler_id, scheduler_employee:tenants_employee!fk_leads_lead_meeting_scheduler_id(id, display_name)',
        )
        .in('id', chunk);
      if (error) {
        const fallback = await supabase.from('leads_lead').select('id, meeting_scheduler_id').in('id', chunk);
        return fallback.data || [];
      }
      return data || [];
    });
    for (const lead of leads) {
      legacyMap.set(
        String(lead.id),
        resolveCloserLabel(
          lead.meeting_scheduler_id,
          lead.meeting_scheduler_id,
          employees,
          joinedEmployeeName(lead.scheduler_employee),
        ),
      );
    }
  }
  return { newMap, legacyMap };
}

type MeetingLeadExtra = {
  category: string;
  topic: string;
  stage?: string | null;
  balance?: number | string | null;
  balanceCurrency?: string | null;
  proposalTotal?: number | string | null;
  proposalCurrency?: string | null;
  total?: number | string | null;
  currencyId?: number | null;
};

async function loadMeetingLeadExtras(
  newIds: string[],
  legacyIds: number[],
): Promise<{ newMap: Map<string, MeetingLeadExtra>; legacyMap: Map<string, MeetingLeadExtra> }> {
  const newMap = new Map<string, MeetingLeadExtra>();
  const legacyMap = new Map<string, MeetingLeadExtra>();
  const categories = await ensureLeadCategories().catch(() => []);
  const categoryLabel = (lead: Record<string, unknown>) =>
    resolveLeadCategoryName(lead, categories) || '';

  if (newIds.length) {
    const leads = await fetchRowsInChunks(newIds, async (chunk) => {
      const joined = await supabase
        .from('leads')
        .select(
          'id, category, category_id, topic, stage, balance, balance_currency, proposal_total, proposal_currency, misc_category!fk_leads_category_id ( id, name, parent_id, misc_maincategory!parent_id ( id, name ) )',
        )
        .in('id', chunk);
      if (!joined.error) return joined.data || [];
      const fallback = await supabase
        .from('leads')
        .select('id, category, category_id, topic, stage, balance, balance_currency, proposal_total, proposal_currency')
        .in('id', chunk);
      return fallback.data || [];
    });
    for (const lead of leads) {
      newMap.set(String(lead.id), {
        category: categoryLabel(lead),
        topic: String(lead.topic || '').trim(),
        stage: lead.stage != null ? String(lead.stage) : null,
        balance: lead.balance,
        balanceCurrency: lead.balance_currency,
        proposalTotal: lead.proposal_total,
        proposalCurrency: lead.proposal_currency,
      });
    }
  }
  if (legacyIds.length) {
    const leads = await fetchRowsInChunks(legacyIds, async (chunk) => {
      const joined = await supabase
        .from('leads_lead')
        .select(
          'id, category, category_id, stage, total, currency_id, misc_category!leads_lead_category_id_fkey ( id, name, parent_id, misc_maincategory!parent_id ( id, name ) )',
        )
        .in('id', chunk);
      if (!joined.error) return joined.data || [];
      const fallback = await supabase
        .from('leads_lead')
        .select('id, category, category_id, stage, total, currency_id')
        .in('id', chunk);
      return fallback.data || [];
    });
    for (const lead of leads) {
      const category = categoryLabel(lead);
      legacyMap.set(String(lead.id), {
        category,
        topic: String(lead.topic || category).trim(),
        stage: lead.stage != null ? String(lead.stage) : null,
        total: lead.total,
        currencyId: lead.currency_id != null ? Number(lead.currency_id) : null,
      });
    }
  }
  return { newMap, legacyMap };
}

function isAssignedMeetingRole(value: unknown): boolean {
  if (value == null) return false;
  const text = String(value).trim();
  return Boolean(text) && text !== '---' && text !== '--' && text !== 'N/A' && !/^not[_ ]assigned$/i.test(text);
}

function userMatchesMeetingRole(
  value: unknown,
  employeeId: number | null,
  displayName: string | null,
): boolean {
  if (!isAssignedMeetingRole(value)) return false;
  const text = String(value).trim();
  if (employeeId != null && /^\d+$/.test(text) && Number(text) === Number(employeeId)) return true;
  if (displayName && text.toLowerCase() === displayName.trim().toLowerCase()) return true;
  return false;
}

async function resolveLoggedInEmployee(): Promise<{ employeeId: number | null; displayName: string | null }> {
  const { data: sessionData } = await supabase.auth.getUser();
  const authId = sessionData.user?.id;
  const email = sessionData.user?.email || '';
  if (!authId && !email) return { employeeId: null, displayName: null };
  let data: { employee_id?: unknown; tenants_employee?: unknown } | null = null;
  if (authId) {
    const byAuth = await supabase
      .from('users')
      .select('employee_id, tenants_employee!employee_id(id, display_name)')
      .eq('auth_id', authId)
      .maybeSingle();
    data = byAuth.data;
  }
  if (!data?.employee_id && email) {
    const byEmail = await supabase
      .from('users')
      .select('employee_id, tenants_employee!employee_id(id, display_name)')
      .eq('email', email)
      .maybeSingle();
    data = byEmail.data;
  }
  const employee = Array.isArray(data?.tenants_employee) ? data?.tenants_employee[0] : data?.tenants_employee;
  return {
    employeeId: data?.employee_id != null ? Number(data.employee_id) : null,
    displayName: (employee as { display_name?: string } | null)?.display_name
      ? String((employee as { display_name?: string }).display_name).trim()
      : null,
  };
}

async function loadLeadMeetingRoleMaps(
  newIds: string[],
  legacyIds: number[],
  employees: EmployeeHit[],
): Promise<{
  newMap: Map<string, { manager: { name: string; id: string }; helper: { name: string; id: string } }>;
  legacyMap: Map<string, { manager: { name: string; id: string }; helper: { name: string; id: string } }>;
}> {
  const newMap = new Map<string, { manager: { name: string; id: string }; helper: { name: string; id: string } }>();
  const legacyMap = new Map<string, { manager: { name: string; id: string }; helper: { name: string; id: string } }>();
  if (newIds.length) {
    const leads = await fetchRowsInChunks(newIds, async (chunk) => {
      const { data, error } = await supabase.from('leads').select('id, manager, helper').in('id', chunk);
      if (error) return [];
      return data || [];
    });
    for (const lead of leads) {
      newMap.set(String(lead.id), {
        manager: resolveCloserLabel(lead.manager, lead.manager, employees),
        helper: resolveCloserLabel(lead.helper, lead.helper, employees),
      });
    }
  }
  if (legacyIds.length) {
    const leads = await fetchRowsInChunks(legacyIds, async (chunk) => {
      const { data, error } = await supabase
        .from('leads_lead')
        .select(
          'id, meeting_manager_id, meeting_lawyer_id, manager_employee:tenants_employee!fk_leads_lead_meeting_manager_id(id, display_name), helper_employee:tenants_employee!fk_leads_lead_meeting_lawyer_id(id, display_name)',
        )
        .in('id', chunk);
      if (error) {
        const fallback = await supabase
          .from('leads_lead')
          .select('id, meeting_manager_id, meeting_lawyer_id')
          .in('id', chunk);
        return fallback.data || [];
      }
      return data || [];
    });
    for (const lead of leads) {
      legacyMap.set(String(lead.id), {
        manager: resolveCloserLabel(
          lead.meeting_manager_id,
          lead.meeting_manager_id,
          employees,
          joinedEmployeeName(lead.manager_employee),
        ),
        helper: resolveCloserLabel(
          lead.meeting_lawyer_id,
          lead.meeting_lawyer_id,
          employees,
          joinedEmployeeName(lead.helper_employee),
        ),
      });
    }
  }
  return { newMap, legacyMap };
}

function uniqueRoleNames(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const value of values) {
    const name = roleDisplayName(value || '');
    if (!name || name === '—') continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

function splitPersonNames(value: string): string[] {
  return String(value || '')
    .split(/,|\band\b/i)
    .map((part) => part.replace(/\+\d+\s+more/i, '').replace(/[.,;]+$/g, '').trim())
    .filter((part) => part && part !== '—' && !/^\+\d+/.test(part));
}

function uniqueParticipantNames(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const value of values) {
    for (const name of splitPersonNames(roleDisplayName(value || ''))) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }
  }
  return names;
}

async function loadParticipantNamesByMeeting(
  meetingIds: number[],
  employees: EmployeeHit[],
): Promise<Map<number, string[]>> {
  const map = new Map<number, string[]>();
  if (!meetingIds.length) return map;
  const rows = await fetchRowsInChunks(meetingIds, async (chunk) => {
    const { data, error } = await supabase
      .from('meeting_participants')
      .select('meeting_id, employee_id, firm_contact_id, free_name')
      .in('meeting_id', chunk);
    if (error) return [];
    return data || [];
  });
  const firmIds = Array.from(
    new Set(rows.map((row: { firm_contact_id?: unknown }) => row.firm_contact_id).filter(Boolean).map(String)),
  );
  const firmNames = new Map<string, string>();
  if (firmIds.length) {
    const { data } = await supabase.from('firm_contacts').select('id, name').in('id', firmIds);
    for (const row of data || []) {
      const name = String((row as { name?: unknown }).name || '').trim();
      if (name) firmNames.set(String((row as { id?: unknown }).id), name);
    }
  }
  for (const row of rows as Array<{
    meeting_id?: unknown;
    employee_id?: unknown;
    firm_contact_id?: unknown;
    free_name?: unknown;
  }>) {
    const id = Number(row.meeting_id);
    if (!Number.isFinite(id)) continue;
    let name = '';
    if (row.employee_id != null) {
      name = roleDisplayName(resolveCloserLabel(row.employee_id, row.employee_id, employees).name);
    } else if (row.firm_contact_id) {
      name = firmNames.get(String(row.firm_contact_id)) || '';
    } else {
      name = String(row.free_name || '').trim();
    }
    if (!name || name === '—') continue;
    const list = map.get(id) || [];
    if (!list.some((existing) => existing.toLowerCase() === name.toLowerCase())) list.push(name);
    map.set(id, list);
  }
  return map;
}

async function executeListMeetings(args: {
  date?: string;
  scheduler?: string;
  query?: string;
  scope?: string;
}): Promise<string> {
  const dateStr = normalizeCrmDateValue(args.date || 'today');
  const { next } = meetingDayFilter(dateStr);
  const schedulerArg = String(args.scheduler || '').trim();
  const queryArg = String(args.query || '').trim();
  const mine = String(args.scope || '').trim().toLowerCase() === 'mine';
  const rows: MeetingListRow[] = [];
  const me = mine ? await resolveLoggedInEmployee() : { employeeId: null, displayName: null };
  if (mine && me.employeeId == null && !me.displayName) {
    return 'Could not resolve the logged-in employee, so I cannot filter your meetings. Try again after signing in.';
  }

  const meetingsSelect =
    'id, meeting_date, meeting_time, status, meeting_brief, meeting_location, meeting_amount, meeting_currency, teams_meeting_url, custom_link, client_id, legacy_lead_id, meeting_manager, helper, extern1, extern2, lead:leads!meetings_client_id_fkey(id, name, lead_number, manual_id, topic, category, stage, manager, helper), legacy_lead:leads_lead!meetings_legacy_lead_id_fkey(id, name, lead_number, manual_id, category, stage, meeting_manager_id, meeting_lawyer_id)';
  let meetingsRes = await supabase
    .from('meetings')
    .select(meetingsSelect)
    .gte('meeting_date', dateStr)
    .lt('meeting_date', next)
    .order('meeting_time', { ascending: true })
    .limit(120);

  if (meetingsRes.error) {
    meetingsRes = await supabase
      .from('meetings')
      .select(
        'id, meeting_date, meeting_time, status, meeting_brief, meeting_location, meeting_amount, meeting_currency, teams_meeting_url, client_id, legacy_lead_id, meeting_manager, helper, extern1, extern2, lead:leads!client_id(id, name, lead_number, manual_id, topic, category, stage, manager, helper), legacy_lead:leads_lead!legacy_lead_id(id, name, lead_number, manual_id, category, stage, meeting_manager_id, meeting_lawyer_id)',
      )
      .gte('meeting_date', dateStr)
      .lt('meeting_date', next)
      .order('meeting_time', { ascending: true })
      .limit(120);
  }

  if (meetingsRes.error) {
    meetingsRes = await supabase
      .from('meetings')
      .select(
        'id, meeting_date, meeting_time, status, meeting_brief, meeting_location, meeting_amount, meeting_currency, teams_meeting_url, client_id, legacy_lead_id, meeting_manager, helper, extern1, extern2',
      )
      .gte('meeting_date', dateStr)
      .lt('meeting_date', next)
      .order('meeting_time', { ascending: true })
      .limit(120);
  }

  const meetings = (meetingsRes.data || []).filter((meeting: any) => {
    const status = String(meeting.status || '').toLowerCase();
    return status !== 'canceled' && status !== 'cancelled';
  });
  const meetingLeadMaps = await lookupLeadsByIds(
    meetings.map((meeting: any) => meeting.client_id),
    meetings.map((meeting: any) => meeting.legacy_lead_id),
  );
  const legacyIdsInMeetings = new Set<string>();

  for (const meeting of meetings as any[]) {
    if (meeting.legacy_lead_id) legacyIdsInMeetings.add(String(meeting.legacy_lead_id));
    const { lead } = resolveMeetingLead({ ...meeting, maps: meetingLeadMaps });
    const name =
      leadDisplayName(lead) ||
      String(meeting.meeting_brief || '').trim() ||
      (meeting.client_id || meeting.legacy_lead_id ? 'Lead' : 'Internal meeting');
    const leadNumber = clickableLeadNumber(lead);
    rows.push({
      key: `meetings:${meeting.id}`,
      time: String(meeting.meeting_time || '').slice(0, 5) || '—',
      name,
      leadNumber,
      location: String(meeting.meeting_location || '').trim(),
      joinUrl:
        getValidTeamsLink(meeting.teams_meeting_url) ||
        getValidTeamsLink(meeting.custom_link) ||
        '',
      source: 'meetings',
      status: meeting.status || '',
      category: String((lead as { category?: unknown } | null)?.category || ''),
      stage: (lead as { stage?: unknown } | null)?.stage != null
        ? String((lead as { stage?: unknown }).stage)
        : undefined,
      topic: String((lead as { topic?: unknown; category?: unknown } | null)?.topic || (lead as { category?: unknown } | null)?.category || ''),
      meetingAmount: meeting.meeting_amount,
      meetingCurrency: meeting.meeting_currency,
      meetingId: Number.isFinite(Number(meeting.id)) ? Number(meeting.id) : undefined,
      newLeadId: meeting.client_id ? String(meeting.client_id) : lead?.id && !meeting.legacy_lead_id ? String(lead.id) : undefined,
      legacyLeadId: meeting.legacy_lead_id
        ? String(meeting.legacy_lead_id)
        : undefined,
      scheduler: '',
      schedulerId: '',
      managerRaw: meeting.meeting_manager ?? (lead as { manager?: unknown; meeting_manager_id?: unknown } | null)?.manager ?? (lead as { meeting_manager_id?: unknown } | null)?.meeting_manager_id,
      helperRaw: meeting.helper ?? (lead as { helper?: unknown; meeting_lawyer_id?: unknown } | null)?.helper ?? (lead as { meeting_lawyer_id?: unknown } | null)?.meeting_lawyer_id,
      extern1: meeting.extern1,
      extern2: meeting.extern2,
      managerName: '',
      helperName: '',
      guestNames: [],
      participantNames: [],
      myRoles: [],
    });
  }

  const legacyRes = await supabase
    .from('leads_lead')
    .select('id, name, lead_number, meeting_date, meeting_time, category, status, stage')
    .gte('meeting_date', dateStr)
    .lt('meeting_date', next)
    .not('meeting_date', 'is', null)
    .not('name', 'is', null)
    .limit(200);

  for (const lead of (legacyRes.data || []) as any[]) {
    if (legacyIdsInMeetings.has(String(lead.id))) continue;
    if (lead.status === 10 || lead.status === '10' || lead.stage === 91 || lead.stage === '91') continue;
    rows.push({
      key: `leads_lead:${lead.id}`,
      time: String(lead.meeting_time || '').slice(0, 5) || '—',
      name: leadDisplayName(lead) || 'Lead',
      leadNumber: clickableLeadNumber(lead),
      source: 'leads_lead',
      category: String(lead.category || ''),
      stage: lead.stage != null ? String(lead.stage) : undefined,
      legacyLeadId: String(lead.id),
      scheduler: '',
      schedulerId: '',
      managerName: '',
      helperName: '',
      guestNames: [],
      participantNames: [],
      myRoles: [],
    });
  }

  const newLeadRes = await supabase
    .from('leads')
    .select('id, name, lead_number, meeting_date, meeting_time, topic, stage')
    .gte('meeting_date', dateStr)
    .lt('meeting_date', next)
    .not('meeting_date', 'is', null)
    .limit(80);

  const meetingClientIds = new Set(
    meetings.map((m: any) => (m.client_id != null ? String(m.client_id) : '')).filter(Boolean),
  );
  for (const lead of (newLeadRes.data || []) as any[]) {
    if (meetingClientIds.has(String(lead.id))) continue;
    rows.push({
      key: `leads:${lead.id}`,
      time: String(lead.meeting_time || '').slice(0, 5) || '—',
      name: leadDisplayName(lead) || 'Lead',
      leadNumber: clickableLeadNumber(lead),
      source: 'leads',
      category: String(lead.topic || ''),
      stage: lead.stage != null ? String(lead.stage) : undefined,
      newLeadId: String(lead.id),
      scheduler: '',
      schedulerId: '',
      managerName: '',
      helperName: '',
      guestNames: [],
      participantNames: [],
      myRoles: [],
    });
  }

  const employees = await loadCloserEmployees();
  let schedulerFilter = schedulerArg;
  let nameFilter = queryArg.toLowerCase();
  let queryUsedAsScheduler = false;
  if (!schedulerFilter && queryArg && !looksLikeLeadNumber(queryArg)) {
    const employeeHits = matchEmployees(employees, queryArg);
    if (employeeHits.length) {
      schedulerFilter = queryArg;
      nameFilter = '';
      queryUsedAsScheduler = true;
    }
  }
  const schedulerHits = schedulerFilter ? matchEmployees(employees, schedulerFilter) : [];

  const newIds = Array.from(new Set(rows.map((row) => row.newLeadId).filter((id): id is string => Boolean(id))));
  const legacyIds = Array.from(
    new Set(
      rows
        .map((row) => Number(row.legacyLeadId))
        .filter((id) => Number.isFinite(id)),
    ),
  );
  const [schedulerMaps, roleMaps, extraMaps] = await Promise.all([
    loadSchedulerMaps(newIds, legacyIds, employees),
    loadLeadMeetingRoleMaps(newIds, legacyIds, employees),
    loadMeetingLeadExtras(newIds, legacyIds),
  ]);
  const meetingIds = Array.from(
    new Set(rows.map((row) => row.meetingId).filter((id): id is number => Number.isFinite(id))),
  );
  const participantNames = await loadParticipantNamesByMeeting(meetingIds, employees);
  for (const row of rows) {
    const resolved = row.newLeadId
      ? schedulerMaps.newMap.get(row.newLeadId)
      : row.legacyLeadId
        ? schedulerMaps.legacyMap.get(row.legacyLeadId)
        : undefined;
    row.scheduler = resolved?.name || '';
    row.schedulerId = resolved?.id || '';
    const leadRoles = row.newLeadId
      ? roleMaps.newMap.get(row.newLeadId)
      : row.legacyLeadId
        ? roleMaps.legacyMap.get(row.legacyLeadId)
        : undefined;
    const manager = resolveCloserLabel(row.managerRaw, row.managerRaw, employees, leadRoles?.manager.name);
    const helper = resolveCloserLabel(row.helperRaw, row.helperRaw, employees, leadRoles?.helper.name);
    row.managerName = roleDisplayName(manager.name || leadRoles?.manager.name || '');
    row.helperName = roleDisplayName(helper.name || leadRoles?.helper.name || '');
    row.guestNames = uniqueRoleNames([
      resolveCloserLabel(row.extern1, row.extern1, employees).name,
      resolveCloserLabel(row.extern2, row.extern2, employees).name,
    ]);
    const taken = new Set(
      [row.managerName, row.helperName, ...row.guestNames].map((name) => name.toLowerCase()).filter((name) => name && name !== '—'),
    );
    row.participantNames = (row.meetingId != null ? participantNames.get(row.meetingId) || [] : []).filter(
      (name) => !taken.has(name.toLowerCase()),
    );
  }

  if (mine) {
    const meetingIds = Array.from(
      new Set(rows.map((row) => row.meetingId).filter((id): id is number => Number.isFinite(id))),
    );
    const participantMeetingIds = new Set<number>();
    if (meetingIds.length && me.employeeId != null) {
      const participantRows = await fetchRowsInChunks(meetingIds, async (chunk) => {
        const { data, error } = await supabase
          .from('meeting_participants')
          .select('meeting_id, employee_id')
          .in('meeting_id', chunk)
          .eq('employee_id', me.employeeId);
        if (error) return [];
        return data || [];
      });
      for (const part of participantRows) {
        const id = Number(part.meeting_id);
        if (Number.isFinite(id)) participantMeetingIds.add(id);
      }
    }
    for (const row of rows) {
      const leadRoles = row.newLeadId
        ? roleMaps?.newMap.get(row.newLeadId)
        : row.legacyLeadId
          ? roleMaps?.legacyMap.get(row.legacyLeadId)
          : undefined;
      const roles: string[] = [];
      if (
        userMatchesMeetingRole(row.managerRaw, me.employeeId, me.displayName) ||
        userMatchesMeetingRole(leadRoles?.manager.id, me.employeeId, me.displayName) ||
        userMatchesMeetingRole(leadRoles?.manager.name, me.employeeId, me.displayName)
      ) {
        roles.push('meeting manager');
      }
      if (
        userMatchesMeetingRole(row.helperRaw, me.employeeId, me.displayName) ||
        userMatchesMeetingRole(leadRoles?.helper.id, me.employeeId, me.displayName) ||
        userMatchesMeetingRole(leadRoles?.helper.name, me.employeeId, me.displayName)
      ) {
        roles.push('helper');
      }
      if (
        userMatchesMeetingRole(row.extern1, me.employeeId, me.displayName) ||
        userMatchesMeetingRole(row.extern2, me.employeeId, me.displayName)
      ) {
        roles.push('guest');
      }
      if (row.meetingId != null && participantMeetingIds.has(row.meetingId)) {
        roles.push('participant');
      }
      row.myRoles = roles;
    }
  }

  let filtered = schedulerFilter
    ? rows.filter((row) => roleRowMatches(row.scheduler, row.schedulerId, schedulerHits, schedulerFilter))
    : rows;
  if (mine) {
    filtered = filtered.filter((row) => row.myRoles.length > 0);
  }
  if (nameFilter) {
    filtered = filtered.filter(
      (row) =>
        row.name.toLowerCase().includes(nameFilter) ||
        row.leadNumber.toLowerCase().includes(nameFilter),
    );
  }

  filtered.sort((a, b) => String(a.time).localeCompare(String(b.time)) || a.name.localeCompare(b.name));

  if (!filtered.length) {
    if (mine && rows.length) {
      const who = me.displayName || `employee ${me.employeeId}`;
      return `No meetings on ${dateStr} (Asia/Jerusalem) where ${who} is meeting manager, helper, guest, or a participant. ${rows.length} meeting(s) that day, but none have those roles for you.`;
    }
    if (schedulerFilter && rows.length) {
      const matched = formatMatchedEmployeeLabel(schedulerFilter, schedulerHits);
      return [
        `No meetings with scheduler matching "${schedulerFilter}" on ${dateStr} (Asia/Jerusalem).`,
        `${rows.length} meeting(s) that day, but none have that scheduler role.`,
        schedulerHits.length ? `Matched scheduler employees: ${matched}.` : 'No matching scheduler found in tenants_employee; also checked the lead scheduler field.',
        queryUsedAsScheduler ? 'Interpreted the name as the lead scheduler, not the client.' : '',
      ]
        .filter(Boolean)
        .join(' ');
    }
    const meetingErr = meetingsRes.error ? ` meetings_error=${meetingsRes.error.message}` : '';
    const legacyErr = legacyRes.error ? ` leads_lead_error=${legacyRes.error.message}` : '';
    return `No meetings found on ${dateStr} (Asia/Jerusalem). Checked meetings, leads_lead.meeting_date, and leads.meeting_date.${meetingErr}${legacyErr}`;
  }

  const schedulerLabel = schedulerFilter
    ? formatMatchedEmployeeLabel(schedulerFilter, schedulerHits)
    : '';
  const cleanRole = (value?: string) => {
    const text = String(value || '').trim();
    return text && text !== '—' ? text : null;
  };

  return JSON.stringify({
    kind: 'calendar_day',
    date: dateStr,
    scope: mine ? 'mine' : 'all',
    count: filtered.length,
    scheduler: schedulerLabel || null,
    meetings: filtered.slice(0, 80).map((row) => {
      const extra = row.newLeadId
        ? extraMaps.newMap.get(row.newLeadId)
        : row.legacyLeadId
          ? extraMaps.legacyMap.get(row.legacyLeadId)
          : undefined;
      const rawCategory = extra?.category || row.category || '';
      const category = /^\d+$/.test(rawCategory) ? '' : rawCategory;
      const topic = extra?.topic || row.topic || category;
      const value = formatMeetingValue({
        leadBalance: extra?.balance ?? extra?.proposalTotal,
        leadBalanceCurrency: extra?.balanceCurrency || extra?.proposalCurrency,
        legacyTotal: extra?.total,
        legacyCurrencyId: extra?.currencyId,
        meetingAmount: row.meetingAmount,
        meetingCurrency: row.meetingCurrency,
      });
      const internal = !row.newLeadId && !row.legacyLeadId;
      return {
        time: row.time,
        leadNumber: row.leadNumber || null,
        name: row.name,
        location: String(row.location || '').trim() || null,
        joinUrl: String(row.joinUrl || '').trim() || null,
        manager: cleanRole(row.managerName),
        helper: cleanRole(row.helperName),
        category: category || null,
        topic: topic || null,
        totalValue: value.amount ? value.display : null,
        scheduler: cleanRole(row.scheduler),
        stage: extra?.stage || row.stage || null,
        internal,
        participants: internal
          ? uniqueParticipantNames([
              ...row.participantNames,
              ...row.guestNames,
              row.managerName,
              row.helperName,
            ])
          : [],
      };
    }),
  });
}

function lastDayOfMonth(year: number, month1to12: number): string {
  return new Date(Date.UTC(year, month1to12, 0)).toISOString().slice(0, 10);
}

function startOfJerusalemWeek(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return addIsoDays(iso, -dow);
}

function resolveSignedDateRange(args: {
  date?: string;
  date_from?: string;
  date_to?: string;
  period?: string;
}): { from: string; to: string; label: string } {
  const today = jerusalemTodayIso();
  const fromArg = String(args.date_from || '').trim();
  const toArg = String(args.date_to || '').trim();
  if (fromArg || toArg) {
    const from = normalizeCrmDateValue(fromArg || toArg || 'today');
    const to = normalizeCrmDateValue(toArg || fromArg || 'today');
    return { from, to, label: from === to ? from : `${from} to ${to}` };
  }

  const raw = String(args.period || args.date || 'today').trim();
  const lower = raw.toLowerCase();
  if (lower === 'today') return { from: today, to: today, label: today };
  if (lower === 'yesterday') {
    const yesterday = addIsoDays(today, -1);
    return { from: yesterday, to: yesterday, label: yesterday };
  }
  if (lower === 'this week') {
    const from = startOfJerusalemWeek(today);
    return { from, to: today, label: `${from} to ${today}` };
  }
  if (lower === 'last week') {
    const thisStart = startOfJerusalemWeek(today);
    const from = addIsoDays(thisStart, -7);
    const to = addIsoDays(thisStart, -1);
    return { from, to, label: `${from} to ${to}` };
  }
  if (lower === 'this month') {
    const [year, month] = today.split('-');
    const from = `${year}-${month}-01`;
    return { from, to: today, label: `${from} to ${today}` };
  }
  if (lower === 'last month') {
    const [yearNum, monthNum] = today.split('-').map(Number);
    const year = monthNum === 1 ? yearNum - 1 : yearNum;
    const month = monthNum === 1 ? 12 : monthNum - 1;
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const to = lastDayOfMonth(year, month);
    return { from, to, label: `${from} to ${to}` };
  }
  if (lower === 'this year' || lower === 'ytd' || lower === 'year to date') {
    const from = `${today.slice(0, 4)}-01-01`;
    return { from, to: today, label: `${from} to ${today}` };
  }
  if (lower === 'last year') {
    const y = Number(today.slice(0, 4)) - 1;
    return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y) };
  }
  if (lower === 'last 7 days' || lower === 'past 7 days') {
    const from = addIsoDays(today, -6);
    return { from, to: today, label: `${from} to ${today}` };
  }
  if (lower === 'last 30 days' || lower === 'past 30 days') {
    const from = addIsoDays(today, -29);
    return { from, to: today, label: `${from} to ${today}` };
  }

  const day = normalizeCrmDateValue(raw);
  return { from: day, to: day, label: day };
}

async function fetchRowsInChunks<T>(
  ids: T[],
  load: (chunk: T[]) => Promise<any[]>,
  chunkSize = 120,
): Promise<any[]> {
  const rows: any[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    rows.push(...(await load(ids.slice(i, i + chunkSize))));
  }
  return rows;
}

function parseMoney(value: unknown): number {
  const n = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(amount: number, currency?: string): string {
  const code = String(currency || '').trim();
  const formatted = Math.round(amount).toLocaleString('en-US');
  return code ? `${code} ${formatted}` : formatted;
}

type SignedContractRow = {
  key: string;
  leadType: 'new' | 'legacy';
  leadNumber: string;
  name: string;
  signDate: string;
  stage: string;
  amount: number;
  currency: string;
  contractStatus: string;
  closer: string;
  closerId: string;
};

type EmployeeHit = { id: string; name: string };

function looksLikeLeadNumber(value: string): boolean {
  return /^(l|c)?\d{3,}(\/\d+)?$/i.test(String(value || '').trim());
}

function normalizePersonName(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0590-\u05ff]+/g, ' ')
    .trim();
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  const aLen = a.length;
  const bLen = b.length;
  if (!aLen) return bLen;
  if (!bLen) return aLen;
  const row = Array.from({ length: bLen + 1 }, (_, index) => index);
  for (let i = 1; i <= aLen; i += 1) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= bLen; j += 1) {
      const current = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = current;
    }
  }
  return row[bLen];
}

function phoneticPersonKey(value: string): string {
  return normalizePersonName(value)
    .replace(/ph/g, 'f')
    .replace(/ck/g, 'k')
    .replace(/^(yeh|jeh|joh|yo|jo|io)/, 'y')
    .replace(/h/g, '')
    .replace(/[aeiou]/g, '');
}

function tokenSimilarity(queryToken: string, nameToken: string): number {
  if (!queryToken || !nameToken) return 0;
  if (queryToken === nameToken) return 1;
  if (nameToken.startsWith(queryToken) || queryToken.startsWith(nameToken)) {
    const shorter = Math.min(queryToken.length, nameToken.length);
    const longer = Math.max(queryToken.length, nameToken.length);
    return shorter / longer >= 0.7 ? 0.92 : 0.78;
  }
  if (phoneticPersonKey(queryToken) && phoneticPersonKey(queryToken) === phoneticPersonKey(nameToken)) {
    return 0.9;
  }
  const maxLen = Math.max(queryToken.length, nameToken.length);
  if (maxLen < 3) return 0;
  const distance = levenshteinDistance(queryToken, nameToken);
  const allowed = maxLen <= 5 ? 1 : maxLen <= 8 ? 2 : 3;
  if (distance > allowed) return 0;
  return Math.max(0, 1 - distance / maxLen);
}

function scoreEmployeeName(query: string, candidate: string): number {
  const q = normalizePersonName(query);
  const name = normalizePersonName(candidate);
  if (!q || !name) return 0;
  if (name === q) return 100;
  const queryTokens = q.split(' ').filter(Boolean);
  const nameTokens = name.split(' ').filter(Boolean);
  if (name.startsWith(q) || nameTokens[0] === q) return 95;
  if (q.length >= 3 && nameTokens.some((token) => token.startsWith(q))) return 90;
  if (q.length >= 4 && name.includes(q)) return 84;

  let bestToken = 0;
  for (const queryToken of queryTokens) {
    for (const nameToken of nameTokens) {
      bestToken = Math.max(bestToken, tokenSimilarity(queryToken, nameToken));
    }
  }
  if (bestToken >= 0.72) return Math.round(70 + bestToken * 25);

  const qKey = phoneticPersonKey(q);
  const nKey = phoneticPersonKey(nameTokens[0] || name);
  if (qKey.length >= 3 && qKey === nKey) return 86;
  return 0;
}

function matchEmployees(employees: EmployeeHit[], query: string): EmployeeHit[] {
  const q = normalizePersonName(query);
  if (!q) return [];
  const ranked = employees
    .map((row) => ({ row, score: scoreEmployeeName(q, row.name) }))
    .filter((entry) => entry.score >= 72)
    .sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name));
  if (!ranked.length) return [];
  const topScore = ranked[0].score;
  const cutoff = topScore >= 90 ? topScore - 4 : Math.max(72, topScore - 8);
  const closest = ranked.filter((entry) => entry.score >= cutoff).map((entry) => entry.row);
  if (topScore >= 86) return closest.slice(0, 4);
  return closest.slice(0, 2);
}

function joinedEmployeeName(value: unknown): string {
  const rec = Array.isArray(value) ? value[0] : value;
  return String((rec as { display_name?: string } | null)?.display_name || '').trim();
}

function resolveCloserLabel(
  raw: unknown,
  closerId: unknown,
  employees: EmployeeHit[],
  joinedName?: string,
): { name: string; id: string } {
  const joined = String(joinedName || '').trim();
  const id = closerId != null && String(closerId).trim() !== '' ? String(closerId) : '';
  const rawStr = String(raw ?? '').trim();
  const byId = employees.find((row) => row.id === id || row.id === rawStr);
  if (joined) return { name: joined, id: byId?.id || id || rawStr };
  if (byId) return { name: byId.name, id: byId.id };
  const rawNum = Number(rawStr);
  if (rawStr && Number.isFinite(rawNum) && String(rawNum) === rawStr) {
    const byNum = employees.find((row) => row.id === rawStr || Number(row.id) === rawNum);
    if (byNum) return { name: byNum.name, id: byNum.id };
  }
  const byName = employees.find((row) => normalizePersonName(row.name) === normalizePersonName(rawStr));
  if (byName) return { name: byName.name, id: byName.id };
  return { name: rawStr, id: id || rawStr };
}

function roleRowMatches(roleName: string, roleId: string, hits: EmployeeHit[], rawQuery: string): boolean {
  const q = normalizePersonName(rawQuery);
  const name = normalizePersonName(roleName);
  if (hits.some((hit) => hit.id && (hit.id === roleId || hit.id === roleName))) return true;
  if (hits.some((hit) => scoreEmployeeName(hit.name, roleName) >= 84 || scoreEmployeeName(roleName, hit.name) >= 84)) {
    return name.length > 0;
  }
  if (q && scoreEmployeeName(q, roleName) >= 72) return true;
  return Boolean(q && name && (name === q || name.startsWith(q) || name.split(' ').some((part) => part.startsWith(q))));
}

function closerRowMatches(row: SignedContractRow, hits: EmployeeHit[], rawQuery: string): boolean {
  return roleRowMatches(row.closer, row.closerId, hits, rawQuery);
}

function formatMatchedEmployeeLabel(typed: string, hits: EmployeeHit[]): string {
  const names = hits.map((hit) => hit.name).filter(Boolean);
  if (!names.length) return typed;
  const typedNorm = normalizePersonName(typed);
  const same = names.every((name) => normalizePersonName(name) === typedNorm);
  if (same) return names.join(', ');
  return `${names.join(', ')} (matched from "${typed}")`;
}

async function loadCloserEmployees(): Promise<EmployeeHit[]> {
  const { data, error } = await supabase.from('tenants_employee').select('id, display_name').limit(3000);
  if (error) return [];
  return (data || [])
    .map((row: { id?: unknown; display_name?: unknown }) => ({
      id: String(row.id ?? ''),
      name: String(row.display_name || '').trim(),
    }))
    .filter((row) => row.name);
}

function jerusalemNowClock(): { date: string; minutes: number; time: string } {
  const date = jerusalemTodayIso();
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
  const [hourRaw, minuteRaw] = time.split(':');
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  return { date, minutes: hour * 60 + minute, time };
}

function formatJerusalemClockTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(parsed);
}

function normalizeWorkplaceQuery(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function parseHmToMinutes(value: unknown): number | null {
  const match = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function looksLikeOfficeQuery(value: string): boolean {
  const normalized = normalizeWorkplaceQuery(value);
  return /\b(office|ramat|jerusalem|gan|home|wfh|workplace|clock)\b/.test(normalized);
}

function scoreWorkplaceMatch(query: string, loc: ClockInLocationOption): number {
  const q = normalizeWorkplaceQuery(query);
  if (!q) return 0;
  const name = normalizeWorkplaceQuery(loc.name);
  const slug = normalizeWorkplaceQuery(loc.slug || '');
  if (name === q || slug === q) return 100;
  if (name.includes(q) || q.includes(name)) return 94;
  if (slug && (slug.includes(q) || q.replace(/ /g, ' ') === slug)) return 92;
  if (q.includes('ramat') && (name.includes('ramat') || slug.includes('ramat'))) return 93;
  if (q.includes('jerusalem') && (name.includes('jerusalem') || slug.includes('jerusalem'))) return 93;
  if ((q === 'home' || q === 'wfh' || q.includes('work from home')) && (name === 'home' || slug === 'home')) {
    return 93;
  }
  return 0;
}

function matchClockInLocations(
  locations: ClockInLocationOption[],
  query: string,
): ClockInLocationOption[] {
  const ranked = locations
    .map((loc) => ({ loc, score: scoreWorkplaceMatch(query, loc) }))
    .filter((entry) => entry.score >= 80)
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) return [];
  const top = ranked[0].score;
  return ranked.filter((entry) => entry.score >= top - 4).map((entry) => entry.loc);
}

function workplaceMatchesIds(
  locationId: number | null | undefined,
  officeIds: Set<number>,
): boolean {
  if (!officeIds.size) return true;
  return locationId != null && officeIds.has(locationId);
}

function calendarUnavailabilityNow(
  times: unknown,
  ranges: unknown,
  today: string,
  nowMinutes: number,
): { reason: string; period: string } | null {
  const slots = Array.isArray(times) ? times : [];
  for (const slot of slots) {
    if (!slot || typeof slot !== 'object') continue;
    const row = slot as { date?: string; startTime?: string; endTime?: string; reason?: string };
    if (String(row.date || '') !== today) continue;
    const start = parseHmToMinutes(row.startTime);
    const end = parseHmToMinutes(row.endTime);
    if (start == null || end == null) continue;
    if (nowMinutes >= start && nowMinutes <= end) {
      return {
        reason: String(row.reason || 'Unavailable'),
        period: `${row.startTime}–${row.endTime}`,
      };
    }
  }
  const rangeList = Array.isArray(ranges) ? ranges : [];
  for (const range of rangeList) {
    if (!range || typeof range !== 'object') continue;
    const row = range as { startDate?: string; endDate?: string; reason?: string };
    const startDate = String(row.startDate || '');
    const endDate = String(row.endDate || '');
    if (startDate && endDate && today >= startDate && today <= endDate) {
      return {
        reason: String(row.reason || 'Unavailable'),
        period: startDate === endDate ? startDate : `${startDate}–${endDate}`,
      };
    }
  }
  return null;
}

function leaveOverlapsDay(entry: EmployeeUnavailabilityEntry, day: string): boolean {
  const end = entry.end_date ?? entry.start_date;
  return Boolean(entry.start_date && end && entry.start_date <= day && end >= day);
}

function generalLeaveCoversNow(entry: EmployeeUnavailabilityEntry, nowMinutes: number): boolean {
  if (!isGeneralUnavailability(entry)) return true;
  const start = parseHmToMinutes(entry.start_time);
  const end = parseHmToMinutes(entry.end_time);
  if (start == null || end == null) return true;
  return nowMinutes >= start && nowMinutes <= end;
}

type PresenceClockRow = {
  employee_id: number;
  clock_in_time: string;
  clock_out_time: string | null;
  is_active: boolean;
  clock_in_location_id: number | null;
  clock_out_location_id: number | null;
  clock_in_place?: { name: string } | { name: string }[] | null;
  clock_out_place?: { name: string } | { name: string }[] | null;
};

type PresenceLine = {
  name: string;
  department: string;
  availableHere: boolean;
  clockedIn: boolean;
  clockedInHere: boolean;
  clockedInElsewhere: boolean;
  clockedOutHere: boolean;
  unavailable: boolean;
  summary: string;
  workplace: string;
  clockIn: string;
  clockOut: string;
  unavailability: string;
  status: string;
};

type PresenceReport = {
  error?: string;
  now: { date: string; time: string };
  officeLabel: string;
  officeNames: string[];
  employeeLabel: string;
  visibilityNote: string;
  hasOfficeFilter: boolean;
  hasEmployeeFilter: boolean;
  lines: PresenceLine[];
};

async function collectEmployeePresence(args: {
  office?: string;
  employee?: string;
  query?: string;
}): Promise<PresenceReport> {
  const now = jerusalemNowClock();
  const officeArg = String(args.office || '').trim();
  const employeeArg = String(args.employee || '').trim();
  const queryArg = String(args.query || '').trim();

  let officeFilter = officeArg;
  let employeeFilter = employeeArg;
  if (!officeFilter && !employeeFilter && queryArg) {
    if (looksLikeOfficeQuery(queryArg)) officeFilter = queryArg;
    else employeeFilter = queryArg;
  } else if (!officeFilter && queryArg && looksLikeOfficeQuery(queryArg)) {
    officeFilter = queryArg;
  } else if (!employeeFilter && queryArg && !looksLikeOfficeQuery(queryArg)) {
    employeeFilter = queryArg;
  }

  const [staff, locations] = await Promise.all([
    fetchActiveStaffEmployeesWithDepartment(),
    fetchActiveClockInLocations(),
  ]);

  if (!staff.length) {
    return {
      error: `No active staff employees found. Cannot report who is in the office at ${now.time} Asia/Jerusalem.`,
      now,
      officeLabel: '',
      officeNames: [],
      employeeLabel: '',
      visibilityNote: '',
      hasOfficeFilter: false,
      hasEmployeeFilter: false,
      lines: [],
    };
  }

  const staffHits: EmployeeHit[] = staff.map((row) => ({ id: String(row.id), name: row.display_name }));
  const employeeHits = employeeFilter ? matchEmployees(staffHits, employeeFilter) : [];
  if (employeeFilter && !employeeHits.length) {
    return {
      error: `No staff employee matching "${employeeFilter}". Try a fuller name.`,
      now,
      officeLabel: '',
      officeNames: [],
      employeeLabel: '',
      visibilityNote: '',
      hasOfficeFilter: Boolean(officeFilter),
      hasEmployeeFilter: true,
      lines: [],
    };
  }

  const officeHits = officeFilter ? matchClockInLocations(locations, officeFilter) : [];
  if (officeFilter && !officeHits.length) {
    const known = locations.map((loc) => loc.name).join(', ') || 'Ramat Gan - Office, Jerusalem - Office, Home';
    return {
      error: `No workplace matching "${officeFilter}". Known workplaces: ${known}.`,
      now,
      officeLabel: '',
      officeNames: [],
      employeeLabel: '',
      visibilityNote: '',
      hasOfficeFilter: true,
      hasEmployeeFilter: Boolean(employeeFilter),
      lines: [],
    };
  }
  const officeIds = new Set(officeHits.map((loc) => loc.id));
  const officeLabel = officeHits.length
    ? formatMatchedEmployeeLabel(officeFilter, officeHits.map((loc) => ({ id: String(loc.id), name: loc.name })))
    : '';

  const staffIds = employeeHits.length ? employeeHits.map((hit) => Number(hit.id)) : staff.map((row) => row.id);
  const idSet = new Set(staffIds);
  const startIso = buildJerusalemStartOfDayIso(now.date);
  const endIso = buildJerusalemEndOfDayIso(now.date);
  const clockSelect =
    'employee_id, clock_in_time, clock_out_time, is_active, clock_in_location_id, clock_out_location_id, clock_in_place:clock_in_locations!clock_in_location_id(name), clock_out_place:clock_in_locations!clock_out_location_id(name)';

  const [activeClock, todayOut, leaveResult, calendarResult] = await Promise.all([
    supabase.from('employee_clock_in').select(clockSelect).in('employee_id', staffIds).eq('is_active', true),
    supabase
      .from('employee_clock_in')
      .select(clockSelect)
      .in('employee_id', staffIds)
      .not('clock_out_time', 'is', null)
      .gte('clock_out_time', startIso)
      .lte('clock_out_time', endIso)
      .order('clock_out_time', { ascending: false })
      .limit(2000),
    supabase
      .from('employee_unavailability_reasons')
      .select(UNAVAILABILITY_SELECT)
      .in('employee_id', staffIds)
      .lte('start_date', now.date),
    supabase
      .from('tenants_employee')
      .select('id, unavailable_times, unavailable_ranges')
      .in('id', staffIds),
  ]);

  if (activeClock.error) {
    return {
      error: `Could not load clock-in rows: ${activeClock.error.message}`,
      now,
      officeLabel: '',
      officeNames: officeHits.map((loc) => loc.name),
      employeeLabel: employeeHits.length ? formatMatchedEmployeeLabel(employeeFilter, employeeHits) : '',
      visibilityNote: '',
      hasOfficeFilter: officeIds.size > 0,
      hasEmployeeFilter: employeeHits.length > 0,
      lines: [],
    };
  }

  const activeByEmployee = new Map<number, PresenceClockRow>();
  for (const raw of activeClock.data || []) {
    const row = raw as PresenceClockRow;
    const id = Number(row.employee_id);
    if (!idSet.has(id)) continue;
    const existing = activeByEmployee.get(id);
    if (!existing || String(row.clock_in_time) > String(existing.clock_in_time)) {
      activeByEmployee.set(id, row);
    }
  }

  const outByEmployee = new Map<number, PresenceClockRow>();
  for (const raw of todayOut.data || []) {
    const row = raw as PresenceClockRow;
    const id = Number(row.employee_id);
    if (!idSet.has(id) || activeByEmployee.has(id)) continue;
    const existing = outByEmployee.get(id);
    if (!existing || String(row.clock_out_time || '') > String(existing.clock_out_time || '')) {
      outByEmployee.set(id, row);
    }
  }

  const leaveByEmployee = new Map<number, EmployeeUnavailabilityEntry[]>();
  for (const raw of leaveResult.data || []) {
    const entry = raw as EmployeeUnavailabilityEntry;
    if (!leaveOverlapsDay(entry, now.date)) continue;
    const id = Number(entry.employee_id);
    const list = leaveByEmployee.get(id) ?? [];
    list.push(entry);
    leaveByEmployee.set(id, list);
  }

  const calendarByEmployee = new Map<number, { times: unknown; ranges: unknown }>();
  for (const row of calendarResult.data || []) {
    calendarByEmployee.set(Number(row.id), {
      times: row.unavailable_times,
      ranges: row.unavailable_ranges,
    });
  }

  const lines: PresenceLine[] = [];
  const scopedStaff = employeeHits.length
    ? staff.filter((row) => employeeHits.some((hit) => hit.id === String(row.id)))
    : staff;

  for (const emp of scopedStaff) {
    const calendar = calendarByEmployee.get(emp.id);
    const calBlock = calendarUnavailabilityNow(calendar?.times, calendar?.ranges, now.date, now.minutes);
    const leaves = leaveByEmployee.get(emp.id) ?? [];
    const blockingLeaves = leaves.filter(
      (entry) => isUnavailabilityCounted(entry) && generalLeaveCoversNow(entry, now.minutes),
    );
    const noteLeaves = leaves.filter((entry) => isGeneralUnavailability(entry) && generalLeaveCoversNow(entry, now.minutes));
    const unavailable = Boolean(calBlock) || blockingLeaves.length > 0;
    const unavailBits = [
      ...blockingLeaves.map((entry) => {
        const reason = unavailabilityReasonText(entry);
        const range = unavailabilityGeneralTimeRange(entry);
        return `${unavailabilityTypeLabel(entry.unavailability_type)}${reason && reason !== '—' ? ` (${reason})` : ''}${range ? ` ${range}` : ' all day'}`;
      }),
      calBlock ? `calendar: ${calBlock.reason} ${calBlock.period}` : '',
      ...noteLeaves.map((entry) => {
        const reason = unavailabilityReasonText(entry);
        return reason && reason !== '—' ? `note: ${reason}` : '';
      }),
    ].filter(Boolean);

    const active = activeByEmployee.get(emp.id) ?? null;
    const todayOutRow = outByEmployee.get(emp.id) ?? null;
    const inLocationId = active?.clock_in_location_id ?? null;
    const outLocationId = todayOutRow?.clock_out_location_id ?? todayOutRow?.clock_in_location_id ?? null;
    const inPlace = active
      ? resolveWorkplaceName(active, 'in')
      : todayOutRow
        ? resolveWorkplaceName(todayOutRow, 'in')
        : '—';
    const outPlace = todayOutRow ? resolveWorkplaceName(todayOutRow, 'out') : '—';
    const clockedInHere = Boolean(active && workplaceMatchesIds(inLocationId, officeIds));
    const clockedInElsewhere = Boolean(active && officeIds.size > 0 && !workplaceMatchesIds(inLocationId, officeIds));
    const clockedOutHere = Boolean(!active && todayOutRow && workplaceMatchesIds(outLocationId, officeIds));
    const availableHere = clockedInHere && !unavailable;

    if (officeIds.size && !employeeHits.length && !clockedInHere && !clockedInElsewhere && !clockedOutHere && !unavailable) {
      continue;
    }

    const bits = [
      availableHere ? 'available now' : '',
      active
        ? `clocked in${inPlace !== '—' ? ` at ${inPlace}` : ''} since ${formatJerusalemClockTime(active.clock_in_time)}`
        : '',
      !active && todayOutRow
        ? `clocked out${outPlace !== '—' ? ` of ${outPlace}` : ''} at ${formatJerusalemClockTime(todayOutRow.clock_out_time)}${todayOutRow.clock_in_time ? ` (in ${formatJerusalemClockTime(todayOutRow.clock_in_time)})` : ''}`
        : '',
      !active && !todayOutRow ? 'not clocked in today' : '',
      unavailBits.length ? `unavailable: ${unavailBits.join('; ')}` : '',
    ].filter(Boolean);

    const workplace = active ? inPlace : todayOutRow ? outPlace !== '—' ? outPlace : inPlace : '—';
    const clockIn = active
      ? formatJerusalemClockTime(active.clock_in_time)
      : todayOutRow
        ? formatJerusalemClockTime(todayOutRow.clock_in_time)
        : '';
    const clockOut = active ? '' : formatJerusalemClockTime(todayOutRow?.clock_out_time);
    const unavailability = unavailBits.join('; ');
    const status = availableHere
      ? 'Available'
      : unavailable
        ? 'Unavailable'
        : active
          ? 'Clocked in'
          : todayOutRow
            ? 'Clocked out'
            : 'Not clocked in';

    lines.push({
      name: emp.display_name,
      department: emp.departmentName || '',
      availableHere,
      clockedIn: Boolean(active),
      clockedInHere,
      clockedInElsewhere,
      clockedOutHere,
      unavailable,
      summary: bits.join(' · '),
      workplace: workplace !== '—' ? workplace : '',
      clockIn,
      clockOut: clockOut === '—' ? '' : clockOut,
      unavailability,
      status,
    });
  }

  const visibilityNote =
    !activeClock.data?.length && staffIds.length > 3
      ? 'No active clock-in rows were visible. Superusers see everyone; other accounts may only see their own session.'
      : '';

  return {
    now,
    officeLabel,
    officeNames: officeHits.map((loc) => loc.name),
    employeeLabel: employeeHits.length ? formatMatchedEmployeeLabel(employeeFilter, employeeHits) : '',
    visibilityNote,
    hasOfficeFilter: officeIds.size > 0,
    hasEmployeeFilter: employeeHits.length > 0,
    lines,
  };
}

function formatPresenceLines(rows: PresenceLine[]): string {
  return rows
    .slice(0, 60)
    .map((row, index) => `${index + 1}. ${row.name}${row.department ? ` (${row.department})` : ''} · ${row.summary}`)
    .join('\n');
}

function formatPresenceReport(report: PresenceReport): string {
  if (report.error) return report.error;
  const { now, officeLabel, officeNames, employeeLabel, visibilityNote, hasOfficeFilter, hasEmployeeFilter, lines } =
    report;
  const available = lines.filter((row) => row.availableHere);
  const inButUnavailable = lines.filter((row) => row.clockedInHere && row.unavailable);
  const elsewhere = lines.filter((row) => row.clockedInElsewhere);
  const clockedOut = lines.filter((row) => row.clockedOutHere);
  const leaveOnly = lines.filter((row) => row.unavailable && !row.clockedInHere && !row.clockedOutHere);

  if (hasEmployeeFilter && !hasOfficeFilter) {
    return [
      `Employee presence ${now.time} Asia/Jerusalem (${now.date})`,
      employeeLabel ? `Employee: ${employeeLabel}` : '',
      formatPresenceLines(lines) || 'No clock-in or unavailability rows for this employee.',
      visibilityNote,
    ]
      .filter(Boolean)
      .join('\n');
  }

  const header = officeLabel
    ? `Employee presence ${now.time} Asia/Jerusalem (${now.date})\nOffice: ${officeLabel}`
    : `Employee presence ${now.time} Asia/Jerusalem (${now.date})`;

  if (hasOfficeFilter && !available.length && !inButUnavailable.length && !clockedOut.length && !elsewhere.length) {
    return [
      header,
      `Nobody is currently clocked in at ${officeNames.join(', ') || 'this office'}.`,
      leaveOnly.length ? `On leave / unavailable:\n${formatPresenceLines(leaveOnly.slice(0, 20))}` : '',
      visibilityNote,
    ]
      .filter(Boolean)
      .join('\n');
  }

  if (!hasOfficeFilter) {
    const allClockedIn = lines.filter((row) => row.clockedIn);
    const allClockedOut = lines.filter((row) => !row.clockedIn && row.summary.includes('clocked out'));
    return [
      header,
      `Clocked in now: ${allClockedIn.length}`,
      allClockedIn.length ? formatPresenceLines(allClockedIn) : 'Nobody is currently clocked in.',
      allClockedOut.length ? `Clocked out today:\n${formatPresenceLines(allClockedOut.slice(0, 30))}` : '',
      leaveOnly.length ? `On leave / unavailable now:\n${formatPresenceLines(leaveOnly.slice(0, 30))}` : '',
      visibilityNote,
    ]
      .filter(Boolean)
      .join('\n');
  }

  return [
    header,
    `Available now at this office (clocked in, not on leave): ${available.length}`,
    available.length ? formatPresenceLines(available) : 'None.',
    inButUnavailable.length ? `In this office but unavailable:\n${formatPresenceLines(inButUnavailable)}` : '',
    elsewhere.length ? `Clocked in elsewhere:\n${formatPresenceLines(elsewhere)}` : '',
    clockedOut.length ? `Clocked out of this office today:\n${formatPresenceLines(clockedOut)}` : '',
    visibilityNote,
  ]
    .filter(Boolean)
    .join('\n');
}

async function executeListEmployeePresence(args: {
  office?: string;
  employee?: string;
  query?: string;
}): Promise<string> {
  return formatPresenceReport(await collectEmployeePresence(args));
}

function parseJsonArg(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function presenceLinesToExcelRows(lines: PresenceLine[]): Record<string, string>[] {
  return lines.map((row) => ({
    Name: row.name,
    Department: row.department,
    Status: row.status,
    Workplace: row.workplace,
    'Clock in': row.clockIn,
    'Clock out': row.clockOut,
    Unavailability: row.unavailability,
    Notes: row.summary,
  }));
}

async function executeCreateExcelSheet(args: {
  filename?: string;
  sheet_name?: string;
  title?: string;
  source?: string;
  office?: string;
  employee?: string;
  query?: string;
  filter?: string;
  columns?: string[];
  rows?: unknown;
  sheets?: ExcelSheetInput[];
}): Promise<string> {
  const source = String(args.source || (args.office || args.employee ? 'employee_presence' : 'custom')).toLowerCase();
  const parsedRows = parseJsonArg(args.rows);
  const parsedSheets = parseJsonArg(args.sheets);
  const requestedSheets = Array.isArray(parsedSheets)
    ? parsedSheets.filter((sheet) => sheet && typeof sheet === 'object')
    : [];
  let sheets: ExcelSheetInput[] = requestedSheets;
  let rowCount = 0;
  let subtitle = '';

  if (source === 'employee_presence') {
    const report = await collectEmployeePresence({
      office: args.office,
      employee: args.employee,
      query: args.query,
    });
    if (report.error) return report.error;
    const filter = String(args.filter || 'all').toLowerCase();
    let lines = report.lines;
    if (filter === 'available') lines = lines.filter((row) => row.availableHere);
    else if (filter === 'clocked_in') lines = lines.filter((row) => row.clockedIn);
    const excelRows = presenceLinesToExcelRows(lines);
    rowCount = excelRows.length;
    subtitle = [
      report.officeLabel ? `Office: ${report.officeLabel}` : '',
      report.employeeLabel ? `Employee: ${report.employeeLabel}` : '',
      `${report.now.date} ${report.now.time} Asia/Jerusalem`,
    ]
      .filter(Boolean)
      .join(' · ');
    sheets = [
      {
        name: args.sheet_name || (report.officeNames[0] || 'Presence').slice(0, 31),
        columns: ['Name', 'Department', 'Status', 'Workplace', 'Clock in', 'Clock out', 'Unavailability', 'Notes'],
        rows: excelRows,
      },
    ];
  } else if (!sheets.length) {
    const rows = parsedRows;
    const hasRows = Array.isArray(rows) && rows.length > 0;
    if (!hasRows && !args.columns?.length) {
      return 'create_excel_sheet needs columns and rows, or source=employee_presence. Call list_employee_presence first if you do not have the rows yet.';
    }
    rowCount = Array.isArray(rows) ? rows.length : 0;
    sheets = [
      {
        name: args.sheet_name || 'Sheet1',
        columns: Array.isArray(args.columns) ? args.columns.map(String) : undefined,
        rows: hasRows ? rows : [],
      },
    ];
  } else {
    rowCount = sheets.reduce((sum, sheet) => sum + (Array.isArray(sheet.rows) ? sheet.rows.length : 0), 0);
  }

  const filename =
    args.filename ||
    args.title ||
    (source === 'employee_presence' ? 'employee_presence' : 'RMQ_export');

  try {
    const file = await createRmqExcelFile(sheets, filename);
    return [
      `Created Excel file ${file.filename} (${rowCount} row${rowCount === 1 ? '' : 's'}).`,
      subtitle,
      `Include this exact markdown download link in your reply (do not change the URL): [Download ${file.filename}](rmq-excel://${file.id})`,
    ]
      .filter(Boolean)
      .join('\n');
  } catch (error: any) {
    return `Could not create the Excel file: ${error?.message || String(error)}`;
  }
}

async function executeListSignedContracts(args: {
  date?: string;
  date_from?: string;
  date_to?: string;
  period?: string;
  lead_type?: string;
  closer?: string;
  query?: string;
}): Promise<string> {
  const range = resolveSignedDateRange(args);
  const leadTypeFilter = String(args.lead_type || 'all').toLowerCase();
  const closerArg = String(args.closer || '').trim();
  const queryArg = String(args.query || '').trim();

  const [stageRows, employees] = await Promise.all([
    fetchStage60RecordsInRange(range.from, range.to),
    loadCloserEmployees(),
  ]);

  let closerFilter = closerArg;
  let nameFilter = queryArg.toLowerCase();
  let queryUsedAsCloser = false;
  if (!closerFilter && queryArg && !looksLikeLeadNumber(queryArg)) {
    const employeeHits = matchEmployees(employees, queryArg);
    if (employeeHits.length) {
      closerFilter = queryArg;
      nameFilter = '';
      queryUsedAsCloser = true;
    }
  }
  const closerHits = closerFilter ? matchEmployees(employees, closerFilter) : [];
  const newIds = new Set<string>();
  const legacyIds = new Set<number>();
  const newSignDates = new Map<string, string>();
  const legacySignDates = new Map<number, string>();

  for (const record of stageRows) {
    const signTs = resolveStage60SignTimestamp(record);
    if (record.newlead_id) {
      const id = String(record.newlead_id);
      newIds.add(id);
      if (signTs && (!newSignDates.has(id) || new Date(signTs) > new Date(newSignDates.get(id)!))) {
        newSignDates.set(id, signTs);
      }
    }
    if (record.lead_id != null && Number.isFinite(Number(record.lead_id))) {
      const id = Number(record.lead_id);
      legacyIds.add(id);
      if (signTs && (!legacySignDates.has(id) || new Date(signTs) > new Date(legacySignDates.get(id)!))) {
        legacySignDates.set(id, signTs);
      }
    }
  }

  const includeNew = leadTypeFilter !== 'legacy';
  const includeLegacy = leadTypeFilter !== 'new';

  const [newLeads, legacyLeads, newContracts, legacyContracts] = await Promise.all([
    includeNew && newIds.size
      ? fetchRowsInChunks(Array.from(newIds), async (chunk) => {
          const { data, error } = await supabase
            .from('leads')
            .select('id, lead_number, manual_id, name, stage, topic, proposal_total, proposal_currency, closer')
            .in('id', chunk);
          if (error) throw error;
          return data || [];
        })
      : Promise.resolve([]),
    includeLegacy && legacyIds.size
      ? fetchRowsInChunks(Array.from(legacyIds), async (chunk) => {
          const { data, error } = await supabase
            .from('leads_lead')
            .select(
              'id, lead_number, manual_id, name, stage, category, total, total_base, proposal, closer_id, closer_employee:tenants_employee!fk_leads_lead_closer_id(id, display_name)',
            )
            .in('id', chunk);
          if (error) {
            const fallback = await supabase
              .from('leads_lead')
              .select('id, lead_number, name, stage, category, proposal, closer_id')
              .in('id', chunk);
            if (fallback.error) throw fallback.error;
            return fallback.data || [];
          }
          return data || [];
        })
      : Promise.resolve([]),
    includeNew && newIds.size
      ? fetchRowsInChunks(Array.from(newIds), async (chunk) => {
          const { data, error } = await supabase
            .from('contracts')
            .select('id, client_id, status, signed_at, total_amount')
            .in('client_id', chunk)
            .order('signed_at', { ascending: false });
          if (error) return [];
          return data || [];
        })
      : Promise.resolve([]),
    includeLegacy && legacyIds.size
      ? fetchRowsInChunks(Array.from(legacyIds), async (chunk) => {
          const { data, error } = await supabase
            .from('contracts')
            .select('id, legacy_id, status, signed_at, total_amount')
            .in('legacy_id', chunk)
            .order('signed_at', { ascending: false });
          if (error) return [];
          return data || [];
        })
      : Promise.resolve([]),
  ]);

  const contractByNewId = new Map<string, any>();
  for (const row of newContracts) {
    const id = String(row.client_id || '');
    if (id && !contractByNewId.has(id)) contractByNewId.set(id, row);
  }
  const contractByLegacyId = new Map<string, any>();
  for (const row of legacyContracts) {
    const id = String(row.legacy_id || '');
    if (id && !contractByLegacyId.has(id)) contractByLegacyId.set(id, row);
  }

  const rows: SignedContractRow[] = [];

  if (includeNew) {
    for (const lead of newLeads) {
      const contract = contractByNewId.get(String(lead.id));
      const signTs = newSignDates.get(String(lead.id)) || contract?.signed_at || '';
      const closer = resolveCloserLabel(lead.closer, lead.closer, employees);
      rows.push({
        key: `new:${lead.id}`,
        leadType: 'new',
        leadNumber: String(lead.lead_number || lead.manual_id || '').trim(),
        name: String(lead.name || 'Unnamed lead'),
        signDate: toSignCalendarDateKey(signTs) || String(signTs).slice(0, 10),
        stage: getStageName(String(lead.stage ?? '')) || String(lead.stage ?? ''),
        amount: parseMoney(lead.proposal_total ?? contract?.total_amount),
        currency: String(lead.proposal_currency || '').trim() || 'NIS',
        contractStatus: String(contract?.status || ''),
        closer: closer.name,
        closerId: closer.id,
      });
    }
  }

  if (includeLegacy) {
    for (const lead of legacyLeads) {
      const contract = contractByLegacyId.get(String(lead.id));
      const signTs = legacySignDates.get(Number(lead.id)) || contract?.signed_at || '';
      const closer = resolveCloserLabel(
        lead.closer_id,
        lead.closer_id,
        employees,
        joinedEmployeeName(lead.closer_employee),
      );
      rows.push({
        key: `legacy:${lead.id}`,
        leadType: 'legacy',
        leadNumber: String(lead.lead_number || lead.manual_id || lead.id || '').trim(),
        name: String(lead.name || 'Unnamed lead'),
        signDate: toSignCalendarDateKey(signTs) || String(signTs).slice(0, 10),
        stage: getStageName(String(lead.stage ?? '')) || String(lead.stage ?? ''),
        amount: parseMoney(lead.total_base ?? lead.total ?? lead.proposal ?? contract?.total_amount),
        currency: '',
        contractStatus: String(contract?.status || ''),
        closer: closer.name,
        closerId: closer.id,
      });
    }
  }

  let filtered = closerFilter ? rows.filter((row) => closerRowMatches(row, closerHits, closerFilter)) : rows;
  if (nameFilter) {
    filtered = filtered.filter(
      (row) =>
        row.name.toLowerCase().includes(nameFilter) ||
        row.leadNumber.toLowerCase().includes(nameFilter),
    );
  }

  filtered.sort(
    (a, b) =>
      String(b.signDate).localeCompare(String(a.signDate)) ||
      a.name.localeCompare(b.name),
  );

  if (!filtered.length) {
    if (closerFilter && rows.length) {
      const matched = formatMatchedEmployeeLabel(closerFilter, closerHits);
      return [
        `No closed deals with closer matching "${closerFilter}" for ${range.label} (Asia/Jerusalem).`,
        `${rows.length} deal(s) were signed that day, but none have that closer role.`,
        closerHits.length ? `Matched closer employees: ${matched}.` : 'No matching closer found in tenants_employee; also checked the lead closer field.',
        queryUsedAsCloser ? 'Interpreted the name as the lead closer, not the client.' : '',
      ]
        .filter(Boolean)
        .join(' ');
    }
    return `No signed contracts (stage 60) found for ${range.label} (Asia/Jerusalem). Checked leads_leadstage joined to leads (new) and leads_lead (legacy), plus contracts.client_id / contracts.legacy_id.`;
  }

  const newRows = filtered.filter((row) => row.leadType === 'new');
  const legacyRows = filtered.filter((row) => row.leadType === 'legacy');
  const totalsByCurrency = new Map<string, number>();
  for (const row of filtered) {
    const key = row.currency || 'amount';
    totalsByCurrency.set(key, (totalsByCurrency.get(key) || 0) + row.amount);
  }
  const totalsText = Array.from(totalsByCurrency.entries())
    .map(([currency, amount]) => formatMoney(amount, currency === 'amount' ? '' : currency))
    .join(', ');
  const closerLabel = closerFilter
    ? formatMatchedEmployeeLabel(closerFilter, closerHits)
    : '';

  const lines = filtered.slice(0, 80).map((row, index) => {
    const bits = [
      row.signDate || '—',
      row.leadNumber ? `${row.leadNumber} ${row.name}` : row.name,
      row.leadType,
      row.closer ? `closer ${row.closer}` : 'closer —',
      row.stage,
      row.amount ? formatMoney(row.amount, row.currency) : '',
      row.contractStatus,
    ].filter(Boolean);
    return `${index + 1}. ${bits.join(' · ')}`;
  });

  return [
    `Closed deals ${range.label} (Asia/Jerusalem, stage 60, closer = lead closer role): ${filtered.length}`,
    closerLabel ? `Closer: ${closerLabel}` : '',
    `New leads: ${newRows.length} · Legacy leads: ${legacyRows.length}`,
    totalsText ? `Amounts: ${totalsText}` : '',
    lines.join('\n'),
    filtered.length > 80 ? `…and ${filtered.length - 80} more` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function executeCreateLead(args: {
  name: string;
  email?: string;
  phone?: string;
  topic: string;
  language?: string;
}): Promise<string> {
  const { data: auth } = await supabase.auth.getUser();
  const createdBy = auth.user?.email || null;
  let data: any;
  let error: any;
  const payload = {
    p_lead_name: args.name,
    p_lead_email: args.email || null,
    p_lead_phone: args.phone || null,
    p_lead_topic: args.topic,
    p_lead_language: args.language || 'English',
    p_created_by: createdBy,
  };
  const first = await supabase.rpc('create_new_lead_v4', {
    ...payload,
    p_balance_currency: 'NIS',
    p_proposal_currency: 'NIS',
  });
  data = first.data;
  error = first.error;
  if (error && String(error.message || '').includes('does not exist')) {
    const fallback = await supabase.rpc('create_new_lead_v3', payload);
    data = fallback.data;
    error = fallback.error;
  }
  if (error) throw error;
  const newLead = data?.[0];
  if (!newLead) throw new Error('No data returned from lead creation.');
  return `Created lead ${newLead.name} (${newLead.lead_number}).`;
}

async function executeCreateMeeting(args: {
  lead_number: string;
  meeting_date: string;
  meeting_time: string;
  meeting_brief?: string;
  manager?: string;
  helper?: string;
}): Promise<string> {
  const payload: Record<string, unknown> = {
    meeting_date: args.meeting_date,
    meeting_time: args.meeting_time,
    meeting_brief: args.meeting_brief || null,
  };
  if (args.manager) payload.manager = args.manager;
  if (args.helper) payload.helper = args.helper;
  const { data, error } = await supabase
    .from('leads')
    .update(payload)
    .eq('lead_number', args.lead_number)
    .select('name, lead_number')
    .single();
  if (error) throw error;
  return `Scheduled meeting for ${data.name} (${data.lead_number}) on ${args.meeting_date} at ${args.meeting_time}.`;
}

function withLeadOnAppPath(path: string, leadNumber: string): string {
  const clientBase = resolveLeadShareClientRoute({ leadNumber });
  if (!path.startsWith('/clients')) return path;
  const qIndex = path.indexOf('?');
  const tab = new URLSearchParams(qIndex >= 0 ? path.slice(qIndex + 1) : '').get('tab');
  if (!tab) return clientBase;
  const sep = clientBase.includes('?') ? '&' : '?';
  return `${clientBase}${sep}tab=${encodeURIComponent(tab)}`;
}

function executeFindAppPage(args: { query?: string }): string {
  const query = String(args.query || '').trim();
  if (!query) return 'Ask what you want to find, e.g. working hours, expenses, or calendar.';
  const leadMatch = query.match(/\b([LC]\d+(?:\/\d+)?)\b/i);
  const leadNumber = leadMatch?.[1] || '';
  const places = findCrmAppPlaces(query, 6);
  if (!places.length) {
    return `No matching CRM page for "${query}". Try a screen name such as Calendar, HR, expenses, or Lead Search.`;
  }
  const lines = places.map((place, index) => {
    const path = leadNumber ? withLeadOnAppPath(place.path, leadNumber) : place.path;
    return `${index + 1}. [${place.title}](${path}) — ${place.how}`;
  });
  return [
    `CRM map matches for "${query}":`,
    lines.join('\n'),
    'Paste these markdown links in your reply so the user can click them and open the page.',
  ].join('\n');
}

const FINANCE_KIND_LABEL: Record<FinanceExpenseKind, string> = {
  lead: 'Client',
  subcontractor: 'Subcontractor',
  other_firm: 'External firm',
  office: 'Office',
  marketing: 'Marketing',
  rent: 'Rent',
  partner_draws: 'Partner draws',
};

type ExpenseKindFilter = FinanceExpenseKind | 'salaries' | 'all';

function resolveExpenseDateRange(args: {
  date?: string;
  date_from?: string;
  date_to?: string;
  period?: string;
}): { from: string; to: string; label: string } {
  const hasRange = String(args.date_from || '').trim() || String(args.date_to || '').trim();
  const hasPeriod = String(args.period || '').trim() || String(args.date || '').trim();
  return resolveSignedDateRange({
    date: hasRange || hasPeriod ? args.date : 'this month',
    date_from: args.date_from,
    date_to: args.date_to,
    period: args.period,
  });
}

function normalizeExpenseKind(raw: string | undefined): ExpenseKindFilter {
  const v = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ');
  if (!v || v === 'all') return 'all';
  if (v === 'office' || v.includes('office')) return 'office';
  if (v.includes('salary') || v.includes('payroll') || v.includes('wage')) return 'salaries';
  if (v === 'other firm' || v.includes('external') || v.includes('firm management')) return 'other_firm';
  if (v.includes('market') || v.includes('ads') || v.includes('source media')) return 'marketing';
  if (v.includes('rent')) return 'rent';
  if (v.includes('partner') || v.includes('draw')) return 'partner_draws';
  if (v.includes('subcontract')) return 'subcontractor';
  if (v.includes('lead') || v.includes('client')) return 'lead';
  if (v === 'other_firm') return 'other_firm';
  return 'all';
}

function nameFuzzyMatches(haystack: string, needle: string): boolean {
  const h = haystack.toLowerCase().trim();
  const n = needle.toLowerCase().trim();
  if (!n) return true;
  if (!h) return false;
  if (h.includes(n) || n.includes(h)) return true;
  const tokens = n.split(/\s+/).filter((t) => t.length > 1);
  return tokens.length > 0 && tokens.every((t) => h.includes(t));
}

async function fetchSalaryLinesForRange(
  from: string,
  to: string,
): Promise<Array<{ employee: string; month: string; gross: number; net: number | null }>> {
  const fromY = Number(from.slice(0, 4));
  const toY = Number(to.slice(0, 4));
  if (!Number.isFinite(fromY) || !Number.isFinite(toY)) return [];

  const { data, error } = await supabase
    .from('employee_salary')
    .select('employee_id, gross_salary, net_salary, salary_month, salary_year')
    .gte('salary_year', fromY)
    .lte('salary_year', toY)
    .limit(500);
  if (error) throw error;

  const fromKey = from.slice(0, 7);
  const toKey = to.slice(0, 7);
  const rows = (data || []).filter((r: { salary_year: number; salary_month: number }) => {
    const key = `${r.salary_year}-${String(r.salary_month).padStart(2, '0')}`;
    return key >= fromKey && key <= toKey;
  });
  const ids = [...new Set(rows.map((r: { employee_id: number }) => Number(r.employee_id)).filter(Boolean))];
  const nameById = new Map<number, string>();
  if (ids.length) {
    const { data: emps } = await supabase.from('tenants_employee').select('id, display_name').in('id', ids);
    for (const emp of emps || []) {
      nameById.set(Number(emp.id), String(emp.display_name || '').trim() || `Employee ${emp.id}`);
    }
  }

  return rows
    .map((r: { employee_id: number; gross_salary: number; net_salary: number | null; salary_year: number; salary_month: number }) => ({
      employee: nameById.get(Number(r.employee_id)) || `Employee ${r.employee_id}`,
      month: `${r.salary_year}-${String(r.salary_month).padStart(2, '0')}`,
      gross: Number(r.gross_salary) || 0,
      net: r.net_salary != null ? Number(r.net_salary) : null,
    }))
    .sort((a, b) => b.month.localeCompare(a.month) || a.employee.localeCompare(b.employee));
}

async function executeListExpenses(args: {
  date?: string;
  date_from?: string;
  date_to?: string;
  period?: string;
  kind?: string;
  added_by?: string;
  search?: string;
  limit?: number;
}): Promise<string> {
  const range = resolveExpenseDateRange(args);
  const kind = normalizeExpenseKind(args.kind);
  const addedBy = String(args.added_by || '').trim();
  const search = String(args.search || '').trim();
  const limit = Math.min(80, Math.max(1, Number(args.limit) || 30));

  const financeKind: FinanceExpenseKind | '' =
    kind === 'all' || kind === 'salaries' ? '' : kind;

  const monthKeys = listExpenseMonthsInRange(range.from, range.to);
  const [breakdown, entries, salaries] = await Promise.all([
    kind === 'lead' || kind === 'subcontractor'
      ? Promise.resolve([])
      : fetchAllExpensesBreakdown(monthKeys),
    kind === 'salaries'
      ? Promise.resolve([])
      : fetchFinanceExpenseEntries({
          kind: financeKind,
          dateFrom: range.from,
          dateTo: range.to,
          search: search || undefined,
        }),
    kind === 'all' || kind === 'salaries' ? fetchSalaryLinesForRange(range.from, range.to) : Promise.resolve([]),
  ]);

  const totals = {
    source_media: 0,
    firm_management: 0,
    rent: 0,
    partner_draws: 0,
    salaries: 0,
    office: 0,
    firm_management_marketing: 0,
  };
  for (const row of breakdown) {
    for (const key of EXPENSE_CATEGORY_ORDER) totals[key] += row.totals[key];
    totals.firm_management_marketing += row.totals.firm_management_marketing;
  }

  const showCategory = (key: ExpenseCategoryKey) => {
    if (kind === 'all') return true;
    if (kind === 'office') return key === 'office';
    if (kind === 'salaries') return key === 'salaries';
    if (kind === 'other_firm') return key === 'firm_management';
    if (kind === 'marketing') return key === 'source_media';
    if (kind === 'rent') return key === 'rent';
    if (kind === 'partner_draws') return key === 'partner_draws';
    return false;
  };

  let itemRows = entries;
  if (addedBy) {
    itemRows = itemRows.filter((row) => nameFuzzyMatches(row.created_by_name || '', addedBy));
  }

  const entryNis = (row: { amount: number | string | null; currency_code: string | null }) =>
    managementAmountToNis(row.amount, row.currency_code);

  const sumByKind = new Map<string, { label: string; amount: number; count: number }>();
  const sumByType = new Map<string, { amount: number; count: number }>();
  const sumByPerson = new Map<string, { amount: number; count: number }>();
  for (const row of itemRows) {
    const nis = entryNis(row);
    const kindKey = row.kind;
    const kindLabel = FINANCE_KIND_LABEL[row.kind] || row.kind;
    const kindAgg = sumByKind.get(kindKey) || { label: kindLabel, amount: 0, count: 0 };
    kindAgg.amount += nis;
    kindAgg.count += 1;
    sumByKind.set(kindKey, kindAgg);
    const typeLabel = (row.category_label || '').trim() || 'Unspecified';
    const typeAgg = sumByType.get(typeLabel) || { amount: 0, count: 0 };
    typeAgg.amount += nis;
    typeAgg.count += 1;
    sumByType.set(typeLabel, typeAgg);
    const person = String(row.created_by_name || '').trim() || 'Unknown';
    const personAgg = sumByPerson.get(person) || { amount: 0, count: 0 };
    personAgg.amount += nis;
    personAgg.count += 1;
    sumByPerson.set(person, personAgg);
  }

  const categoryLines: string[] = [];
  let reportTotal = 0;
  if (kind !== 'lead' && kind !== 'subcontractor') {
    for (const key of EXPENSE_CATEGORY_ORDER) {
      if (!showCategory(key)) continue;
      const amount = totals[key];
      if (amount <= 0) continue;
      reportTotal += amount;
      categoryLines.push(`- ${EXPENSE_CATEGORY_LABELS[key]}: ${formatNis(amount)}`);
    }
    if (kind === 'all' || kind === 'marketing') {
      const marketing = marketingExpenseTotal(totals);
      if (kind === 'marketing') {
        reportTotal = marketing;
        categoryLines.length = 0;
        if (totals.source_media > 0) categoryLines.push(`- Source media: ${formatNis(totals.source_media)}`);
        if (totals.firm_management_marketing > 0) {
          categoryLines.push(`- Marketing (firm management type): ${formatNis(totals.firm_management_marketing)}`);
        }
      } else if (totals.firm_management_marketing > 0) {
        reportTotal += totals.firm_management_marketing;
        categoryLines.push(`- Marketing (in firm management types): ${formatNis(totals.firm_management_marketing)}`);
      }
    }
  }

  const clientNis = sumByKind.get('lead')?.amount || 0;
  const subNis = sumByKind.get('subcontractor')?.amount || 0;
  if (kind === 'all' || kind === 'lead') {
    if (clientNis > 0) categoryLines.push(`- Client expenses: ${formatNis(clientNis)} (${sumByKind.get('lead')?.count || 0} items)`);
  }
  if (kind === 'all' || kind === 'subcontractor') {
    if (subNis > 0) categoryLines.push(`- Subcontractor fees: ${formatNis(subNis)} (${sumByKind.get('subcontractor')?.count || 0} items)`);
  }

  const combinedTotal =
    kind === 'lead' ? clientNis : kind === 'subcontractor' ? subNis : reportTotal + clientNis + subNis;

  const lines: string[] = [
    `EXPENSES ${range.label} (Asia/Jerusalem)`,
    `Kind filter: ${kind === 'all' ? 'all types' : kind}`,
    '',
    `TOTAL: ${formatNis(combinedTotal)}`,
  ];

  if (categoryLines.length) {
    lines.push('', 'KIND (summary cards: Client / Office / Subcontractor / … — not the table CATEGORY column):');
    lines.push(...categoryLines);
  } else {
    lines.push('', 'KIND: none with an amount in this range.');
  }

  const typeLines = [...sumByType.entries()]
    .filter(([, agg]) => agg.amount > 0)
    .sort((a, b) => b[1].amount - a[1].amount)
    .slice(0, 40)
    .map(([label, agg]) => `- ${label}: ${formatNis(agg.amount)} (${agg.count})`);
  if (typeLines.length) {
    lines.push('', 'CATEGORY (Expenses table CATEGORY column — Courier and delivery, government fee, translation, …):');
    lines.push(...typeLines);
  }

  const personLines = [...sumByPerson.entries()]
    .filter(([, agg]) => agg.amount > 0)
    .sort((a, b) => b[1].amount - a[1].amount)
    .slice(0, 40)
    .map(([label, agg]) => `- ${label}: ${formatNis(agg.amount)} (${agg.count})`);
  if (personLines.length) {
    lines.push('', 'CREATED BY (Expenses table CREATED BY column — who added the row):');
    lines.push(...personLines);
  }

  if (kind !== 'salaries') {
    const shown = itemRows.slice(0, limit);
    lines.push('', `LINE ITEMS (${shown.length} of ${itemRows.length}):`);
    if (!shown.length) {
      lines.push(addedBy ? `No line items added by "${addedBy}" in this range.` : 'No line items in this range.');
    } else {
      shown.forEach((row, index) => {
        const nis = entryNis(row);
        const extra =
          nis && row.currency_code && !/^ils|nis$/i.test(row.currency_code)
            ? ` (${formatFinanceExpenseAmount(row.amount, row.currency_code)})`
            : '';
        const addedByName = String(row.created_by_name || '').trim() || 'Unknown';
        const category = String(row.category_label || '').trim() || 'Unspecified';
        const date = row.expense_date || row.created_at.slice(0, 10);
        const leadBit = [row.lead_number, row.vendor_label].filter(Boolean).join(' ');
        lines.push(`${index + 1}. ${category} — ${formatNis(nis)}${extra}`);
        lines.push(`Added by: ${addedByName}`);
        if (leadBit) lines.push(`Lead: ${leadBit}`);
        lines.push(`Date: ${date}`);
      });
    }
  }

  if (kind === 'salaries') {
    const shownSalaries = salaries.slice(0, limit);
    const salaryGross = salaries.reduce((sum, row) => sum + row.gross, 0);
    lines.push('', `SALARIES (${salaries.length} rows, gross ${formatNis(salaryGross)}):`);
    if (!shownSalaries.length) {
      lines.push('No salary rows in this range.');
    } else {
      for (const row of shownSalaries) {
        const net = row.net != null ? ` · net ${formatNis(row.net)}` : '';
        lines.push(`- ${formatNis(row.gross)} · ${row.employee} · ${row.month}${net}`);
      }
    }
  }

  lines.push(
    '',
    'Number only each expense category line. Put Added by and Lead under it with no extra numbers or bullets. Quote names from LINE ITEMS. KIND is not the expense category. Do not invent employees or fee names.',
  );
  return lines.join('\n');
}

async function executeGetFirmFinancials(args: {
  date?: string;
  date_from?: string;
  date_to?: string;
  period?: string;
}): Promise<string> {
  const range = resolveExpenseDateRange(args);
  const monthKeys = listExpenseMonthsInRange(range.from, range.to);

  const [invoicedDue, breakdown] = await Promise.all([
    fetchInvoicedTotalDueNisForDateRange(range.from, range.to),
    fetchAllExpensesBreakdown(monthKeys),
  ]);

  const income = Math.round(invoicedDue * 0.9);
  const totals = {
    source_media: 0,
    firm_management: 0,
    rent: 0,
    partner_draws: 0,
    salaries: 0,
    office: 0,
    firm_management_marketing: 0,
  };
  for (const row of breakdown) {
    for (const key of EXPENSE_CATEGORY_ORDER) totals[key] += row.totals[key];
    totals.firm_management_marketing += row.totals.firm_management_marketing;
  }

  const expenses =
    EXPENSE_CATEGORY_ORDER.reduce((sum, key) => sum + totals[key], 0) + totals.firm_management_marketing;
  const net = income - expenses;
  const ratio = income > 0 ? expenses / income : null;

  const categoryAmounts: Array<{ label: string; amount: number }> = [
    ...EXPENSE_CATEGORY_ORDER.map((key) => ({ label: EXPENSE_CATEGORY_LABELS[key], amount: totals[key] })),
    { label: 'Marketing (firm management type)', amount: totals.firm_management_marketing },
  ]
    .filter((row) => row.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  const top = categoryAmounts.slice(0, 3);
  let advice = 'Income covers expenses in this period.';
  if (income <= 0 && expenses > 0) {
    advice = 'No Sales Contribution income in this range while expenses were recorded — check invoiced due dates.';
  } else if (net < 0) {
    advice = `Spending exceeds Sales Contribution income by ${formatNis(Math.abs(net))}. Cut or delay the largest categories first.`;
  } else if (ratio != null && ratio >= 0.85) {
    advice = 'Expenses are using most of income. Review the top categories and hiring/payroll timing.';
  } else if (ratio != null && ratio >= 0.7) {
    advice = 'Cost ratio is high. Watch the top two categories against next month’s invoiced due.';
  }

  const lines = [
    `FIRM FINANCIALS ${range.label} (Asia/Jerusalem)`,
    '',
    `Income (Sales Contribution): ${formatNis(income)}`,
    '  = 90% of invoiced total due for payment rows with due_date in this range (same definition as the Sales Contribution page).',
    `  Invoiced due before 90%: ${formatNis(invoicedDue)}`,
    '',
    `Expenses (All expenses report, NIS): ${formatNis(expenses)}`,
    ...categoryAmounts.map((row) => {
      const share = expenses > 0 ? Math.round((row.amount / expenses) * 100) : 0;
      return `- ${row.label}: ${formatNis(row.amount)} (${share}% of expenses)`;
    }),
    '',
    `Net (income − expenses): ${formatNis(net)}`,
    ratio != null ? `Expense ratio: ${Math.round(ratio * 100)}% of income` : 'Expense ratio: n/a (no income)',
    top.length ? `Largest: ${top.map((row) => row.label).join(', ')}` : '',
    '',
    `Guidance: ${advice}`,
    'Give practical recommendations from these numbers. Do not invent other income or expense figures.',
  ].filter(Boolean);

  return lines.join('\n');
}

export async function executeRmqAiTool(toolCall: {
  function?: { name?: string; arguments?: string };
}): Promise<string> {
  const name = toolCall.function?.name || '';
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(toolCall.function?.arguments || '{}');
  } catch {
    return `Invalid arguments for ${name}`;
  }

  const leadScopedTools = new Set([
    'get_lead_case_file',
    'list_client_meetings',
    'draft_client_message',
    'prep_meeting',
    'wrap_up_meeting',
    'set_follow_up',
    'log_manual_note',
  ]);
  if (leadScopedTools.has(name)) {
    const fallback = currentLeadAsToolArgs();
    const rawQuery = String(args.query || '').trim();
    const namedOtherLead = isNamedOtherLead(rawQuery, fallback);
    if (!namedOtherLead && (fallback.lead_id || fallback.query)) {
      args = {
        ...args,
        query: fallback.query || args.query,
        lead_id: fallback.lead_id || args.lead_id,
        is_legacy: args.is_legacy ?? fallback.is_legacy,
      };
    }
  }

  try {
    const started = Date.now();
    const result = await (async () => {
    if (name === 'get_lead_case_file') {
      return await executeGetLeadCaseFile(args as { query?: string; lead_id?: string; is_legacy?: boolean });
    }
    if (name === 'list_client_meetings') {
      return await executeListClientMeetings(
        args as { query?: string; lead_id?: string; is_legacy?: boolean; date?: string },
      );
    }
    if (name === 'list_calendar_day' || name === 'list_meetings') {
      return await executeListMeetings(
        args as { date?: string; scheduler?: string; query?: string; scope?: string },
      );
    }
    if (name === 'list_employee_presence') {
      return await executeListEmployeePresence(
        args as { office?: string; employee?: string; query?: string },
      );
    }
    if (name === 'find_app_page') {
      return executeFindAppPage(args as { query?: string });
    }
    if (name === 'create_excel_sheet') {
      return await executeCreateExcelSheet(
        args as {
          filename?: string;
          sheet_name?: string;
          title?: string;
          source?: string;
          office?: string;
          employee?: string;
          query?: string;
          filter?: string;
          columns?: string[];
          rows?: unknown;
          sheets?: ExcelSheetInput[];
        },
      );
    }
    if (name === 'list_signed_contracts') {
      return await executeListSignedContracts(
        args as {
          date?: string;
          date_from?: string;
          date_to?: string;
          period?: string;
          lead_type?: string;
          closer?: string;
          query?: string;
        },
      );
    }
    if (name === 'list_expenses') {
      return await executeListExpenses(
        args as {
          date?: string;
          date_from?: string;
          date_to?: string;
          period?: string;
          kind?: string;
          added_by?: string;
          search?: string;
          limit?: number;
        },
      );
    }
    if (name === 'get_firm_financials') {
      return await executeGetFirmFinancials(
        args as { date?: string; date_from?: string; date_to?: string; period?: string },
      );
    }
    if (name === 'query_crm') {
      return await executeQueryCrm(args as Parameters<typeof executeQueryCrm>[0]);
    }
    if (name === 'create_lead') {
      return await executeCreateLead(args as Parameters<typeof executeCreateLead>[0]);
    }
    if (name === 'create_meeting') {
      return await executeCreateMeeting(args as Parameters<typeof executeCreateMeeting>[0]);
    }
    if (name === 'list_my_sales_day') {
      return await executeListMySalesDay();
    }
    if (name === 'draft_client_message') {
      return await executeDraftClientMessage(args as Parameters<typeof executeDraftClientMessage>[0]);
    }
    if (name === 'prep_meeting') {
      return await executePrepMeeting(args as Parameters<typeof executePrepMeeting>[0]);
    }
    if (name === 'wrap_up_meeting') {
      return await executeWrapUpMeeting(args as Parameters<typeof executeWrapUpMeeting>[0]);
    }
    if (name === 'set_follow_up') {
      return await executeSetFollowUp(args as Parameters<typeof executeSetFollowUp>[0]);
    }
    if (name === 'log_manual_note') {
      return await executeLogManualNote(args as Parameters<typeof executeLogManualNote>[0]);
    }
    if (name === 'list_stale_sales_leads') {
      return await executeListStaleSalesLeads(args as { days?: number });
    }
    return `Unknown function: ${name}`;
    })();
    logRmqAiToolRouting(name, Date.now() - started);
    return result;
  } catch (error: any) {
    logRmqAiToolRouting(name, 0);
    return `Error executing ${name}: ${error?.message || String(error)}`;
  }
}
