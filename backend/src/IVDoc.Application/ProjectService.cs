namespace IVDoc.Application;

public sealed class ProjectService(
    IProjectStore projects,
    IClock clock)
{
    public async Task<ProjectResponse?> GetAsync(string projectId, AuthenticatedCaller caller, CancellationToken cancellationToken)
    {
        var project = await projects.GetProjectAsync(projectId, caller.UserId, cancellationToken);
        return project is null ? null : ToResponse(project);
    }

    public async Task<ProjectResponse> PatchAsync(string projectId, ProjectSettingsRequest request, AuthenticatedCaller caller, CancellationToken cancellationToken)
    {
        var existing = await projects.GetProjectAsync(projectId, caller.UserId, cancellationToken)
                       ?? new ProjectRecord
                       {
                           Id = projectId,
                           UserId = caller.UserId,
                           Name = string.IsNullOrWhiteSpace(request.Name) ? "IV Doc Project" : request.Name!,
                           CreatedAt = clock.UtcNow,
                           UpdatedAt = clock.UtcNow,
                       };

        if (!string.IsNullOrWhiteSpace(request.Name))
        {
            existing.Name = request.Name!;
        }

        if (request.Description is not null)
        {
            existing.Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description;
        }

        if (request.WebhookUrl is not null)
        {
            existing.WebhookUrl = string.IsNullOrWhiteSpace(request.WebhookUrl) ? null : request.WebhookUrl;
        }

        if (!string.IsNullOrWhiteSpace(request.WebhookSecret))
        {
            existing.WebhookSecret = request.WebhookSecret;
        }

        existing.UpdatedAt = clock.UtcNow;
        return ToResponse(await projects.UpsertProjectAsync(existing, cancellationToken));
    }

    public static ProjectResponse ToResponse(ProjectRecord project)
        => new()
        {
            Id = project.Id,
            UserId = project.UserId,
            Name = project.Name,
            Description = project.Description,
            WebhookUrl = project.WebhookUrl,
            HasWebhookSecret = !string.IsNullOrWhiteSpace(project.WebhookSecret),
            CreatedAt = project.CreatedAt,
            UpdatedAt = project.UpdatedAt,
        };
}
