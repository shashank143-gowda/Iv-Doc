using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using IVDoc.Infrastructure.OpenAI.Models;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace IVDoc.Infrastructure.OpenAI;

public sealed class OpenAIClient
{
    private readonly HttpClient _httpClient;
    private readonly IConfiguration _configuration;
    private readonly ILogger<OpenAIClient> _logger;

    public OpenAIClient(
        HttpClient httpClient,
        IConfiguration configuration,
        ILogger<OpenAIClient> logger)
    {
        _httpClient = httpClient;
        _configuration = configuration;
        _logger = logger;
    }

    public async Task<ChatCompletionResponse> CreateChatCompletionAsync(
        List<ChatMessage> messages,
        JsonObject tool,
        CancellationToken cancellationToken)
    {
        var apiKey = _configuration["OPENAI_API_KEY"];

        if (string.IsNullOrWhiteSpace(apiKey))
            throw new InvalidOperationException("OPENAI_API_KEY is not configured.");

        var model =
            _configuration["OPENAI_MODEL_PRIMARY"] ?? "gpt-5";

        var request = new ChatCompletionRequest
        {
            Model = model,
            Messages = messages,
            Tools =[
                tool
            ],
            ToolChoice = new JsonObject
            {
                ["type"] = "function",
                ["function"] = new JsonObject
                {
                    ["name"] = "emit_extraction"
                }
            }
        };
        var json = JsonSerializer.Serialize(request);

        using var httpRequest = new HttpRequestMessage(
            HttpMethod.Post,
            "https://api.openai.com/v1/chat/completions");

        httpRequest.Headers.Authorization =
            new AuthenticationHeaderValue("Bearer", apiKey);

        httpRequest.Content =
            new StringContent(json, Encoding.UTF8, "application/json");

        _logger.LogInformation(
            "Sending OpenAI Chat Completion request using model {Model}",
            model);

        using var response =
            await _httpClient.SendAsync(httpRequest, cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            var responseBody =
                await response.Content.ReadAsStringAsync(cancellationToken);

            _logger.LogError(
                "OpenAI request failed. StatusCode: {StatusCode}. Response: {Response}",
                (int)response.StatusCode,
                responseBody);

            throw new HttpRequestException(
                $"OpenAI request failed with status code {(int)response.StatusCode}: {response.ReasonPhrase}");
        }

        _logger.LogInformation(
            "OpenAI response received successfully.");

        await using var stream =
            await response.Content.ReadAsStreamAsync(cancellationToken);

        try
        {
            return await JsonSerializer.DeserializeAsync<ChatCompletionResponse>(
                stream,
                cancellationToken: cancellationToken)
                ?? throw new InvalidOperationException("Invalid OpenAI response.");
        }
        catch (JsonException ex)
        {
            _logger.LogError(
                ex,
                "Failed to deserialize OpenAI response.");

            throw;
        }
    }
}