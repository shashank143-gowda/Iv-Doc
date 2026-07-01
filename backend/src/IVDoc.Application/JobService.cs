namespace IVDoc.Application;

public sealed class JobService(
    IProcessingJobStore jobs,
    IProcessingQueue queue,
    IClock clock)
{
    public async Task<JobAcceptedResponse> CreateJobAsync(
        ProcessingInput input,
        AuthenticatedCaller caller,
        string basePath,
        CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(input.IdempotencyKey))
        {
            var existing = await jobs.GetJobByIdempotencyKeyAsync(caller.UserId, input.IdempotencyKey, cancellationToken);
            if (existing is not null)
            {
                return Accepted(existing, basePath);
            }
        }

        var now = clock.UtcNow;
        var job = new JobRecord
        {
            UserId = caller.UserId,
            ProjectId = input.ProjectId ?? caller.ProjectId,
            SessionId = string.IsNullOrWhiteSpace(input.SessionId) ? Guid.NewGuid().ToString("N") : input.SessionId!,
            Input = input,
            CreatedAt = now,
            UpdatedAt = now,
        };

        await jobs.CreateJobAsync(job, cancellationToken);
        await queue.EnqueueAsync(job.Id, cancellationToken);
        return Accepted(job, basePath);
    }

    public async Task<JobStatusResponse?> GetStatusAsync(string jobId, CancellationToken cancellationToken)
    {
        var job = await jobs.GetJobAsync(jobId, cancellationToken);
        return job is null
            ? null
            : new JobStatusResponse(job.Id, job.SessionId, job.ProjectId, job.Status, job.CurrentStep, job.Progress, job.Error, job.CreatedAt, job.UpdatedAt);
    }

    public Task<JobRecord?> GetJobAsync(string jobId, CancellationToken cancellationToken)
        => jobs.GetJobAsync(jobId, cancellationToken);

    public Task<IReadOnlyList<ProcessingEvent>> GetEventsAsync(string jobId, long afterSequence, CancellationToken cancellationToken)
        => jobs.GetEventsAsync(jobId, afterSequence, cancellationToken);

    private static JobAcceptedResponse Accepted(JobRecord job, string basePath)
        => new(
            job.Id,
            job.SessionId,
            job.Status,
            $"{basePath}/v1/jobs/{job.Id}/events",
            $"{basePath}/v1/jobs/{job.Id}/result");
}
