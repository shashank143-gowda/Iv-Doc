using System.Collections.Concurrent;
using IVDoc.Application;
using IVDoc.Domain;

namespace IVDoc.Infrastructure;

public sealed class InMemoryPlatformStore :
    IProcessingJobStore,
    ISessionStore,
    IProjectStore,
    IApiKeyStore
{
    private readonly ConcurrentDictionary<string, JobRecord> _jobs = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, List<ProcessingEvent>> _events = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, SessionRecord> _sessions = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, ProcessedDocument> _documents = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, ProjectRecord> _projects = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, ApiKeyRecord> _apiKeysById = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, string> _apiKeyIdsByPrefix = new(StringComparer.OrdinalIgnoreCase);

    public Task<JobRecord> CreateJobAsync(JobRecord job, CancellationToken cancellationToken)
    {
        _jobs[job.Id] = job;
        _events.TryAdd(job.Id, []);
        return Task.FromResult(job);
    }

    public Task<JobRecord?> GetJobAsync(string jobId, CancellationToken cancellationToken)
        => Task.FromResult(_jobs.TryGetValue(jobId, out var job) ? job : null);

    public Task<JobRecord?> GetJobByIdempotencyKeyAsync(string userId, string idempotencyKey, CancellationToken cancellationToken)
    {
        var job = _jobs.Values.FirstOrDefault(candidate =>
            candidate.UserId == userId &&
            string.Equals(candidate.Input.IdempotencyKey, idempotencyKey, StringComparison.Ordinal));
        return Task.FromResult(job);
    }

    public Task UpdateJobAsync(JobRecord job, CancellationToken cancellationToken)
    {
        _jobs[job.Id] = job;
        if (job.Result is not null)
        {
            _documents[job.Result.Id] = job.Result;
        }

        return Task.CompletedTask;
    }

    public Task AddEventAsync(ProcessingEvent processingEvent, CancellationToken cancellationToken)
    {
        var list = _events.GetOrAdd(processingEvent.JobId, _ => []);
        lock (list)
        {
            list.Add(processingEvent with { Sequence = list.Count == 0 ? 1 : list[^1].Sequence + 1 });
        }

        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<ProcessingEvent>> GetEventsAsync(string jobId, long afterSequence, CancellationToken cancellationToken)
    {
        if (!_events.TryGetValue(jobId, out var list))
        {
            return Task.FromResult<IReadOnlyList<ProcessingEvent>>([]);
        }

        lock (list)
        {
            return Task.FromResult<IReadOnlyList<ProcessingEvent>>(list.Where(e => e.Sequence > afterSequence).ToArray());
        }
    }

    public Task<SessionRecord> SaveSessionAsync(SessionRecord session, CancellationToken cancellationToken)
    {
        _sessions[session.Id] = session;
        foreach (var document in session.Documents)
        {
            _documents[document.Id] = document;
        }

        return Task.FromResult(session);
    }

    public Task<SessionRecord?> GetSessionAsync(string sessionId, string userId, CancellationToken cancellationToken)
    {
        if (!_sessions.TryGetValue(sessionId, out var session) || session.UserId != userId)
        {
            return Task.FromResult<SessionRecord?>(null);
        }

        return Task.FromResult<SessionRecord?>(session);
    }

    public Task<ProcessedDocument?> GetDocumentAsync(string documentId, string userId, CancellationToken cancellationToken)
    {
        if (!_documents.TryGetValue(documentId, out var document))
        {
            return Task.FromResult<ProcessedDocument?>(null);
        }

        var owned = _jobs.Values.Any(job => job.UserId == userId && job.Result?.Id == documentId) ||
                    _sessions.Values.Any(session => session.UserId == userId && session.Documents.Any(doc => doc.Id == documentId));
        return Task.FromResult(owned ? document : null);
    }

    public Task SaveDocumentAsync(ProcessedDocument document, string userId, string? sessionId, CancellationToken cancellationToken)
    {
        _documents[document.Id] = document;
        if (!string.IsNullOrWhiteSpace(sessionId) && _sessions.TryGetValue(sessionId, out var session) && session.UserId == userId)
        {
            var index = session.Documents.FindIndex(doc => doc.Id == document.Id);
            if (index >= 0)
            {
                session.Documents[index] = document;
            }
            else
            {
                session.Documents.Add(document);
            }
        }

        return Task.CompletedTask;
    }

    public Task<ProjectRecord> GetOrCreateProjectAsync(string userId, string? projectId, CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(projectId) &&
            _projects.TryGetValue(projectId, out var project) &&
            project.UserId == userId)
        {
            return Task.FromResult(project);
        }

        var existing = _projects.Values.FirstOrDefault(p => p.UserId == userId);
        if (existing is not null)
        {
            return Task.FromResult(existing);
        }

        var now = DateTimeOffset.UtcNow;
        var created = new ProjectRecord
        {
            Id = string.IsNullOrWhiteSpace(projectId) ? Guid.NewGuid().ToString("N") : projectId!,
            UserId = userId,
            CreatedAt = now,
            UpdatedAt = now,
        };
        _projects[created.Id] = created;
        return Task.FromResult(created);
    }

    public Task<ProjectRecord?> GetProjectAsync(string projectId, string userId, CancellationToken cancellationToken)
    {
        if (!_projects.TryGetValue(projectId, out var project) || project.UserId != userId)
        {
            return Task.FromResult<ProjectRecord?>(null);
        }

        return Task.FromResult<ProjectRecord?>(project);
    }

    public Task<ProjectRecord> UpsertProjectAsync(ProjectRecord project, CancellationToken cancellationToken)
    {
        _projects[project.Id] = project;
        return Task.FromResult(project);
    }

    public Task<ApiKeyRecord> CreateKeyAsync(ApiKeyRecord record, CancellationToken cancellationToken)
    {
        _apiKeysById[record.Id] = record;
        _apiKeyIdsByPrefix[record.Prefix] = record.Id;
        return Task.FromResult(record);
    }

    public Task<ApiKeyRecord?> FindByPrefixAsync(string prefix, CancellationToken cancellationToken)
    {
        if (!_apiKeyIdsByPrefix.TryGetValue(prefix, out var id) ||
            !_apiKeysById.TryGetValue(id, out var record))
        {
            return Task.FromResult<ApiKeyRecord?>(null);
        }

        return Task.FromResult<ApiKeyRecord?>(record);
    }

    public Task MarkUsedAsync(string keyId, DateTimeOffset usedAt, CancellationToken cancellationToken)
    {
        if (_apiKeysById.TryGetValue(keyId, out var record))
        {
            record.LastUsedAt = usedAt;
        }

        return Task.CompletedTask;
    }

    public Task<bool> RevokeAsync(string keyId, string userId, CancellationToken cancellationToken)
    {
        if (!_apiKeysById.TryGetValue(keyId, out var record) || record.UserId != userId)
        {
            return Task.FromResult(false);
        }

        record.RevokedAt = DateTimeOffset.UtcNow;
        return Task.FromResult(true);
    }
}
