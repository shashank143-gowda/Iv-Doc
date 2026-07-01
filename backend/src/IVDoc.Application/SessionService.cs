using IVDoc.Domain;

namespace IVDoc.Application;

public sealed class SessionService(
    ISessionStore sessions,
    PackageValidationService packageValidation,
    IClock clock)
{
    public async Task<SessionResponse> CreateSessionAsync(
        CreateSessionRequest request,
        AuthenticatedCaller caller,
        CancellationToken cancellationToken)
    {
        var now = clock.UtcNow;
        var package = packageValidation.RunPackageValidation(request.Documents);
        var tier3 = packageValidation.RunTier3Validation(request.Documents);
        var tier3Triggered = tier3.Any(check => check.Status is ValidationStatus.Fail or ValidationStatus.Warn);
        var effectiveDecision = tier3Triggered ? Decision.ExceptionQueue : package.Decision;
        var effectiveReason = tier3Triggered
            ? $"Tier-3 cross-document check raised {tier3.Count(check => check.Status is ValidationStatus.Fail or ValidationStatus.Warn)} issue(s) - review required."
            : package.DecisionReason;

        var session = new SessionRecord
        {
            Id = Guid.NewGuid().ToString("N"),
            ProjectId = request.ProjectId ?? caller.ProjectId,
            UserId = caller.UserId,
            Name = string.IsNullOrWhiteSpace(request.Name) ? $"Package {now:O}" : request.Name!,
            CreatedAt = now,
            UpdatedAt = now,
            Documents = request.Documents,
            PackageValidation = package,
            Tier3Validation = tier3,
            PackageDecision = effectiveDecision,
            PackageDecisionReason = effectiveReason,
        };

        var saved = await sessions.SaveSessionAsync(session, cancellationToken);
        return ToResponse(saved);
    }

    public async Task<SessionResponse?> GetSessionAsync(string sessionId, AuthenticatedCaller caller, CancellationToken cancellationToken)
    {
        var session = await sessions.GetSessionAsync(sessionId, caller.UserId, cancellationToken);
        return session is null ? null : ToResponse(session);
    }

    private static SessionResponse ToResponse(SessionRecord session)
        => new()
        {
            Id = session.Id,
            ProjectId = session.ProjectId,
            UserId = session.UserId,
            Name = session.Name,
            CreatedAt = session.CreatedAt,
            UpdatedAt = session.UpdatedAt,
            Documents = session.Documents,
            PackageValidation = session.PackageValidation,
            PackageDecision = session.PackageDecision,
            PackageDecisionReason = session.PackageDecisionReason,
        };
}
