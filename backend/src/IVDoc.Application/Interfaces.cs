using IVDoc.Domain;

namespace IVDoc.Application;

public interface IProcessingJobStore
{
    Task<JobRecord> CreateJobAsync(JobRecord job, CancellationToken cancellationToken);
    Task<JobRecord?> GetJobAsync(string jobId, CancellationToken cancellationToken);
    Task<JobRecord?> GetJobByIdempotencyKeyAsync(string userId, string idempotencyKey, CancellationToken cancellationToken);
    Task UpdateJobAsync(JobRecord job, CancellationToken cancellationToken);
    Task AddEventAsync(ProcessingEvent processingEvent, CancellationToken cancellationToken);
    Task<IReadOnlyList<ProcessingEvent>> GetEventsAsync(string jobId, long afterSequence, CancellationToken cancellationToken);
}

public interface IProcessingQueue
{
    ValueTask EnqueueAsync(string jobId, CancellationToken cancellationToken);
    ValueTask<string> DequeueAsync(CancellationToken cancellationToken);
}

public interface IDocumentExtractionEngine
{
    Task<ExtractionDraft> ExtractAsync(
        ProcessingInput input,
        Func<string, string?, object?, CancellationToken, Task> emitAsync,
        CancellationToken cancellationToken);
}

public interface ISessionStore
{
    Task<SessionRecord> SaveSessionAsync(SessionRecord session, CancellationToken cancellationToken);
    Task<SessionRecord?> GetSessionAsync(string sessionId, string userId, CancellationToken cancellationToken);
    Task<ProcessedDocument?> GetDocumentAsync(string documentId, string userId, CancellationToken cancellationToken);
    Task SaveDocumentAsync(ProcessedDocument document, string userId, string? sessionId, CancellationToken cancellationToken);
}

public interface IProjectStore
{
    Task<ProjectRecord> GetOrCreateProjectAsync(string userId, string? projectId, CancellationToken cancellationToken);
    Task<ProjectRecord?> GetProjectAsync(string projectId, string userId, CancellationToken cancellationToken);
    Task<ProjectRecord> UpsertProjectAsync(ProjectRecord project, CancellationToken cancellationToken);
}

public interface IApiKeyStore
{
    Task<ApiKeyRecord> CreateKeyAsync(ApiKeyRecord record, CancellationToken cancellationToken);
    Task<ApiKeyRecord?> FindByPrefixAsync(string prefix, CancellationToken cancellationToken);
    Task MarkUsedAsync(string keyId, DateTimeOffset usedAt, CancellationToken cancellationToken);
    Task<bool> RevokeAsync(string keyId, string userId, CancellationToken cancellationToken);
}

public interface IWebhookDeliveryClient
{
    Task<HandoffResponse> DeliverAsync(ProjectRecord project, SessionRecord session, CancellationToken cancellationToken);
}

public interface IClock
{
    DateTimeOffset UtcNow { get; }
}
