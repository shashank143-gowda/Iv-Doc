using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using IVDoc.Application;

namespace IVDoc.Infrastructure;

public sealed class WebhookDeliveryClient(HttpClient httpClient) : IWebhookDeliveryClient
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<HandoffResponse> DeliverAsync(ProjectRecord project, SessionRecord session, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(project.WebhookUrl))
        {
            return new HandoffResponse(false, 400, "No webhook_url configured for this project.");
        }

        var payload = new
        {
            session_id = session.Id,
            project_id = session.ProjectId,
            name = session.Name,
            package_decision = session.PackageDecision,
            package_decision_reason = session.PackageDecisionReason,
            package_validation = session.PackageValidation,
            package_validation_results = session.Tier3Validation,
            documents = session.Documents,
            delivered_at = DateTimeOffset.UtcNow,
        };
        var body = JsonSerializer.Serialize(payload, JsonOptions);
        using var request = new HttpRequestMessage(HttpMethod.Post, project.WebhookUrl)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };

        if (!string.IsNullOrWhiteSpace(project.WebhookSecret))
        {
            using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(project.WebhookSecret));
            var signature = Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(body))).ToLowerInvariant();
            request.Headers.TryAddWithoutValidation("X-IVDoc-Signature", signature);
        }

        request.Headers.TryAddWithoutValidation("X-IVDoc-Session", session.Id);

        try
        {
            using var response = await httpClient.SendAsync(request, cancellationToken);
            var error = response.IsSuccessStatusCode
                ? null
                : (await response.Content.ReadAsStringAsync(cancellationToken)) is var text && !string.IsNullOrWhiteSpace(text)
                    ? text[..Math.Min(text.Length, 500)]
                    : response.ReasonPhrase;
            return new HandoffResponse(response.IsSuccessStatusCode, (int)response.StatusCode, error);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            return new HandoffResponse(false, null, ex.Message);
        }
    }
}
