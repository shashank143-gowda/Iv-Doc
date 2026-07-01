# IV Doc (Intelligent Document Processing Platform)

Welcome to the **IV Doc** project documentation. IV Doc is a state-of-the-art Intelligent Document Processing (IDP) platform designed to classify, preprocess, extract, validate, and hand off structured information from a wide variety of financial and identity documents (such as SWIFT MT103 remittances, KYC Passports, Salary Slips, Invoices, and Account Opening Agreements). 

This repository houses two parallel architectures:
1. **Frontend App**: A responsive TanStack Start React application that leverages Supabase for identity and data storage, and coordinates processing streams via serverless edge functions.
2. **C# API Backend**: An ASP.NET Core Clean Architecture project introducing a versioned, job-first public API (`/v1`) with background queues and workers, ready for scalable B2B/programmatic integrations.

---

## 1. Project Overview

* **Project Name**: IV Doc (also referred to as `iv-docs-feature-backend`)
* **Purpose**: Provide a high-fidelity, secure, and automated document lifecycle management platform—encompassing OCR text extraction, multi-page document segmentation, multi-tier validation gates, manual review overrides, and secure webhook deliveries.
* **Problem it Solves**: 
  * Eliminates manual, error-prone entry of financial indicators (like IBANs, BIC codes, net pay amounts) from digital/physical document scans.
  * Solves multi-page consolidation issues where loan agreements, schedules, and checklists are scanned into a single PDF.
  * Standardizes validation policies (such as mod-97 IBAN checksums and cross-document income alignment) and provides an Exception Queue for compliance reviews.
* **High-Level Architecture**: 
  The system utilizes a split architecture. The frontend web UI is built using TanStack Start (React + Nitro), directly querying Supabase with Row Level Security (RLS). Server-side serverless edge functions perform OCR (via OCR.space) and LLM-based field extraction (via OpenAI and Google Gemini). The ASP.NET Core API provides parallel programmatic endpoints to run jobs asynchronously via a Hosted Service background worker.

---

## 2. Technology Stack

### Frontend Stack
* **Framework**: [TanStack Start](https://tanstack.com/router/v1/docs/start/overview) (v1.167.50) / [Vite](https://vitejs.dev/) (v7.3.1)
* **Language**: TypeScript (v5.8.3)
* **State Management**: React state, Context API (`AuthContext`), and integrated TanStack Router context
* **Styling**: Vanilla CSS, Tailwind CSS (v4.2.1), Lucide React icons, and Radix UI primitives
* **Database & Auth**: [Supabase JS Client](https://supabase.com/docs/reference/javascript/introduction) (v2.106.2) for user identities, relational tables, and asset storage buckets
* **Build Tools**: Vite, ESBuild (for testing)

### Backend Stack (C# API Migration)
* **Framework**: ASP.NET Core (.NET 9.0)
* **Language**: C#
* **Architecture**: Clean Architecture (API, Application, Domain, Infrastructure, Worker)
* **Concurrency & Queue**: In-memory thread-safe queues and concurrent dictionaries (simulation layer), with schema-ready migrations for PostgreSQL persistence
* **Build Tools**: dotnet CLI, NuGet
* **Hosted Services**: `BackgroundService` for asynchronous worker loops

### Shared Integrations & Models
* **AI Models**:
  * **OpenAI**: Primary extraction model `gpt-5` (configured via `OPENAI_MODEL_PRIMARY`) and classification model `gpt-4o`
  * **Google Gemini**: Dual-model routing layer (`gemini-2.5-flash` for standard workloads, `gemini-2.5-pro` for heavy contracts, Arabic scripts, and low-confidence retries)
* **APIs**:
  * **OCR.space**: Fallback OCR engine for non-text image uploads (Engine 1 for Arabic, Engine 2 for English)
* **Database**: PostgreSQL (hosted on Supabase)

---

## 3. Folder Structure

### Root Directories
* `src/`: Core TanStack Start React application code
* `backend/`: C# Clean Architecture project files
* `supabase/`: Database configuration, seeds, and SQL migration files
* `tests/`: Frontend validation test suite
* `public/`: Static frontend assets (e.g. sample documents, icons)

### Frontend Directory Detail (`src/`)
```
src/
├── assets/           # Graphics, SVGs, and logo assets
├── components/       # Reusable React components
│   ├── process/      # Document review, segmentation panels, and Tier-3 validation UI
│   ├── projects/     # Project comparison matrix, doc tables, and detail screens
│   ├── ui/           # Custom UI primitives (alert dialogs, aspect ratio, buttons, forms, sidebar)
│   ├── AppHeader.tsx # Universal application navigation bar
│   └── Logo.tsx      # Branded logo SVG component
├── hooks/            # Custom React hooks (e.g., use-mobile.tsx viewport hook)
├── integrations/     # Third-party integrations
│   ├── lovable/      # Internal platform helpers
│   └── supabase/     # Supabase client.ts, server clients, auth middleware, and TS schema types
├── lib/              # Core business libraries and client wrappers
│   ├── auth.tsx      # AuthProvider context provider and session wrapper
│   ├── gemini-client.ts    # Routing layer for Google Gemini API and PDF text extractors
│   ├── openai-client.ts    # Routing layer for OpenAI chat-completions API
│   ├── segment-pages.ts    # Page segment models and visual stitching rules
│   ├── validators.ts       # Comprehensive Tier 1, 2, and 3 validation shield logic
│   ├── workspace-db.ts     # Supabase-specific CRUD operations for documents and splits
│   └── workspace.ts        # Session, document mapping, and state validation wrappers
├── routes/           # TanStack Start file-based routing tree
│   ├── api/          # Serverless edge function API handlers (stream processing, handoffs, classification)
│   ├── auth.tsx      # Login / SignUp / Password Reset routes and UI
│   ├── index.tsx     # Landing page and overview of features
│   ├── process.tsx   # Core single/multi-document interactive processing workspace
│   ├── projects.$projectId.tsx  # Document rollup matrix and settings inside a project
│   ├── projects.index.tsx       # User project workspace dashboard
│   ├── settings.tsx             # Project settings management (e.g., webhook configurations)
│   └── __root.tsx    # Root router configuration and global layouts
├── server.ts         # Nitro server entry-point and SSR exception filter
├── start.ts          # TanStack Start browser entry-point initialization
└── styles.css        # Global CSS stylesheet (design tokens, layout variables, typography)
```

### Backend Directory Detail (`backend/`)
```
backend/
├── src/
│   ├── IVDoc.Api/            # Minimal API controllers, endpoint mapping, routing filters, and auth middlewares
│   ├── IVDoc.Application/    # Use cases, application interfaces, job orchestration services, and domain contracts
│   ├── IVDoc.Domain/         # Core business entities, PageSegmentation rules, and ValidationShield constraints
│   ├── IVDoc.Infrastructure/ # In-memory database records, deterministic extraction logic, queues, and webhook clients
│   └── IVDoc.Worker/         # Standalone console application running the hosted background worker process
└── tests/
    └── IVDoc.Tests/          # Console runner executing unit assertions for IBAN, segment, and key validations
```

---

## 4. Application Architecture

```
User
 │
 ├── [Browser UI] (React Pages & Components)
 │     │
 │     ├── [Client-Side Preprocessing] (Canvas skew correction & resizing)
 │     └── [Supabase JS Client] ───────────┐
 │                                         │
 ├── [Programmatic API]                    │
 │     │                                   │
 ├── [ASP.NET Core API (/v1)]              │
 │     │                                   │
 ├──   ├── [Hosted Background Worker]      │
 │     │     │                             │
 │     │     └── [Extraction Engine]       │
 │     │                                   │
 └─────┴─────────────────┬─────────────────┘
                         │
                  [PostgreSQL / Supabase]
                         │
         ┌───────────────┴───────────────┐
         ▼                               ▼
  [AI Providers]                  [External APIs]
  - OpenAI GPT-5                  - OCR.space API
  - Gemini 2.5 (Flash/Pro)        - Project Webhooks (HMAC-SHA256)
```

### Description of Request Flow
1. **Frontend Request Flow (Web-App)**:
   * The user uploads a file (PDF/Image) on the [process.tsx](file:///Users/deepak/Desktop/iv-docs-feature-backend/src/routes/process.tsx) page.
   * Visual files are preprocessed client-side (rotated, deskewed, and resized) using [image-preprocess.ts](file:///Users/deepak/Desktop/iv-docs-feature-backend/src/lib/image-preprocess.ts) to bypass cloud Sharp bindings limit.
   * The frontend calls `/api/process-stream` which streams step-by-step progress events (SSE).
   * Inside [process-stream.ts](file:///Users/deepak/Desktop/iv-docs-feature-backend/src/routes/api/process-stream.ts), active validation templates are queried from Supabase.
   * If a PDF is attached, Gemini Pro or OpenAI is triggered to extract raw page text. Images go to OCR.space if direct text isn't available.
   * The text/image content is evaluated by OpenAI or Gemini using structured function calls (`emit_extraction`).
   * Extracted fields undergo local Tier-1 and Tier-2 sanity checks in [validators.ts](file:///Users/deepak/Desktop/iv-docs-feature-backend/src/lib/validators.ts). Page numbers are stitched into cohesive document segments.
   * Results are saved to Supabase `project_documents`. The browser receives the structured payload, updates the state, and shows the extraction results.

2. **Backend Request Flow (C# programmatic endpoints)**:
   * Client sends a HTTP POST request containing document payload to `/v1/jobs` with an API key or Bearer JWT token.
   * The endpoint validates request scope, creates a `JobRecord` inside `InMemoryPlatformStore`, and pushes the job ID onto `InMemoryProcessingQueue`.
   * A HTTP 202 Accepted status is immediately returned containing result and event stream URLs.
   * The background `ProcessingWorkerService` dequeues the job ID, invokes `DocumentProcessingService.ProcessAsync`, and transitions status to `Running`.
   * It uses `DeterministicExtractionEngine` to mock or parse the text (or fallback).
   * Runs C# `ValidationShield` and `PageSegmentationService` validations.
   * Marks the job as `Succeeded` (saving results to `InMemoryPlatformStore`), and emits events to any connected stream clients via `/v1/jobs/{jobId}/events`.

---

## 5. Features

### Core Extraction & Digitization
* **Multilingual Parsing**: Full compatibility with English and Arabic characters. Normalizes Eastern Arabic digits (٠-٩) to Western Arabic digits (0-9). Supports Hijri to Gregorian date parsing.
* **Intelligent Model Selection**: Dynamically selects between `gemini-2.5-flash` and `gemini-2.5-pro` based on document complexity (e.g. legal contracts, bank statements), language (Arabic default is Pro), and low confidence scores (< 0.75) for auto-retry.
* **Client-Side Preprocessing**: Corrects document skewness, performs contrast stretching, converts images to greyscale, and scales to a target width of 1200px prior to transmission.
* **Consolidated Page Segmentation**: Analyzes individual pages of multi-document PDFs to detect document boundaries (start, continuation, end) using visual cover detection and printed page-counter resets.

### Validation Engine (Three-Tier Shield)
* **Tier 1 (Field Sanity)**: Hard validation constraints. Parses and checks IBAN mod-97 checksums, SWIFT/BIC formats, ISO currency formats, dates, and matches template-defined regex rules.
* **Tier 2 (Document Consistency)**: Evaluates relationships within a single document (e.g. self-transfers checking token overlap between sender and beneficiary; AML transaction thresholds for amounts exceeding $1,000,000; expiration checks on ID documents).
* **Tier 3 (Package Triangulation)**: Reconciles values across multiple files in a single session (e.g. comparing applicant name consistency across passport and pay stub; matching bank statement deposits with salary slip net pay).

### Verification & Workspace Tools
* **Manual Review / Exception Queue**: Visual warning states for unvalidated entries. Supports field-level correction, rejection reasons, override auditing, and saves audit trails in `document_override_history`.
* **Project Dashboard**: Groups files into project spaces. Compares key indicators in a matrix grid across all documents in a project.
* **Secure Webhook Deliveries**: Auto-signs payloads with SHA256 HMAC utilizing project secrets and transmits JSON structure to external target URLs, recording outcomes in `webhook_deliveries`.

---

## 6. API Documentation

Authentication is required for all public `/v1` endpoints (either via header `X-IVDoc-API-Key: <key>` or `Authorization: Bearer <jwt/key>`).

### Backend Core endpoints (`IVDoc.Api`)

| Method | Route | Purpose | Request Body | Response Body | Required Scope |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **POST** | `/v1/jobs` | Submit a document-processing job | JSON (`kind`, `fileName`, `mimeType`, `base64`/`text`, `projectId`, `idempotencyKey`) or Multipart Form | JSON (`jobId`, `sessionId`, `status`, `eventsUrl`, `resultUrl`) | `jobs:write` |
| **GET** | `/v1/jobs/{jobId}` | Query status and progress of a job | None | JSON (`id`, `sessionId`, `projectId`, `status`, `currentStep`, `progress`, `error`, `createdAt`, `updatedAt`) | Authenticated |
| **GET** | `/v1/jobs/{jobId}/result` | Fetch normalized results once done | None | JSON (`ProcessedDocument` model if completed, else 202 status) | Authenticated |
| **GET** | `/v1/jobs/{jobId}/events` | Stream live processing steps | Query param `after` (sequence ID) | SSE Stream or NDJSON (`application/x-ndjson`) | Authenticated |
| **POST** | `/v1/sessions` | Create a multi-document session package | JSON (`projectId`, `name`, `documentIds`) | JSON (`id`, `projectId`, `name`, `documents`, `packageValidation`, `packageDecision`) | `sessions:write` |
| **GET** | `/v1/sessions/{sessionId}` | Retrieve a package and run validation | None | JSON (`SessionRecord` matching ID) | `sessions:read` |
| **POST** | `/v1/documents/{documentId}/review` | Record manual override or approval | JSON (`action` = 'approve'/'reject', `correctedFields`, `note`) | JSON (`ProcessedDocument` updated) | `documents:review` |
| **POST** | `/v1/handoffs/{sessionId}` | Forward approved package to project webhook | None | JSON (`ok` status, `statusCode` from hook, `error` if any) | Authenticated |
| **GET** | `/v1/projects/{projectId}` | Query project webhook settings | None | JSON (`id`, `userId`, `name`, `description`, `webhookUrl`, `webhookSecret`) | Authenticated |
| **PATCH** | `/v1/projects/{projectId}` | Update project webhook and options | JSON (`webhookUrl`, `webhookSecret`) | JSON (`ProjectRecord` updated) | Authenticated |
| **POST** | `/v1/api-keys` | Generate a project-scoped API key | JSON (`projectId`, `name`, `scopes`, `rateLimitPerMinute`, `expiresAt`) | JSON (`id`, `projectId`, `prefix`, `secret`, `scopes`, `rateLimitPerMinute`) | Authenticated |
| **POST** | `/v1/api-keys/{keyId}/revoke` | Revoke active API key | None | JSON (`revoked` = true) | Authenticated |
| **GET** | `/health` | Verify API health status | None | JSON (`ok` = true, `service` = "ivdoc-api", `time`) | Public |
| **GET** | `/openapi/v1.json` | Fetch OpenAPI specification | None | JSON (OpenAPI v3 schema) | Public |

### Frontend Nitro API endpoints (`src/routes/api/`)

| Method | Route | Purpose | Request Body | Response Body | Authentication |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **POST** | `/api/process-stream` | Coordinate OCR + LLM and save results | JSON (`kind`, `fileName`, `mimeType`, `base64`, `images`) | Event Stream (SSE) | Bearer JWT (Supabase) |
| **POST** | `/api/classify-page` | Classify segment type for page boundary detection | JSON (`image_base64`, `mime_type`) | JSON (`type` = classification slug) | Bearer JWT (Supabase) |
| **POST** | `/api/preprocess-image` | Fallback image preprocessing properties | JSON (`image_base64`, `mime_type`) | JSON (`processed_base64`, skew/dimensions) | Bearer JWT (Supabase) |
| **POST** | `/api/handoff/$sessionId` | Trigger project webhook for web app UI | None | JSON (`ok`, `status_code`, `error`) | Bearer JWT (Supabase) |

---

## 7. AI Integration

The platform handles document extraction using highly customized system instructions and tool-calling interfaces:

* **AI Providers Used**: 
  * **OpenAI**: Connects to `https://api.openai.com/v1/chat/completions` using the `OPENAI_API_KEY`. Defaults to the `gpt-5` model (`OPENAI_MODEL_PRIMARY`).
  * **Google Gemini**: Connects to the OpenAI-compatible endpoint `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` and the native `generateContent` endpoint using `GEMINI_API_KEY`.
* **Call Locations**:
  * **Frontend**: API stream requests initiate calls inside [process-stream.ts](file:///Users/deepak/Desktop/iv-docs-feature-backend/src/routes/api/process-stream.ts) through client helper functions [openai-client.ts](file:///Users/deepak/Desktop/iv-docs-feature-backend/src/lib/openai-client.ts) and [gemini-client.ts](file:///Users/deepak/Desktop/iv-docs-feature-backend/src/lib/gemini-client.ts).
  * **Backend**: Extensible interface `IDocumentExtractionEngine` defaults to `DeterministicExtractionEngine.cs` in local in-memory runs.
* **Prompt Construction**:
  * The system prompt defines extraction directives (e.g. converting Indic numbers, reading right-to-left, formatting dates to ISO format). It injects expected schema definitions based on the document type (account opening, remittance, etc.).
  * Image payloads are structured using multimodal content syntax (`image_url` containing base64 data). 
  * To avoid context window limits on multi-page files, the vision payload is divided into batches of 6 pages (`VISION_API_BATCH_SIZE`) before processing.
* **Response Processing**: 
  * The model is forced to call the `emit_extraction` tool function.
  * Arguments from the tool call are parsed into fields, confidence values, page metadata, and field details (legible vs redacted vs not present).
* **Streaming**: Progress updates (e.g. `ocr_start`, `classified`, `ocr_done`, `validate_start`, `validated`, `done`) are flushed back to the client using a server-sent events stream (`text/event-stream`).
* **API Key Management**: Managed through local `.env` variables (`OPENAI_API_KEY`, `GEMINI_API_KEY`). On the public backend, keys are authenticated against `api_keys` records stored in the database.

---

## 8. State Management

The frontend application coordinates route contexts, asynchronous mutations, and local state transitions:

* **TanStack Query (React Query)**:
  * Initialized in [router.tsx](file:///Users/deepak/Desktop/iv-docs-feature-backend/src/router.tsx) (`const queryClient = new QueryClient()`).
  * Injected as a route context provider in [__root.tsx](file:///Users/deepak/Desktop/iv-docs-feature-backend/src/routes/__root.tsx) (`QueryClientProvider`).
  * Primary data fetching is currently managed through React lifecycle hooks (`useEffect`) and custom wrappers inside [workspace-db.ts](file:///Users/deepak/Desktop/iv-docs-feature-backend/src/lib/workspace-db.ts) and [projects.ts](file:///Users/deepak/Desktop/iv-docs-feature-backend/src/lib/projects.ts).
* **Context API**:
  * **`AuthContext`** ([auth.tsx](file:///Users/deepak/Desktop/iv-docs-feature-backend/src/lib/auth.tsx)): Exposes user verification states, auth session tokens, and logout hooks globally.
* **React State & Caching**:
  * Local states track processing results, validation lists, user overrides, and template definitions directly inside components (e.g., `process.tsx`, `projects.index.tsx`).
* **Mutations & Invalidation**:
  * Field edits automatically trigger immediate database updates via `supabase.from('project_documents').update()`. 
  * Following an update, local states are refreshed via callback loops (e.g. `refresh()`), sync'ing corrections immediately with project matrix rollups.
* **Optimistic Updates**:
  * Field corrections are updated optimistically in local component states so that the form feels highly responsive before the database transaction completes.

---

## 9. Authentication Flow

```
1. Login / Sign Up Request
User ──► [auth.tsx UI Form] ──► [Supabase Auth API]
                                       │
                                       ▼ (Creates JWT Session)
2. JWT Persistent Storage
[Local Storage] ◄── [Browser Client State] ◄── [onAuthStateChange Listener]

3. Server Authorization
User Request ──► [Authorization: Bearer <JWT>] ──► [auth-middleware.ts / ApiAuth.cs]
                                                           │
                                                           ▼ (Parses Claims)
                                                    Access Allowed
```

### Authentication Flow Stages
1. **Login & SignUp**:
   * Handled by [auth.tsx](file:///Users/deepak/Desktop/iv-docs-feature-backend/src/routes/auth.tsx) using the Supabase client:
     * Sign In: `supabase.auth.signInWithPassword({ email, password })`.
     * Sign Up: `supabase.auth.signUp({ email, password, options: { emailRedirectTo } })`.
     * Password Reset: `supabase.auth.resetPasswordForEmail(email)`.
2. **Session Persistence**:
   * Token storage is delegated to browser `localStorage` (via the Supabase client) on the client side.
   * On mount, `AuthProvider` calls `supabase.auth.getSession()` to load active sessions, while `supabase.auth.onAuthStateChange` listens for subsequent login/logout events.
3. **Authorization & Server Verification**:
   * **Frontend Server Functions**: The `requireSupabaseAuth` middleware in [auth-middleware.ts](file:///Users/deepak/Desktop/iv-docs-feature-backend/src/integrations/supabase/auth-middleware.ts) intercepts requests, extracts the JWT Bearer token, fetches claims via `supabase.auth.getClaims(token)`, and validates the user identifier (`sub`).
   * **C# Backend APIs**: The [ApiAuth.cs](file:///Users/deepak/Desktop/iv-docs-feature-backend/backend/src/IVDoc.Api/ApiAuth.cs) middleware handles authorization headers:
     * Integrations authenticate via `X-IVDoc-API-Key` headers or API key Bearer tokens starting with `ivdoc_`. The key is hashed and matched against active database records in `api_keys`.
     * Users authenticate using JWT Bearer tokens. The service parses the token's payload, extracting the `sub` or `user_id` claim.

---

## 10. Database

The platform stores persistent data in **Supabase PostgreSQL** and manages asset uploads through custom RLS policy blocks.

### Database Tables Schema

#### `profiles`
* Stores user profile information, auto-created via trigger function `handle_new_user` on auth signups.
* **Columns**: `id` (UUID PK), `user_id` (UUID FK to `auth.users`), `display_name` (TEXT), `created_at`, `updated_at`.

#### `projects`
* User-defined workspace grouping related documents.
* **Columns**: `id` (UUID PK), `user_id` (UUID FK to `auth.users`), `name` (TEXT), `description` (TEXT), `webhook_url` (TEXT), `webhook_secret` (TEXT), `created_at`, `updated_at`.

#### `project_documents`
* Stores extracted document fields, confidence values, page segmentations, and audit reviews.
* **Columns**: 
  * `id` (UUID PK), `project_id` (UUID FK to `projects`), `user_id` (UUID FK to `auth.users`)
  * `file_name` (TEXT), `mime_type` (TEXT), `file_size` (INT), `status` (TEXT), `document_type` (TEXT)
  * `classification_confidence` (NUMERIC), `language` (TEXT), `raw_text` (TEXT)
  * `fields` (JSONB), `field_confidence` (JSONB), `validation` (JSONB), `corrected_fields` (JSONB)
  * `decision` (TEXT), `decision_reason` (TEXT), `error` (TEXT)
  * `session_id` (UUID FK to `processing_sessions`), `template_id` (UUID FK to `templates`)
  * `review_status` (TEXT), `review_note` (TEXT), `reviewed_at` (TIMESTAMPTZ)
  * `template_fingerprint` (JSONB), `override_history` (JSONB), `preprocessing` (JSONB)
  * `page_count` (INT), `storage_path` (TEXT), `pages` (JSONB), `page_info` (JSONB), `segments` (JSONB)

#### `processing_sessions`
* Groups document extractions into a single package to run cross-document checks.
* **Columns**: `id` (UUID PK), `project_id` (UUID FK to `projects`), `user_id` (UUID FK to `auth.users`), `name` (TEXT), `package_validation` (JSONB), `package_decision` (TEXT), `package_decision_reason` (TEXT), `created_at`, `updated_at`.

#### `templates`
* Form schemas with validation rules, regex patterns, and coordinates for structured document classification.
* **Columns**: `id` (UUID PK), `template_key` (TEXT UNIQUE), `name` (TEXT), `document_type` (TEXT), `version` (INT), `fields` (JSONB), `anchor_keywords` (JSONB), `coordinate_regions` (JSONB), `regex_patterns` (JSONB), `active` (BOOLEAN), `created_at`, `updated_at`.

#### `document_override_history`
* Audit logs for corrections and manual approvals.
* **Columns**: `id` (UUID PK), `document_id` (UUID FK to `project_documents`), `session_id` (UUID FK to `processing_sessions`), `user_id` (UUID FK to `auth.users`), `action` (TEXT), `before_fields` (JSONB), `after_fields` (JSONB), `note` (TEXT), `created_at`.

#### `webhook_deliveries`
* Delivery log of handoff requests dispatched to external systems.
* **Columns**: `id` (UUID PK), `project_id` (UUID FK to `projects`), `session_id` (UUID FK to `processing_sessions`), `user_id` (UUID FK to `auth.users`), `status_code` (INT), `success` (BOOLEAN), `error` (TEXT), `request_body` (JSONB), `created_at`.

#### `documents` & `document_splits`
* Tables for tracking uploaded raw files and their visual split boundaries.
* **Columns (`documents`)**: `id` (UUID PK), `user_id` (UUID FK), `original_filename` (TEXT), `storage_path` (TEXT), `doc_type` (TEXT), `status` (TEXT), `page_count` (INT), `uploaded_at`.
* **Columns (`document_splits`)**: `id` (UUID PK), `parent_document_id` (UUID FK), `user_id` (UUID FK), `segment_type` (TEXT), `page_range` (TEXT), `storage_path` (TEXT), `extracted_fields` (JSONB), `page_start` (INT), `page_end` (INT), `document_type` (TEXT), `confidence` (NUMERIC), `status` (TEXT), `signals` (JSONB), `needs_review` (BOOLEAN), `created_at`.

#### `api_keys` (Backend specific table)
* Scope configuration and rate limits for client integrations.
* **Columns**: `id` (UUID PK), `project_id` (UUID FK to `projects`), `user_id` (UUID FK to `auth.users`), `name` (TEXT), `key_prefix` (TEXT UNIQUE), `key_hash` (TEXT UNIQUE), `scopes` (JSONB), `status` (TEXT), `rate_limit_per_minute` (INT), `last_used_at`, `expires_at`, `revoked_at`, `created_at`, `updated_at`.

#### `processing_jobs` & `processing_events` (Backend specific tables)
* Background processing queue state and event tracking.
* **Columns (`processing_jobs`)**: `id` (UUID PK), `project_id` (UUID FK), `session_id` (UUID FK), `user_id` (UUID FK), `idempotency_key` (TEXT), `input_metadata` (JSONB), `storage_path` (TEXT), `status` (TEXT), `current_step` (TEXT), `progress` (INT), `options` (JSONB), `error` (TEXT), `result_document_id` (UUID FK), `result` (JSONB), `locked_by` (TEXT), `locked_at` (TIMESTAMPTZ), `completed_at` (TIMESTAMPTZ), `created_at`, `updated_at`.
* **Columns (`processing_events`)**: `id` (BIGSERIAL PK), `job_id` (UUID FK), `sequence` (INT), `step` (TEXT), `message` (TEXT), `payload` (JSONB), `created_at`.

---

### Storage Buckets & Policies
The application uses two buckets in Supabase Storage:
1. **`projects`**: Houses documents used in team workspaces. Path template: `{project_id}/corpus/{document_id}/{timestamp}.{ext}`. RLS policies allow access only if the authenticated user owns the related project record.
2. **`documents`**: Houses staging/split documents. Path template: `{user_id}/{filename}`. RLS policies restrict operations to matching user folder paths (`(storage.foldername(name))[1] = auth.uid()`).

---

### File Upload & Processing Flow
```
User File Choice
  │
  ▼
[Canvas Preprocessing] (Skew, gray, resize to 1200px)
  │
  ▼
[Supabase Storage Upload] ──► Saved in 'documents' bucket
  │
  ▼
[DB metadata insert] ──► Row added in 'project_documents' with status = 'pending'
  │
  ▼
[Stream processing API] ──► Invoked with base64 / path
  │
  ▼
[DB status update] ──► Status updated to 'done' (or error saved)
```

---

## 11. Environment Variables

| Variable Name | Purpose | Example / Default |
| :--- | :--- | :--- |
| `SUPABASE_URL` | Endpoint URL of the Supabase project | `https://xxxx.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | Public API key for browser integrations | `eyJhbGciOi…` |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin bypass key (used server-side for logs) | `eyJhbGciOi…` |
| `OPENAI_API_KEY` | Authentication key for OpenAI completion requests | `sk-proj-…` |
| `OPENAI_MODEL_PRIMARY` | Model used for primary document extraction | `gpt-5` |
| `OPENAI_TIMEOUT_MS` | API request timeout limit for standard runs | `90000` |
| `OPENAI_PDF_TIMEOUT_MS` | API request timeout limit for PDF extraction | `180000` |
| `GEMINI_API_KEY` | Authentication key for Google Gemini requests | `AIzaSy…` |
| `GEMINI_MODEL_FLASH` | Fast model variant for standard extractions | `gemini-2.5-flash` |
| `GEMINI_MODEL_PRO` | High-fidelity model for complex/Arabic documents | `gemini-2.5-pro` |
| `GEMINI_TIMEOUT_MS` | API request timeout limit for standard runs | `90000` |
| `GEMINI_PDF_TIMEOUT_MS` | API request timeout limit for PDF extraction | `180000` |
| `OCR_SPACE_API_KEY` | API key for the fallback OCR.space engine | `helloworld` |
| `OCR_SPACE_LANGUAGE` | Default language for fallback OCR | `eng` |
| `OCR_SPACE_ENGINE` | Default processing engine for fallback OCR | `2` |

---

## 12. Installation

### Prerequisites
* **Node.js**: Version 20.x or newer (configured in `.nvmrc`)
* **Bun**: Recommended package manager (configured via `bun.lock` / `bunfig.toml`), or `npm` (configured via `package-lock.json`)
* **.NET Core SDK**: Version 9.0 or newer (for backend C# services)

---

### Step-by-Step Setup

#### 1. Clone the Repository
```bash
git clone <repository_url>
cd iv-docs-feature-backend
```

#### 2. Configure Environment Variables
Copy `.env.example` to `.env` and fill in your keys:
```bash
cp .env.example .env
```
Ensure you provide `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and at least one LLM key (`OPENAI_API_KEY` or `GEMINI_API_KEY`).

#### 3. Install Frontend Dependencies
```bash
# Using bun:
bun install

# Or using npm:
npm install
```

#### 4. Setup Database Schema (Supabase Local Development)
If you have the Supabase CLI configured locally:
```bash
supabase start
supabase db reset
```
Otherwise, execute the migrations in `supabase/migrations/` sequentially on your remote Supabase instance.

#### 5. Run the Frontend App
```bash
# Using bun:
bun dev

# Or using npm:
npm run dev
```
The application will start on `http://localhost:3000` (or the next available port).

#### 6. Build and Run the Backend API
Open a separate terminal window and navigate to the backend directory:
```bash
cd backend
dotnet build
dotnet run --project src/IVDoc.Api/IVDoc.Api.csproj
```
The REST API will boot on `http://localhost:5000` (or `https://localhost:5001`).

---

## 13. Build and Deployment

### Development
* **Frontend**: Auto-reload via Vite: `npm run dev`.
* **Backend**: Build and run projects locally using `dotnet run`. The default storage is the in-memory database simulation (`InMemoryPlatformStore.cs`).

### Production
* **Frontend**: 
  * The production build compiles static client files and maps Nitro routes:
    ```bash
    npm run build
    ```
  * Deploy using the built-in Cloudflare wrangler adapter (`wrangler.jsonc`) or Node.js SSR runtime options.
* **Backend**:
  * Build the production binary:
    ```bash
    dotnet publish -c Release -o ./publish
    ```
  * Run the executable in an environment configured with a PostgreSQL connection string. The production migration `20260625090000_csharp_api_backend_jobs.sql` must be applied to database schemas beforehand.

---

## 14. Current Architecture Diagram

```
[Browser (React Web Application)]
        │
        ├── (Supabase client.ts) ──────────► [Supabase DB / Auth / Storage]
        │
        ├── (REST API Requests) ───────────► [Frontend server.ts (Nitro Edge)]
        │                                            │
        │                                            ├──► [OpenAI (gpt-5)]
        │                                            ├──► [Gemini (2.5 flash/pro)]
        │                                            └──► [OCR.space API]
        │
[Integrations / B2B Clients]
        │
        └── (REST API /v1 Envelopes) ──────► [C# Backend (IVDoc.Api)]
                                                     │
                                                     ├──► [Hosted Worker]
                                                     └──► [In-Memory Stores]
```

---

## 15. Code Flow

Below is the step-by-step code flow of the **Document Upload and Processing** feature:

```
[User Action]
Drag/drop file in UI (process.tsx)
      │
      ▼
[Client Preprocessing]
Image resized and deskewed (image-preprocess.ts)
      │
      ▼
[Storage Upload]
Uploads to Supabase bucket 'documents' (workspace-db.ts)
      │
      ▼
[Metadata Registration]
Inserts 'pending' row in public.project_documents (workspace-db.ts)
      │
      ▼
[Processing Call]
Invokes server handler POST /api/process-stream (process-stream.ts)
      │
      ▼
[LLM Call]
Sends base64 to OpenAI gpt-5 or Gemini 2.5 Pro (openai-client.ts / gemini-client.ts)
      │
      ▼
[Tool Call Output]
Model returns structured JSON arguments via 'emit_extraction' tool call
      │
      ▼
[Validation Shield Execution]
Evaluates fields against Tiers 1 & 2 rules (validators.ts)
      │
      ▼
[Page Stitching]
Stitches multi-page boundaries into segments (segment-pages.ts)
      │
      ▼
[DB Final Sync]
Updates project_documents row status = 'done', saving fields (workspace-db.ts)
      │
      ▼
[UI Rerender]
UI receives completed payload via SSE and displays results (process.tsx)
```

---

## 16. External Services

1. **OpenAI**: Hosts the primary extraction models (`gpt-5`, `gpt-4o`) for document classification and structured key-value extraction.
2. **Google Gemini**: Hosts `gemini-2.5-flash` and `gemini-2.5-pro` for document parsing, PDF text extractions, and retries.
3. **OCR.space**: Cloud OCR API used to extract text from images when native PDF/text formats are unavailable.
4. **Supabase**: Relational database (PostgreSQL), user authentication provider, and file hosting buckets.

---

## 17. Security

* **Authentication (AuthN)**: 
  * The frontend client signs requests using Supabase user JWT sessions.
  * The backend API uses standard Bearer JWT signatures or secure, hashed programmatic api keys (`api_keys`).
* **Authorization (AuthZ)**: 
  * **Database**: Row Level Security (RLS) is enabled on all tables in Supabase. Policies restrict select/insert/update operations to rows matching the authenticated user's ID (`auth.uid() = user_id`).
  * **API**: Endpoint execution scopes (e.g. `jobs:write`, `sessions:read`) restrict api-key actions.
* **Secrets Management**: 
  * Private integration tokens are kept secure in environment variables (`.env` or Cloudflare Environment Bindings) and are never exposed to browser bundles.
* **Client vs. Server Responsibilities**:
  * **Client**: Preprocesses images, manages authentication states, and displays validation results.
  * **Server**: Executes API calls to OpenAI/Gemini/OCR.space, verifies user claims, performs validation checks, and saves data to PostgreSQL.
* **Security Concerns**:
  * The development token parser in the C# API projects accepts unsigned Developer tokens (`Bearer dev`) when running locally. This feature must be disabled in production configurations.
  * Webhook handlers should always verify incoming `X-IVDoc-Signature` headers on receiver endpoints to prevent request spoofing.

---

## 18. Performance

* **Lazy Loading**: Route pages are split dynamically using TanStack Start’s file-based router to minimize browser bundle footprint.
* **Multimodal Batching**:Vision model API calls are batch-processed (`VISION_API_BATCH_SIZE = 6`) to prevent context window truncation.
* **Client-Side Image Operations**: Preprocessing (e.g. skew correction, greyscale filtering, resizing) is executed client-side inside canvas objects. This reduces network payloads and avoids native serverless dependency limits.
* **Indexing**: PostgreSQL indexes are set up on foreign keys (e.g. `idx_project_documents_project`, `idx_api_keys_user`, `idx_webhook_deliveries_session`) to ensure fast queries on complex joins.

---

## 19. Known Issues

* **C# Store Adapter Mock**: The C# backend project utilizes an in-memory storage dictionary simulation (`InMemoryPlatformStore.cs`). This means backend state is lost on application restarts. A production Supabase/PostgreSQL adapter must be implemented to replace this.
* **OCR.space Fallback Limitations**: The fallback OCR engine (OCR.space Engine 2) does not support Arabic text. If Arabic documents fail to process using OpenAI or Gemini, Engine 1 must be configured explicitly.
* **Cloudflare Edge Sharp Binding Restriction**: Native Node.js image packages (like `sharp`) are not supported on Cloudflare workerd runtimes. Consequently, server-side image preprocessing is unavailable on Cloudflare Edge deployments.

---

## 20. Future Improvements

1. **C# Database Adapter**: Replace the in-memory dictionary stores with a Postgres/Supabase adapter that implements the existing `IProcessingJobStore`, `ISessionStore`, `IProjectStore`, and `IApiKeyStore` interfaces.
2. **Hosted OCR Wrappers**: Wrap or replace `DeterministicExtractionEngine` in the C# API project with production-ready cloud LLM/OCR clients.
3. **Advanced Image Preprocessing**: Integrate server-side deskew and image rotation tools using cloud-compatible libraries to support non-browser processing flows.

---

## 21. Glossary

* **Project**: A user-defined workspace workspace that groups related documents.
* **Session (or Package)**: A collection of documents grouped to run Tier-3 package validation checks.
* **Tier 1 Validation**: Basic sanity checks (e.g. OCR char limits, required fields, format checks like IBAN checksums).
* **Tier 2 Validation**: Rules verifying relationships between fields within a single document (e.g. sender != beneficiary).
* **Tier 3 Validation**: Consistency rules verifying relationships across multiple documents in a package (e.g. name matching).
* **Exception Queue**: A staging queue for documents that have failed validation rules or have low classification confidence, awaiting human review.
* **Handoff**: Dispatches verified session documents to external systems via POST webhooks.
* **Fuzzy Token Overlap**: A comparison metric that tokenizes name strings and calculates how many words overlap, used to identify inconsistencies.
