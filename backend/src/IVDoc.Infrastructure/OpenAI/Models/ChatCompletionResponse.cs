using System.Text.Json.Serialization;

namespace IVDoc.Infrastructure.OpenAI.Models;

public sealed class ChatCompletionResponse
{
    [JsonPropertyName("choices")]
    public List<Choice> Choices { get; set; } = [];
}

public sealed class Choice
{
    [JsonPropertyName("message")]
    public Message? Message { get; set; }
}

public sealed class Message
{
    [JsonPropertyName("content")]
    public string? Content { get; set; }

    [JsonPropertyName("tool_calls")]
    public List<ToolCall>? ToolCalls { get; set; }
}

public sealed class ToolCall
{
    [JsonPropertyName("function")]
    public ToolFunction? Function { get; set; }
}

public sealed class ToolFunction
{
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("arguments")]
    public string? Arguments { get; set; }
}