using System.Text.Json.Serialization;

namespace IVDoc.Domain;

public static class Decision
{
    public const string AutoApprove = "auto_approve";
    public const string ExceptionQueue = "exception_queue";
    public const string Rejected = "rejected";
}

public static class ReviewStatus
{
    public const string Open = "open";
    public const string ApprovedOverride = "approved_override";
    public const string Rejected = "rejected";
}

public static class ValidationStatus
{
    public const string Pass = "pass";
    public const string Fail = "fail";
    public const string Warn = "warn";
    public const string Skipped = "skipped";
}

public sealed record ValidationCheck(
    string Id,
    int Tier,
    string Label,
    string Status,
    string? Detail = null);

public sealed record FieldDetail(
    string Status,
    string? Value,
    int? Page,
    double Confidence,
    string? Evidence = null);

public sealed record PageMeta
{
    public int Page { get; init; }
    public string DocumentType { get; init; } = "unknown";
    public string SegmentRole { get; init; } = "continuation";
    public int? PrintedPageCurrent { get; init; }
    public int? PrintedPageTotal { get; init; }
    public bool? CoverLike { get; init; }
    public double Confidence { get; init; }
}

public sealed record DocumentSegment(
    string DocType,
    int StartPage,
    int EndPage,
    double Confidence,
    bool NeedsReview,
    IReadOnlyList<string> Signals);

public sealed record ProcessedDocument
{
    public string Id { get; init; } = Guid.NewGuid().ToString("N");
    public string FileName { get; init; } = "";
    public string? MimeType { get; init; }
    public long? FileSize { get; init; }
    public string? DocumentType { get; init; }
    public double? ClassificationConfidence { get; init; }
    public string? Language { get; init; }
    public string? RawText { get; init; }
    public Dictionary<string, object?> Fields { get; init; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, double> FieldConfidence { get; init; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, FieldDetail> FieldDetails { get; init; } = new(StringComparer.OrdinalIgnoreCase);
    public List<ValidationCheck> Validation { get; init; } = [];
    public string? Decision { get; init; }
    public string? DecisionReason { get; init; }
    public string? Error { get; init; }
    public string? ReviewStatus { get; init; }
    public string? ReviewNote { get; init; }
    public string? ExtractionSource { get; init; }
    public List<PageMeta> Pages { get; init; } = [];
    public List<DocumentSegment> Segments { get; init; } = [];
}

public sealed record PackageValidation(
    IReadOnlyList<ValidationCheck> Checks,
    string Decision,
    string DecisionReason);

public sealed record TemplateFieldSpec(bool Required = false, string? Type = null);

public sealed record TemplateSpec
{
    [JsonPropertyName("template_key")]
    public string TemplateKey { get; init; } = "";

    public Dictionary<string, TemplateFieldSpec> Fields { get; init; } = new(StringComparer.OrdinalIgnoreCase);

    [JsonPropertyName("regex_patterns")]
    public Dictionary<string, string> RegexPatterns { get; init; } = new(StringComparer.OrdinalIgnoreCase);
}

public sealed record ExtractionDraft
{
    public string DocumentType { get; init; } = "unknown";
    public double ClassificationConfidence { get; init; }
    public string Language { get; init; } = "unknown";
    public string RawText { get; init; } = "";
    public Dictionary<string, object?> Fields { get; init; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, double> FieldConfidence { get; init; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, FieldDetail> FieldDetails { get; init; } = new(StringComparer.OrdinalIgnoreCase);
    public List<PageMeta> Pages { get; init; } = [];
    public bool Arabic { get; init; }
    public bool IsFallbackExtraction { get; init; }
    public int PageCount { get; init; } = 1;
}
