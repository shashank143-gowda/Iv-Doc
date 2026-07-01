# IV Doc C# API Backend

This is the parallel ASP.NET Core backend for the IV Doc API migration. It keeps the current React/TanStack app intact while introducing a versioned, job-first public API.

## Projects

- `IVDoc.Api`: public `/v1` HTTP API, auth, rate limits, health, and OpenAPI JSON.
- `IVDoc.Application`: job/session/review/project/handoff orchestration.
- `IVDoc.Domain`: DTO-independent validation, decisions, page segmentation, and package validation.
- `IVDoc.Infrastructure`: in-memory local stores, deterministic extraction adapter, queue, worker, and webhook client.
- `IVDoc.Worker`: standalone worker host scaffold for a future Postgres-backed queue.
- `IVDoc.Tests`: dependency-light console test runner for parity and contract checks.

## Run Locally

```powershell
cd backend
dotnet run --project src\IVDoc.Api\IVDoc.Api.csproj
```

Use a development bearer token while local:

```http
Authorization: Bearer dev
```

The local infrastructure adapter is in-memory. It is intentionally swappable; the Supabase/Postgres migration in `supabase/migrations/20260625090000_csharp_api_backend_jobs.sql` adds the production tables for API keys, processing jobs, and reconnectable events.

## Core Endpoints

- `POST /v1/jobs`: create an async document-processing job from JSON or multipart upload.
- `GET /v1/jobs/{jobId}`: check queued/running/succeeded/failed status.
- `GET /v1/jobs/{jobId}/events`: stream SSE by default, or NDJSON with `Accept: application/x-ndjson`.
- `GET /v1/jobs/{jobId}/result`: fetch normalized extraction result.
- `POST /v1/sessions`: save a multi-document package and run package/Tier-3 validation.
- `GET /v1/sessions/{sessionId}`: fetch stored package.
- `POST /v1/documents/{documentId}/review`: approve override or reject.
- `POST /v1/handoffs/{sessionId}`: deliver approved session to project webhook.
- `GET/PATCH /v1/projects/{projectId}`: project webhook/settings.
- `POST /v1/api-keys`: create a project-scoped external API key.
- `POST /v1/api-keys/{keyId}/revoke`: revoke a key.

## Example

```powershell
$body = @{
  kind = "text"
  fileName = "swift_mt103.txt"
  mimeType = "text/plain"
  text = "Sender: Apex Logistics`nBeneficiary: Gulf Trading`nIBAN AE070331234567890123456`nBIC EBILAEAD`nAmount: AED 12500`nDate: 2026-06-25"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:5000/v1/jobs" `
  -Headers @{ Authorization = "Bearer dev" } `
  -ContentType "application/json" `
  -Body $body
```

OpenAPI JSON is available at `/openapi/v1.json`.

## Next Adapter Work

The current implementation is executable and contract-shaped, but production persistence should replace the in-memory stores with a Postgres/Supabase adapter that implements the same `IProcessingJobStore`, `ISessionStore`, `IProjectStore`, and `IApiKeyStore` interfaces. OCR/model providers should replace or wrap `DeterministicExtractionEngine` behind `IDocumentExtractionEngine`.
