using System.Text.Json.Serialization;
using IVDoc.Domain;

namespace IVDoc.Infrastructure.OpenAI.Models;

public sealed class OpenAIExtractionResult
{
    [JsonPropertyName("document_type")]
    public string DocumentType { get; set; } = "unknown";

    [JsonPropertyName("classification_confidence")]
    public double ClassificationConfidence { get; set; }

    [JsonPropertyName("language")]
    public string Language { get; set; } = "unknown";

    [JsonPropertyName("raw_text")]
    public string RawText { get; set; } = "";

    [JsonPropertyName("fields")]
    public Dictionary<string, string> Fields { get; set; } = new();

    [JsonPropertyName("field_confidence")]
    public Dictionary<string, double> FieldConfidence { get; set; } = new();

    [JsonPropertyName("field_details")]
    public Dictionary<string, FieldDetail> FieldDetails { get; set; } = new();

    [JsonPropertyName("pages")]
    public List<PageMeta> Pages { get; set; } = new();

    [JsonPropertyName("arabic")]
    public bool Arabic { get; set; }

    [JsonPropertyName("page_count")]
    public int PageCount { get; set; }
}