using IVDoc.Domain;

namespace IVDoc.Application;

public sealed class ReviewService(
    ISessionStore sessions,
    IClock clock)
{
    public async Task<ReviewDocumentResponse?> ReviewAsync(
        string documentId,
        ReviewDocumentRequest request,
        AuthenticatedCaller caller,
        CancellationToken cancellationToken)
    {
        var existing = await sessions.GetDocumentAsync(documentId, caller.UserId, cancellationToken);
        if (existing is null)
        {
            return null;
        }

        var now = clock.UtcNow;
        var status = request.Action == "reject" ? ReviewStatus.Rejected : ReviewStatus.ApprovedOverride;
        var reviewed = existing with
        {
            ReviewStatus = status,
            ReviewNote = request.Note,
            Fields = request.Action == "reject"
                ? existing.Fields
                : new Dictionary<string, object?>(request.CorrectedFields, StringComparer.OrdinalIgnoreCase),
            Decision = request.Action == "reject" ? Decision.Rejected : existing.Decision,
        };

        await sessions.SaveDocumentAsync(reviewed, caller.UserId, request.SessionId, cancellationToken);
        return new ReviewDocumentResponse(documentId, status, request.Note, now);
    }
}
