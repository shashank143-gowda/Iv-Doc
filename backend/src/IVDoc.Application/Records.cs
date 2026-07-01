using IVDoc.Domain;

namespace IVDoc.Application;

public sealed record ProcessingEvent
{
    public long Sequence { get; init; }
    public string JobId { get; init; } = "";
    public string Step { get; init; } = "";
    public string? Message { get; init; }
    public object? Payload { get; init; }
    public DateTimeOffset CreatedAt { get; init; }
}

public sealed class JobRecord
{
    public string Id { get; init; } = Guid.NewGuid().ToString("N");
    public string SessionId { get; init; } = Guid.NewGuid().ToString("N");
    public string? ProjectId { get; init; }
    public string UserId { get; init; } = "";
    public string Status { get; set; } = JobStatus.Queued;
    public string CurrentStep { get; set; } = "queued";
    public int Progress { get; set; }
    public string? Error { get; set; }
    public ProcessingInput Input { get; init; } = new();
    public ProcessedDocument? Result { get; set; }
    public DateTimeOffset CreatedAt { get; init; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed class ProjectRecord
{
    public string Id { get; init; } = Guid.NewGuid().ToString("N");
    public string UserId { get; init; } = "";
    public string Name { get; set; } = "IV Doc Project";
    public string? Description { get; set; }
    public string? WebhookUrl { get; set; }
    public string? WebhookSecret { get; set; }
    public DateTimeOffset CreatedAt { get; init; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed class SessionRecord
{
    public string Id { get; init; } = Guid.NewGuid().ToString("N");
    public string? ProjectId { get; init; }
    public string UserId { get; init; } = "";
    public string Name { get; init; } = "IV Doc Package";
    public DateTimeOffset CreatedAt { get; init; }
    public DateTimeOffset UpdatedAt { get; set; }
    public List<ProcessedDocument> Documents { get; init; } = [];
    public PackageValidation PackageValidation { get; set; } = new([], Decision.AutoApprove, "");
    public IReadOnlyList<ValidationCheck> Tier3Validation { get; set; } = [];
    public string PackageDecision { get; set; } = Decision.AutoApprove;
    public string PackageDecisionReason { get; set; } = "";
}

public sealed class ApiKeyRecord
{
    public string Id { get; init; } = Guid.NewGuid().ToString("N");
    public string ProjectId { get; init; } = "";
    public string UserId { get; init; } = "";
    public string Prefix { get; init; } = "";
    public string SecretHash { get; init; } = "";
    public string Name { get; init; } = "API key";
    public HashSet<string> Scopes { get; init; } = new(StringComparer.OrdinalIgnoreCase);
    public int RateLimitPerMinute { get; init; } = 60;
    public DateTimeOffset? ExpiresAt { get; init; }
    public DateTimeOffset? LastUsedAt { get; set; }
    public DateTimeOffset CreatedAt { get; init; }
    public DateTimeOffset? RevokedAt { get; set; }
    public bool Active => RevokedAt is null && (ExpiresAt is null || ExpiresAt > DateTimeOffset.UtcNow);
}
