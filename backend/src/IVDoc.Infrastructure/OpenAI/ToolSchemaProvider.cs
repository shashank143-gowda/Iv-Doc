using System.Text.Json.Nodes;

namespace IVDoc.Infrastructure.OpenAI;

public static class ToolSchemaProvider
{
    public static JsonObject Build()
    {
        return new JsonObject
        {
            ["type"] = "function",
            ["function"] = new JsonObject
            {
                ["name"] = "emit_extraction",
                ["description"] =
                    "Return document classification, OCR text, and structured field extraction for the supplied page image(s).",
                ["parameters"] = new JsonObject
                {
                    ["type"] = "object",
                    ["properties"] = new JsonObject
                    {
                        ["document_type"] = new JsonObject
                        {
                            ["type"] = "string",
                            ["description"] =
                                "Best-guess document type, e.g. swift_mt103, kyc_passport, payslip, invoice, remittance_form, account_opening_agreement, or unknown.",
                        },
                        ["classification_confidence"] = new JsonObject
                        {
                            ["type"] = "number",
                            ["description"] = "Confidence in document_type, 0.0 to 1.0.",
                        },
                        ["language"] = new JsonObject
                        {
                            ["type"] = "string",
                            ["description"] = "Primary language detected, e.g. eng, ara.",
                        },
                        ["raw_text"] = new JsonObject
                        {
                            ["type"] = "string",
                            ["description"] = "Full OCR transcription of all visible text on every page, in reading order.",
                        },
                        ["fields"] = new JsonObject
                        {
                            ["type"] = "object",
                            ["description"] = "Flat map of extracted field name to string value, for every field found.",
                            ["additionalProperties"] = new JsonObject { ["type"] = "string" },
                        },
                        ["field_confidence"] = new JsonObject
                        {
                            ["type"] = "object",
                            ["description"] = "Flat map of field name to confidence (0.0-1.0), matching keys in fields.",
                            ["additionalProperties"] = new JsonObject { ["type"] = "number" },
                        },
                        ["field_details"] = new JsonObject
                        {
                            ["type"] = "object",
                            ["description"] = "Optional per-field metadata (status: value/redacted/not_present, page number, confidence).",
                            ["additionalProperties"] = new JsonObject { ["type"] = "object" },
                        },
                        ["pages"] = new JsonObject
                        {
                            ["type"] = "array",
                            ["description"] = "Per-page metadata: page number, document type, segment role, confidence.",
                            ["items"] = new JsonObject { ["type"] = "object" },
                        },
                        ["arabic"] = new JsonObject
                        {
                            ["type"] = "boolean",
                            ["description"] = "True if the document contains Arabic script.",
                        },
                        ["page_count"] = new JsonObject
                        {
                            ["type"] = "integer",
                            ["description"] = "Total number of pages in the document.",
                        },
                    },
                    ["required"] = new JsonArray("document_type", "classification_confidence", "language", "raw_text", "fields", "page_count"),
                },
            },
        };
    }
}