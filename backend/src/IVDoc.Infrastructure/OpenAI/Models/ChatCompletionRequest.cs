using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace IVDoc.Infrastructure.OpenAI.Models;

public sealed class ChatCompletionRequest
{
    [JsonPropertyName("model")]
    public string Model { get; set; } = "gpt-5";

    [JsonPropertyName("messages")]
    public List<ChatMessage> Messages { get; set; } = [];

    // Generated from ToolSchemaProvider
    [JsonPropertyName("tools")]
    public List<JsonObject> Tools { get; set; } = [];

    [JsonPropertyName("tool_choice")]
    public JsonObject? ToolChoice { get; set; }
}