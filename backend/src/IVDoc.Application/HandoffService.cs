namespace IVDoc.Application;

public sealed class HandoffService(
    ISessionStore sessions,
    IProjectStore projects,
    IWebhookDeliveryClient deliveryClient)
{
    private static readonly HashSet<string> ApprovedDecisions = new(StringComparer.OrdinalIgnoreCase)
    {
        "auto_approve",
        "auto_approved",
    };

    public async Task<HandoffResponse?> DeliverAsync(string sessionId, AuthenticatedCaller caller, CancellationToken cancellationToken)
    {
        var session = await sessions.GetSessionAsync(sessionId, caller.UserId, cancellationToken);
        if (session is null)
        {
            return null;
        }

        if (!ApprovedDecisions.Contains(session.PackageDecision))
        {
            return new HandoffResponse(false, 400, $"Session decision is \"{session.PackageDecision}\". Only auto-approved sessions can be handed off.");
        }

        if (string.IsNullOrWhiteSpace(session.ProjectId))
        {
            return new HandoffResponse(false, 400, "Session has no project.");
        }

        var project = await projects.GetProjectAsync(session.ProjectId, caller.UserId, cancellationToken);
        if (project is null)
        {
            return new HandoffResponse(false, 403, "Forbidden.");
        }

        if (string.IsNullOrWhiteSpace(project.WebhookUrl))
        {
            return new HandoffResponse(false, 400, "No webhook_url configured for this project.");
        }

        return await deliveryClient.DeliverAsync(project, session, cancellationToken);
    }
}
