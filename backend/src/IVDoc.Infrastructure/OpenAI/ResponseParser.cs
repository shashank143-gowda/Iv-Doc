using System.Linq;
using System.Text.Json;
using IVDoc.Domain;
using IVDoc.Infrastructure.OpenAI.Models;

namespace IVDoc.Infrastructure.OpenAI;

public static class ResponseParser
{
    public static ExtractionDraft Parse(ChatCompletionResponse response)
    {
        if (response.Choices.Count == 0)
            throw new InvalidOperationException("OpenAI returned no choices.");

        var message = response.Choices[0].Message
            ?? throw new InvalidOperationException("Missing message.");

        var toolCall = message.ToolCalls?.FirstOrDefault()
            ?? throw new InvalidOperationException("Missing tool call.");

        var argumentsJson = toolCall.Function?.Arguments
            ?? throw new InvalidOperationException("Missing tool arguments.");

        var result = JsonSerializer.Deserialize<OpenAIExtractionResult>(argumentsJson)
            ?? throw new InvalidOperationException("Unable to deserialize extraction result.");

        return new ExtractionDraft
        {
            DocumentType = result.DocumentType,
            ClassificationConfidence = result.ClassificationConfidence,
            Language = result.Language,
            RawText = result.RawText,

            Fields = result.Fields.ToDictionary(
                x => x.Key,
                x => (object?)x.Value,
                StringComparer.OrdinalIgnoreCase),

            FieldConfidence = new Dictionary<string, double>(
                result.FieldConfidence,
                StringComparer.OrdinalIgnoreCase),

            FieldDetails = new Dictionary<string, FieldDetail>(
                result.FieldDetails,
                StringComparer.OrdinalIgnoreCase),

            Pages = result.Pages,

            Arabic = result.Arabic,

            PageCount = result.PageCount
        };
    }
}