using IVDoc.Application;
using IVDoc.Domain;

namespace IVDoc.Infrastructure.OpenAI;

public sealed class OpenAIExtractionEngine : IDocumentExtractionEngine
{
    private readonly OpenAIClient _client;

    public OpenAIExtractionEngine(OpenAIClient client)
    {
        _client = client;
    }

    public async Task<ExtractionDraft> ExtractAsync(
        ProcessingInput input,
        Func<string, string?, object?, CancellationToken, Task> emitAsync,
        CancellationToken cancellationToken)
    {
        await emitAsync(
            "openai_start",
            "Preparing OpenAI extraction...",
            null,
            cancellationToken);

        // Build the OpenAI request
        var messages = PromptBuilder.BuildMessages(
            input,
            SystemPrompt.Text);

        var tool = ToolSchemaProvider.Build();

        await emitAsync(
            "openai_request_ready",
            "OpenAI request constructed.",
            new
            {
                MessageCount = messages.Count
            },
            cancellationToken);

        var response = await _client.CreateChatCompletionAsync(
            messages,
            tool,
            cancellationToken);

        await emitAsync(
            "openai_response_received",
            "OpenAI response received.",
            null,
            cancellationToken);

        return ResponseParser.Parse(response);
    }
}