using System.Security.Cryptography;
using System.Text;

namespace IVDoc.Application;

public sealed class ApiKeyService(
    IApiKeyStore keys,
    IClock clock)
{
    public async Task<ApiKeyCreateResponse> CreateAsync(ApiKeyCreateRequest request, AuthenticatedCaller caller, CancellationToken cancellationToken)
    {
        var secret = GenerateSecret();
        var prefix = secret.Split('_').Last()[..12];
        var record = new ApiKeyRecord
        {
            Id = Guid.NewGuid().ToString("N"),
            ProjectId = request.ProjectId,
            UserId = caller.UserId,
            Prefix = prefix,
            SecretHash = HashSecret(secret),
            Name = string.IsNullOrWhiteSpace(request.Name) ? "API key" : request.Name!,
            Scopes = request.Scopes.ToHashSet(StringComparer.OrdinalIgnoreCase),
            RateLimitPerMinute = Math.Clamp(request.RateLimitPerMinute, 1, 10_000),
            ExpiresAt = request.ExpiresAt,
            CreatedAt = clock.UtcNow,
        };

        await keys.CreateKeyAsync(record, cancellationToken);
        return new ApiKeyCreateResponse(record.Id, record.ProjectId, record.Prefix, secret, record.Scopes.ToArray(), record.RateLimitPerMinute);
    }

    public Task<bool> RevokeAsync(string keyId, AuthenticatedCaller caller, CancellationToken cancellationToken)
        => keys.RevokeAsync(keyId, caller.UserId, cancellationToken);

    public async Task<AuthenticatedCaller?> AuthenticateAsync(string secret, CancellationToken cancellationToken)
    {
        if (!TryGetPrefix(secret, out var prefix))
        {
            return null;
        }

        var record = await keys.FindByPrefixAsync(prefix, cancellationToken);
        if (record is null || !record.Active || !CryptographicOperations.FixedTimeEquals(
                Encoding.UTF8.GetBytes(record.SecretHash),
                Encoding.UTF8.GetBytes(HashSecret(secret))))
        {
            return null;
        }

        await keys.MarkUsedAsync(record.Id, clock.UtcNow, cancellationToken);
        return new AuthenticatedCaller(record.UserId, record.ProjectId, "api_key", record.Scopes);
    }

    public static string HashSecret(string secret)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(secret));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    private static string GenerateSecret()
    {
        Span<byte> bytes = stackalloc byte[32];
        RandomNumberGenerator.Fill(bytes);
        return "ivdoc_live_" + Convert.ToHexString(bytes).ToLowerInvariant();
    }

    private static bool TryGetPrefix(string secret, out string prefix)
    {
        prefix = "";
        var parts = secret.Split('_', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 3 || parts[0] != "ivdoc")
        {
            return false;
        }

        prefix = parts[^1].Length >= 12 ? parts[^1][..12] : parts[^1];
        return prefix.Length > 0;
    }
}
