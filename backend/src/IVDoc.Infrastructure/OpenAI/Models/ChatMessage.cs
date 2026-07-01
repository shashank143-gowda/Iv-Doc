using System.Text.Json.Serialization;

namespace IVDoc.Infrastructure.OpenAI.Models;

public sealed class ChatMessage
{
    [JsonPropertyName("role")]
    public string Role { get; set; } = "";

    [JsonPropertyName("content")]
    public object? Content { get; set; }
}