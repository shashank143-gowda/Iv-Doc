using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using IVDoc.Application;
using IVDoc.Domain;

namespace IVDoc.Infrastructure;

public sealed class DeterministicExtractionEngine : IDocumentExtractionEngine
{
    public Task<ExtractionDraft> ExtractAsync(
        ProcessingInput input,
        Func<string, string?, object?, CancellationToken, Task> emitAsync,
        CancellationToken cancellationToken)
    {
        var rawText = ResolveRawText(input);
        var fallback = string.IsNullOrWhiteSpace(input.Text);
        var (docType, confidence) = Classify(input.FileName, rawText);
        var fields = ExtractFields(rawText);
        var fieldConfidence = fields.Keys.ToDictionary(key => key, _ => 0.72d, StringComparer.OrdinalIgnoreCase);
        var pageCount = Math.Max(1, input.PageCount ?? Math.Max(1, input.Images.Count));
        var pages = Enumerable.Range(1, pageCount)
            .Select(page => new PageMeta
            {
                Page = page,
                DocumentType = docType,
                SegmentRole = pageCount == 1 ? "standalone" : page == 1 ? "start" : page == pageCount ? "end" : "continuation",
                Confidence = confidence,
            })
            .ToList();

        var arabic = input.ForceArabic || Regex.IsMatch(rawText, @"[\u0600-\u06FF]", RegexOptions.CultureInvariant);
        return Task.FromResult(new ExtractionDraft
        {
            DocumentType = docType,
            ClassificationConfidence = confidence,
            Language = arabic ? "ara" : "eng",
            RawText = rawText,
            Fields = fields,
            FieldConfidence = fieldConfidence,
            Pages = pages,
            Arabic = arabic,
            IsFallbackExtraction = fallback && input.Kind != "text",
            PageCount = pageCount,
        });
    }

    private static string ResolveRawText(ProcessingInput input)
    {
        if (!string.IsNullOrWhiteSpace(input.Text))
        {
            return input.Text!;
        }

        if (!string.IsNullOrWhiteSpace(input.Base64))
        {
            try
            {
                var bytes = Convert.FromBase64String(input.Base64);
                if (input.MimeType?.StartsWith("text/", StringComparison.OrdinalIgnoreCase) == true)
                {
                    return Encoding.UTF8.GetString(bytes);
                }
            }
            catch (FormatException)
            {
                // Leave rawText as metadata below.
            }
        }

        return $"File: {input.FileName}\nNo server OCR provider is configured for this local deterministic adapter.";
    }

    private static (string DocType, double Confidence) Classify(string fileName, string rawText)
    {
        var haystack = $"{fileName}\n{rawText}".ToLowerInvariant();
        if (haystack.Contains("mt103") || haystack.Contains("swift"))
        {
            return ("swift_mt103", 0.86);
        }

        if (haystack.Contains("passport") || haystack.Contains("mrz") || haystack.Contains("kyc"))
        {
            return ("kyc_passport", 0.84);
        }

        if (haystack.Contains("payslip") || haystack.Contains("salary slip") || haystack.Contains("net pay"))
        {
            return ("payslip", 0.82);
        }

        if (haystack.Contains("invoice"))
        {
            return ("invoice", 0.78);
        }

        if (haystack.Contains("remittance"))
        {
            return ("remittance_form", 0.8);
        }

        if (haystack.Contains("account opening"))
        {
            return ("account_opening_agreement", 0.8);
        }

        return ("unknown", 0.4);
    }

    private static Dictionary<string, object?> ExtractFields(string rawText)
    {
        var fields = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        AddIfMatch(fields, "iban", rawText, @"\b[A-Z]{2}\d{2}(?:[ \t]?[A-Z0-9]){10,30}\b", ignoreCase: false);
        AddIfMatch(fields, "bic", rawText, @"\b[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b", ignoreCase: false);
        AddIfMatch(fields, "currency", rawText, @"\b(AED|SAR|USD|EUR|GBP|INR|QAR|KWD|BHD|OMR)\b");
        AddIfMatch(fields, "amount", rawText, @"(?i)(?:amount|net pay|total)[:\s]+([A-Z]{3}\s*)?([0-9][0-9,]*(?:\.[0-9]{1,2})?)", group: 2);
        AddIfMatch(fields, "date", rawText, @"\b(20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]20\d{2})\b");
        AddLabel(fields, "employee_name", rawText, "employee name");
        AddLabel(fields, "customer_name", rawText, "customer name");
        AddLabel(fields, "beneficiary", rawText, "beneficiary");
        AddLabel(fields, "sender", rawText, "sender");
        AddLabel(fields, "document_number", rawText, "document number");
        AddLabel(fields, "full_name", rawText, "full name");
        return fields;
    }

    private static void AddIfMatch(Dictionary<string, object?> fields, string key, string text, string pattern, int group = 0, bool ignoreCase = true)
    {
        var options = RegexOptions.CultureInvariant | (ignoreCase ? RegexOptions.IgnoreCase : RegexOptions.None);
        var match = Regex.Match(text, pattern, options);
        if (match.Success)
        {
            fields[key] = match.Groups[group].Value.Trim();
        }
    }

    private static void AddLabel(Dictionary<string, object?> fields, string key, string text, string label)
    {
        var escaped = Regex.Escape(label);
        var match = Regex.Match(text, $@"(?im)^\s*{escaped}\s*[:\-]\s*(.+)$", RegexOptions.CultureInvariant);
        if (match.Success)
        {
            fields[key] = match.Groups[1].Value.Trim();
        }
    }
}
