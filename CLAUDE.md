# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Core Development
- `npm run dev` - Start development server with Vite
- `npm run build` - Build production bundle
- `npm run preview` - Preview production build locally

### Database Operations
- `npm run insert-test-data` - Insert test data into Supabase database using the script
- `supabase functions deploy chat` - Deploy AI chat edge function with vision support
- Execute SQL files in `sql/` directory for database schema changes

## Architecture Overview

### Tech Stack
- **Frontend**: React 18 + TypeScript + Vite
- **UI Framework**: DaisyUI + Tailwind CSS
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Microsoft MSAL (Azure AD)
- **Calendar Integration**: Microsoft Graph API
- **AI Features**: OpenAI GPT-4o (with vision support via Supabase Edge Functions)

### Application Structure

This is a **CRM system for citizenship/immigration services** with the following key architectural patterns:

#### Data Flow Architecture
- **Database Layer**: Supabase with RLS policies and custom RPC functions
- **API Layer**: Supabase Edge Functions for AI operations and external integrations
- **State Management**: React state with prop drilling (no global state library)
- **Routing**: React Router with protected routes and layout components

#### Core Domain Models

**Lead Management Pipeline**:
```
Created → Scheduler Assigned → Meeting Scheduled → Communication Started → 
Offer Sent → Client Signed → Payment Processing → Case Completion
```

**Key Database Tables**:
- `leads` - Central client/case data with 40+ fields including stages, roles, proposals
- `meetings` - Meeting scheduling and tracking
- `users` - System users with role-based permissions
- `payment_plans` - Financial tracking and proforma generation

#### Authentication & Authorization
- **MSAL Integration**: Uses Azure AD for SSO with extensive Microsoft Graph permissions
- **Required Scopes**: Calendars, Mail, Files, OnlineMeetings, User profile
- **Role System**: Admin, Expert, Scheduler, Handler roles with different UI access

### Component Architecture

#### Layout Pattern
- **Layout.tsx**: Main shell with sidebar (fixed left, 32px padding)
- **Sidebar.tsx**: Fixed navigation with role-based menu items
- **Header.tsx**: Top bar with user info and notifications

#### Tab-Based Detail Views
- **Clients.tsx**: Main client management with tab system
- **Client Tabs**: Modular tab components in `client-tabs/` directory
  - InfoTab, RolesTab, ContactInfoTab, MarketingTab, ExpertTab, MeetingTab, etc.
  - Each tab receives `ClientTabProps` interface with client data and update callbacks

#### Specialized Pages
- **Dashboard.tsx**: Main overview with metrics and recent activity
- **ReportsPage.tsx**: Advanced reporting with conversion funnels and meeting analytics
- **ExpertPage.tsx**: Expert-specific workflow and case management
- **CaseManagerPage.tsx**: German/Austrian citizenship case management with family trees

### AI Integration Architecture

#### AI Chat System (`AIChatWindow.tsx`)
- **Vision Support**: Handles image uploads with base64 conversion for GPT-4o
- **Function Calling**: Integrated tools for CRM operations:
  - `create_lead` - Create new leads
  - `create_meeting` - Schedule meetings
  - `query_executor` - Dynamic database queries

#### AI Stats Engine
- **Dynamic Querying**: Natural language → structured queries via `query_executor`
- **Security**: Whitelist-based table/column access, SQL injection protection
- **Supported Operations**: count, avg, sum, min, max, distinct, select with filters

### Database Integration Patterns

#### Supabase Client Setup
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- Type-safe database operations with generated TypeScript interfaces
- RLS policies for row-level security

#### Query Patterns
- **Search**: `searchLeads()` function with fuzzy matching on multiple fields
- **Real-time**: Supabase subscriptions for live data updates
- **Aggregation**: Custom RPC functions for complex reporting queries

### Microsoft Graph Integration

#### Calendar Integration
- **Meeting Creation**: Teams meetings with automatic calendar entries
- **Calendar Views**: Display Outlook calendar in application
- **Email Integration**: Send automated emails via Graph API

#### File Management
- **OneDrive Integration**: Document storage and sharing
- **Folder Creation**: Automatic client folder organization

### Environment Configuration

#### Required Environment Variables
```bash
# Supabase
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

# Microsoft MSAL
VITE_MSAL_CLIENT_ID=
VITE_MSAL_TENANT_ID=

# Supabase Edge Functions
OPENAI_API_KEY= (set in Supabase dashboard)
```

### Development Patterns

#### TypeScript Patterns
- **Interface Definitions**: `src/types/client.ts` for shared types
- **Database Types**: `src/lib/supabase.ts` with Lead and Meeting interfaces
- **Component Props**: Consistent prop interfaces across tab components

#### Styling Patterns
- **DaisyUI**: Component-based styling with utility classes
- **Responsive Design**: Mobile-first with `md:` breakpoints
- **Color System**: Consistent use of DaisyUI semantic colors

#### Error Handling
- **Toast Notifications**: `react-hot-toast` for user feedback
- **Database Errors**: Proper error boundaries and user messaging
- **Authentication**: MSAL error handling with redirects

### Key Business Logic

#### Stage Management
- **Stage Progression**: Automated stage transitions based on user actions
- **User Attribution**: Track which user performed stage changes for reporting
- **Business Rules**: Specific workflows for different citizenship types

#### Financial Tracking
- **Proforma Generation**: PDF generation with jsPDF
- **Payment Plans**: Multi-stage payment tracking with VAT calculations
- **Currency Support**: Multi-currency proposal and balance tracking

#### Reporting System
- **Conversion Funnels**: Track lead progression through stages
- **User Performance**: Attribution of meetings and stage changes to specific users
- **Date-based Analytics**: Flexible date range filtering for all reports