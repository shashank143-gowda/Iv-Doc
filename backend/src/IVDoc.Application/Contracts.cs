using IVDoc.Domain;

namespace IVDoc.Application;

public static class JobStatus
{
    public const string Queued = "queued";
    public const string Running = "running";
    public const string Succeeded = "succeeded";
    public const string Failed = "failed";
    public const string Canceled = "canceled";
}

public sealed record ImagePayload
{
    public string MimeType { get; init; } = "image/png";
    public string Base64 { get; init; } = "";
}

public sealed record ProcessingInput
{
    public string Kind { get; init; } = "text";
    public string FileName { get; init; } = "document.txt";
    public string? MimeType { get; init; }
    public string? Base64 { get; init; }
    public List<ImagePayload> Images { get; init; } = [];
    public string? Text { get; init; }
    public bool ForceArabic { get; init; }
    public int? PageCount { get; init; }
    public string? ProjectId { get; init; }
    public string? SessionId { get; init; }
    public string? IdempotencyKey { get; init; }
    public Dictionary<string, object?> Options { get; init; } = new(StringComparer.OrdinalIgnoreCase);
}

public sealed record JobAcceptedResponse(
    string JobId,
    string SessionId,
    string Status,
    string EventsUrl,
    string ResultUrl);

public sealed record JobStatusResponse(
    string JobId,
    string? SessionId,
    string? ProjectId,
    string Status,
    string CurrentStep,
    int Progress,
    string? Error,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public sealed record CreateSessionRequest
{
    public string? ProjectId { get; init; }
    public string? Name { get; init; }
    public List<ProcessedDocument> Documents { get; init; } = [];
}

public sealed record SessionResponse
{
    public string Id { get; init; } = Guid.NewGuid().ToString("N");
    public string? ProjectId { get; init; }
    public string UserId { get; init; } = "";
    public string Name { get; init; } = "IV Doc Package";
    public DateTimeOffset CreatedAt { get; init; }
    public DateTimeOffset UpdatedAt { get; init; }
    public List<ProcessedDocument> Documents { get; init; } = [];
    public PackageValidation PackageValidation { get; init; } = new([], Decision.AutoApprove, "");
    public string PackageDecision { get; init; } = Decision.AutoApprove;
    public string PackageDecisionReason { get; init; } = "";
}

public sealed record ReviewDocumentRequest
{
    public string Action { get; init; } = "approve_override";
    public Dictionary<string, object?> CorrectedFields { get; init; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, object?> BeforeFields { get; init; } = new(StringComparer.OrdinalIgnoreCase);
    public string? Note { get; init; }
    public string? SessionId { get; init; }
}

public sealed record ReviewDocumentResponse(
    string DocumentId,
    string ReviewStatus,
    string? Note,
    DateTimeOffset ReviewedAt);

public sealed record ProjectSettingsRequest
{
    public string? Name { get; init; }
    public string? Description { get; init; }
    public string? WebhookUrl { get; init; }
    public string? WebhookSecret { get; init; }
}

public sealed record ProjectResponse
{
    public string Id { get; init; } = "";
    public string UserId { get; init; } = "";
    public string Name { get; init; } = "IV Doc Project";
    public string? Description { get; init; }
    public string? WebhookUrl { get; init; }
    public bool HasWebhookSecret { get; init; }
    public DateTimeOffset CreatedAt { get; init; }
    public DateTimeOffset UpdatedAt { get; init; }
}

public sealed record ApiKeyCreateRequest
{
    public string ProjectId { get; init; } = "";
    public string? Name { get; init; }
    public List<string> Scopes { get; init; } = ["jobs:write", "jobs:read", "sessions:write", "sessions:read"];
    public int RateLimitPerMinute { get; init; } = 60;
    public DateTimeOffset? ExpiresAt { get; init; }
}

public sealed record ApiKeyCreateResponse(
    string Id,
    string ProjectId,
    string Prefix,
    string Secret,
    IReadOnlyList<string> Scopes,
    int RateLimitPerMinute);

public sealed record HandoffResponse(
    bool Ok,
    int? StatusCode,
    string? Error);

public sealed record AuthenticatedCaller(
    string UserId,
    string? ProjectId,
    string AuthType,
    IReadOnlySet<string> Scopes);
