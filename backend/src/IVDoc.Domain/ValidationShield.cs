using System.Globalization;
using System.Text.RegularExpressions;

namespace IVDoc.Domain;

public sealed class ValidationShield
{
    public const int MinimumOcrCharsPerPage = 80;

    private static readonly Dictionary<string, int> MinimumFieldsByDocType = new(StringComparer.OrdinalIgnoreCase)
    {
        ["loan_contract"] = 8,
        ["account_opening"] = 8,
        ["account_opening_agreement"] = 8,
        ["remittance_form"] = 6,
        ["cash_slip"] = 5,
    };

    private static readonly Dictionary<string, string[]> RequiredFieldsByDocType = new(StringComparer.OrdinalIgnoreCase)
    {
        ["loan_contract"] = ["contract_number", "customer_name", "loan_amount", "number_of_installments", "installment_amount"],
        ["account_opening"] = ["customer_name", "id_number", "account_type"],
        ["account_opening_agreement"] = ["customer_name", "id_number", "account_type"],
        ["remittance_form"] = ["sender", "beneficiary", "amount", "currency"],
        ["cash_slip"] = ["amount", "date"],
    };

    private static readonly HashSet<string> NonSubstantiveFields = new(StringComparer.OrdinalIgnoreCase)
    {
        "title",
        "page_count",
        "pages",
        "signature_flag",
        "has_signature",
    };

    private static readonly Dictionary<string, string[]> FieldAliases = new(StringComparer.OrdinalIgnoreCase)
    {
        ["iban"] = ["iban", "iban_account_number", "beneficiary_iban", "beneficiary_account_no", "beneficiary_account_number", "beneficiary_account", "account_number", "account_no"],
        ["bic"] = ["bic", "swift_code", "swift_bic", "beneficiary_bic", "beneficiary_swift"],
        ["amount"] = ["amount", "amount_figures", "amount_in_figures", "transaction_amount", "remittance_amount", "transfer_amount"],
        ["currency"] = ["currency", "currency_code"],
        ["date"] = ["date", "transaction_date", "issue_date", "value_date", "request_date"],
        ["sender"] = ["sender", "sender_name", "applicant_name", "customer_name", "remitter_name"],
        ["beneficiary"] = ["beneficiary", "beneficiary_name", "payee_name"],
    };

    public IReadOnlyList<ValidationCheck> RunSanityChecks(
        string docType,
        string rawText,
        int pageCount,
        IReadOnlyDictionary<string, object?> fields,
        bool isFallbackExtraction = false,
        IReadOnlyDictionary<string, FieldDetail>? fieldDetails = null)
    {
        var checks = new List<ValidationCheck>();
        var safePageCount = Math.Max(1, pageCount);
        var totalChars = rawText.Length;
        var perPage = totalChars / (double)safePageCount;

        if (isFallbackExtraction)
        {
            checks.Add(new ValidationCheck(
                "sanity:ocr-yield",
                1,
                "OCR yield (fallback extraction)",
                ValidationStatus.Fail,
                "Deterministic fallback extractor was used - output may be generic/placeholder. Routed to exception queue."));
        }
        else if (perPage < MinimumOcrCharsPerPage)
        {
            checks.Add(new ValidationCheck(
                "sanity:ocr-yield",
                1,
                "OCR yield (chars per page)",
                ValidationStatus.Fail,
                $"Low OCR yield relative to page count - possible extraction failure. {totalChars} chars / {safePageCount} page(s) = {perPage:F0} (min {MinimumOcrCharsPerPage})."));
        }
        else
        {
            checks.Add(new ValidationCheck(
                "sanity:ocr-yield",
                1,
                "OCR yield (chars per page)",
                ValidationStatus.Pass,
                $"{totalChars} chars across {safePageCount} page(s) ({perPage:F0}/page)."));
        }

        var normalizedType = docType.ToLowerInvariant();
        var requiredKey = RequiredFieldsByDocType.Keys.FirstOrDefault(k => normalizedType.Contains(k, StringComparison.OrdinalIgnoreCase));
        var required = requiredKey is null ? [] : RequiredFieldsByDocType[requiredKey];
        var substantive = fields
            .Where(kvp => !NonSubstantiveFields.Contains(kvp.Key))
            .Where(kvp => !IsBlank(kvp.Value) && !string.Equals(Text(kvp.Value), "n/a", StringComparison.OrdinalIgnoreCase))
            .ToList();

        var redactedRequired = new List<string>();
        var missingRequired = new List<string>();
        foreach (var key in required)
        {
            if (fields.TryGetValue(key, out var flat) && !IsBlank(flat))
            {
                continue;
            }

            FieldDetail? detail = null;
            fieldDetails?.TryGetValue(key, out detail);
            if (detail?.Status == "redacted")
            {
                redactedRequired.Add(key);
                continue;
            }

            if (detail?.Status == "value" && !string.IsNullOrWhiteSpace(detail.Value))
            {
                continue;
            }

            missingRequired.Add(key);
        }

        var detailText = $"{substantive.Count} substantive field(s) extracted";
        if (missingRequired.Count > 0)
        {
            detailText += $"; not present: {string.Join(", ", missingRequired)}";
        }

        if (redactedRequired.Count > 0)
        {
            detailText += $"; redacted: {string.Join(", ", redactedRequired)}";
        }

        checks.Add(new ValidationCheck("sanity:field-completeness", 1, "Field completeness", ValidationStatus.Pass, detailText + "."));

        foreach (var key in redactedRequired)
        {
            FieldDetail? detail = null;
            fieldDetails?.TryGetValue(key, out detail);
            var pageStr = detail?.Page is { } page ? $" on page {page}" : "";
            checks.Add(new ValidationCheck(
                $"sanity:redacted:{key}",
                1,
                "Required field redacted in source",
                ValidationStatus.Skipped,
                $"{key} is redacted{pageStr}"));
        }

        return checks;
    }

    public IReadOnlyList<ValidationCheck> RunValidationShield(
        string docType,
        IReadOnlyDictionary<string, object?> fields,
        IReadOnlyList<TemplateSpec>? templates = null,
        IReadOnlyDictionary<string, FieldDetail>? fieldDetails = null)
    {
        var checks = new List<ValidationCheck>();
        var resolvedFields = new Dictionary<string, object?>(fields, StringComparer.OrdinalIgnoreCase);
        var mergedDetails = fieldDetails is null
            ? new Dictionary<string, FieldDetail>(StringComparer.OrdinalIgnoreCase)
            : new Dictionary<string, FieldDetail>(fieldDetails, StringComparer.OrdinalIgnoreCase);

        foreach (var canonical in FieldAliases.Keys)
        {
            if (!resolvedFields.TryGetValue(canonical, out var current) || IsBlank(current))
            {
                var value = ResolveAlias(fields, canonical, fieldDetails);
                if (value is not null)
                {
                    resolvedFields[canonical] = value;
                }
            }

            if (!mergedDetails.ContainsKey(canonical) && fieldDetails is not null)
            {
                FieldDetail? best = null;
                foreach (var alias in FieldAliases[canonical])
                {
                    if (!fieldDetails.TryGetValue(alias, out var candidate))
                    {
                        continue;
                    }

                    if (best is null || Rank(candidate.Status) < Rank(best.Status))
                    {
                        best = candidate;
                    }
                }

                if (best is not null)
                {
                    mergedDetails[canonical] = best;
                }
            }
        }

        if (resolvedFields.TryGetValue("iban", out var iban) && !IsBlank(iban))
        {
            checks.Add(ShouldValidateIbanChecksum(docType) ? ValidateIban(Text(iban)) : PreservePayslipBankIdentifier(iban));
        }

        if (resolvedFields.TryGetValue("bic", out var bic) && !IsBlank(bic))
        {
            checks.Add(ValidateBic(Text(bic)));
        }

        if (resolvedFields.TryGetValue("amount", out var amount) && !IsBlank(amount))
        {
            checks.Add(ValidateAmount(amount));
        }

        if (resolvedFields.TryGetValue("currency", out var currency) && !IsBlank(currency))
        {
            checks.Add(ValidateCurrency(Text(currency)));
        }

        if (resolvedFields.TryGetValue("date", out var date) && !IsBlank(date))
        {
            checks.Add(ValidateDate(Text(date), "Date"));
        }

        var matched = PickTemplate(docType, templates ?? []);
        var required = GetRequiredFields(docType, matched);
        checks.AddRange(ValidateRequired(resolvedFields, required, mergedDetails));

        var isSwift = IsSwiftLike(docType);
        if (matched?.RegexPatterns.Count > 0 && !isSwift)
        {
            foreach (var (key, pattern) in matched.RegexPatterns)
            {
                if (!fields.TryGetValue(key, out var value) || IsBlank(value))
                {
                    continue;
                }

                try
                {
                    var ok = Regex.IsMatch(Text(value), pattern, RegexOptions.CultureInvariant);
                    checks.Add(new ValidationCheck(
                        $"tpl:{matched.TemplateKey}:{key}",
                        1,
                        $"Template pattern: {key}",
                        ok ? ValidationStatus.Pass : ValidationStatus.Warn,
                        ok ? Text(value) : $"Doesn't match {pattern}"));
                }
                catch (ArgumentException)
                {
                    // Keep parity with the TypeScript route: invalid template regexes are ignored.
                }
            }
        }

        checks.AddRange(CrossFieldChecks(docType, fields));
        checks.Add(new ValidationCheck(
            "tier3",
            3,
            "Cross-document triangulation",
            ValidationStatus.Skipped,
            matched is not null ? $"Template '{matched.TemplateKey}' matched" : "Upload a multi-document package to enable"));

        return checks;
    }

    public static ValidationCheck ValidateIban(string? iban)
    {
        if (string.IsNullOrWhiteSpace(iban))
        {
            return new ValidationCheck("iban", 1, "IBAN present", ValidationStatus.Skipped);
        }

        var original = iban;
        var cleaned = Regex.Replace(original, @"\s+", "").ToUpperInvariant();
        if (!Regex.IsMatch(cleaned, @"^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$", RegexOptions.CultureInvariant))
        {
            return new ValidationCheck("iban", 1, "IBAN format", ValidationStatus.Fail, $"IBAN format invalid - extracted value: {original}");
        }

        var rearranged = cleaned[4..] + cleaned[..4];
        var numeric = string.Concat(rearranged.Select(c => char.IsAsciiLetter(c) ? ((int)c - 55).ToString(CultureInfo.InvariantCulture) : c.ToString()));
        var ok = Mod97(numeric) == 1;
        return new ValidationCheck(
            "iban",
            1,
            "IBAN checksum (mod-97)",
            ok ? ValidationStatus.Pass : ValidationStatus.Fail,
            ok ? cleaned : $"IBAN checksum failed - extracted value: {original}");
    }

    public static ValidationCheck ValidateBic(string? bic)
    {
        if (string.IsNullOrWhiteSpace(bic))
        {
            return new ValidationCheck("bic", 1, "SWIFT/BIC present", ValidationStatus.Skipped);
        }

        var cleaned = Regex.Replace(bic, @"\s+", "").ToUpperInvariant();
        var ok = Regex.IsMatch(cleaned, @"^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$", RegexOptions.CultureInvariant);
        return new ValidationCheck("bic", 1, "SWIFT/BIC structure", ok ? ValidationStatus.Pass : ValidationStatus.Fail, ok ? cleaned : "Must be 8 or 11 chars (AAAA BB CC [DDD])");
    }

    public static ValidationCheck ValidateDate(string? date, string label = "Date")
    {
        if (string.IsNullOrWhiteSpace(date))
        {
            return new ValidationCheck("date", 1, $"{label} present", ValidationStatus.Skipped);
        }

        var ok = DateTimeOffset.TryParse(date, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed);
        return new ValidationCheck("date", 1, $"{label} format", ok ? ValidationStatus.Pass : ValidationStatus.Fail, ok ? parsed.UtcDateTime.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : "Unparseable date");
    }

    public static ValidationCheck ValidateAmount(object? amount)
    {
        if (IsBlank(amount))
        {
            return new ValidationCheck("amount", 1, "Amount present", ValidationStatus.Skipped);
        }

        var ok = TryMoney(amount, out var parsed) && parsed > 0;
        return new ValidationCheck("amount", 1, "Amount numeric & positive", ok ? ValidationStatus.Pass : ValidationStatus.Fail, ok ? parsed.ToString("N0", CultureInfo.InvariantCulture) : "Could not parse a positive number");
    }

    public static ValidationCheck ValidateCurrency(string? code)
    {
        if (string.IsNullOrWhiteSpace(code))
        {
            return new ValidationCheck("currency", 1, "Currency code present", ValidationStatus.Skipped);
        }

        var ok = Regex.IsMatch(code.Trim().ToUpperInvariant(), @"^[A-Z]{3}$", RegexOptions.CultureInvariant);
        return new ValidationCheck("currency", 1, "ISO 4217 currency code", ok ? ValidationStatus.Pass : ValidationStatus.Fail, code);
    }

    public static IReadOnlyList<ValidationCheck> ValidateRequired(
        IReadOnlyDictionary<string, object?> fields,
        IReadOnlyList<string> required,
        IReadOnlyDictionary<string, FieldDetail>? fieldDetails = null)
    {
        return required.Select(key =>
        {
            fields.TryGetValue(key, out var value);
            var present = !IsBlank(value);
            FieldDetail? detail = null;
            fieldDetails?.TryGetValue(key, out detail);

            if (!present && detail?.Status == "redacted")
            {
                var pageStr = detail.Page is { } page ? $" on page {page}" : "";
                return new ValidationCheck($"req:{key}", 1, $"Required: {key}", ValidationStatus.Skipped, $"Redacted in source{pageStr}");
            }

            if (!present && detail?.Status == "value" && !string.IsNullOrWhiteSpace(detail.Value))
            {
                return new ValidationCheck($"req:{key}", 1, $"Required: {key}", ValidationStatus.Pass, detail.Value);
            }

            return new ValidationCheck(
                $"req:{key}",
                1,
                $"Required: {key}",
                present ? ValidationStatus.Pass : ValidationStatus.Fail,
                present ? Text(value) : "Missing");
        }).ToList();
    }

    public static IReadOnlyList<ValidationCheck> CrossFieldChecks(string docType, IReadOnlyDictionary<string, object?> fields)
    {
        var checks = new List<ValidationCheck>();
        var sender = Text(Get(fields, "sender") ?? Get(fields, "sender_name")).Trim();
        var beneficiary = Text(Get(fields, "beneficiary") ?? Get(fields, "beneficiary_name")).Trim();

        if (!string.IsNullOrWhiteSpace(sender) && !string.IsNullOrWhiteSpace(beneficiary) && !IsPlaceholderName(sender) && !IsPlaceholderName(beneficiary))
        {
            var aTokens = sender.ToLowerInvariant().Split(' ', StringSplitOptions.RemoveEmptyEntries).ToHashSet(StringComparer.Ordinal);
            var bTokens = beneficiary.ToLowerInvariant().Split(' ', StringSplitOptions.RemoveEmptyEntries).ToHashSet(StringComparer.Ordinal);
            var shared = aTokens.Count(bTokens.Contains);
            var overlap = shared / (double)Math.Max(Math.Max(aTokens.Count, bTokens.Count), 1);
            var selfTransfer = overlap >= 0.8;
            checks.Add(new ValidationCheck(
                "x:sender-vs-beneficiary",
                2,
                "Sender != beneficiary",
                selfTransfer ? ValidationStatus.Fail : ValidationStatus.Pass,
                selfTransfer ? $"Self-transfer flagged for review (name overlap {Math.Round(overlap * 100)}%)" : $"{sender} -> {beneficiary}"));
        }

        var amountRaw = Get(fields, "amount") ?? Get(fields, "transaction_amount");
        if (amountRaw is not null && TryMoney(amountRaw, out var amount))
        {
            checks.Add(new ValidationCheck(
                "x:risk-limit",
                2,
                "AML threshold (< 1M)",
                amount > 1_000_000 ? ValidationStatus.Warn : ValidationStatus.Pass,
                amount > 1_000_000 ? "High-value - escalate to compliance" : "Within limit"));
        }

        var normalizedType = docType.ToLowerInvariant();
        if (normalizedType.Contains("kyc") || normalizedType.Contains("passport") || normalizedType.Contains("emirates") || normalizedType.Contains("aadhaar"))
        {
            var expiry = Get(fields, "expiry_date") ?? Get(fields, "date_of_expiry");
            if (expiry is not null)
            {
                var valid = DateTimeOffset.TryParse(Text(expiry), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed) && parsed > DateTimeOffset.UtcNow;
                checks.Add(new ValidationCheck("x:expiry", 2, "Document not expired", valid ? ValidationStatus.Pass : ValidationStatus.Fail, valid ? parsed.UtcDateTime.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : "Expired or unparseable"));
            }

            var issue = Get(fields, "issue_date") ?? Get(fields, "date_of_issue");
            if (issue is not null)
            {
                var valid = DateTimeOffset.TryParse(Text(issue), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed) && parsed <= DateTimeOffset.UtcNow;
                checks.Add(new ValidationCheck("x:issue-date", 2, "Issue date not in future", valid ? ValidationStatus.Pass : ValidationStatus.Fail, valid ? parsed.UtcDateTime.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : "Issue date is in the future or unparseable"));
            }
        }

        var iban = Text(Get(fields, "iban") ?? Get(fields, "iban_account_number") ?? Get(fields, "account_number")).Replace(" ", "", StringComparison.Ordinal).ToUpperInvariant();
        var currency = Text(Get(fields, "currency") ?? Get(fields, "currency_code")).Trim().ToUpperInvariant();
        if (Regex.IsMatch(iban, @"^[A-Z]{2}\d{2}", RegexOptions.CultureInvariant) && Regex.IsMatch(currency, @"^[A-Z]{3}$", RegexOptions.CultureInvariant))
        {
            var countryCurrencies = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                ["AE"] = "AED", ["SA"] = "SAR", ["GB"] = "GBP", ["US"] = "USD", ["DE"] = "EUR", ["FR"] = "EUR",
                ["ES"] = "EUR", ["IT"] = "EUR", ["NL"] = "EUR", ["IE"] = "EUR", ["PT"] = "EUR", ["BE"] = "EUR",
                ["AT"] = "EUR", ["FI"] = "EUR", ["GR"] = "EUR", ["LU"] = "EUR", ["CH"] = "CHF", ["IN"] = "INR",
                ["PK"] = "PKR", ["EG"] = "EGP", ["JO"] = "JOD", ["KW"] = "KWD", ["QA"] = "QAR", ["BH"] = "BHD",
                ["OM"] = "OMR", ["TR"] = "TRY", ["JP"] = "JPY", ["CN"] = "CNY", ["HK"] = "HKD", ["SG"] = "SGD",
                ["AU"] = "AUD", ["CA"] = "CAD", ["NZ"] = "NZD", ["ZA"] = "ZAR",
            };
            var country = iban[..2];
            if (countryCurrencies.TryGetValue(country, out var expected))
            {
                var ok = expected == currency;
                checks.Add(new ValidationCheck("x:iban-currency", 2, "IBAN country vs currency", ok ? ValidationStatus.Pass : ValidationStatus.Warn, ok ? $"{country} IBAN with {currency}" : $"{country} IBAN typically uses {expected}, got {currency}"));
            }
        }

        return checks;
    }

    private static TemplateSpec? PickTemplate(string docType, IReadOnlyList<TemplateSpec> templates)
    {
        var type = docType.ToLowerInvariant();
        if (IsSwiftLike(type))
        {
            return templates.FirstOrDefault(x => x.TemplateKey == "swift_remittance");
        }

        if (type.Contains("passport") || type.Contains("kyc"))
        {
            return templates.FirstOrDefault(x => x.TemplateKey == "kyc_passport");
        }

        if (type.Contains("salary") || type.Contains("payslip"))
        {
            return templates.FirstOrDefault(x => x.TemplateKey == "salary_slip");
        }

        return null;
    }

    private static string[] GetRequiredFields(string docType, TemplateSpec? matched)
    {
        if (matched is { Fields.Count: > 0 })
        {
            return matched.Fields.Where(kvp => kvp.Value.Required).Select(kvp => kvp.Key).ToArray();
        }

        var type = docType.ToLowerInvariant();
        if (IsSwiftLike(type))
        {
            return ["sender", "beneficiary", "amount", "currency"];
        }

        if (type.Contains("kyc") || type.Contains("passport"))
        {
            return ["full_name", "document_number"];
        }

        if (type.Contains("salary"))
        {
            return ["employee_name", "net_pay"];
        }

        return [];
    }

    private static object? ResolveAlias(IReadOnlyDictionary<string, object?> fields, string canonical, IReadOnlyDictionary<string, FieldDetail>? fieldDetails)
    {
        foreach (var alias in FieldAliases[canonical])
        {
            if (fields.TryGetValue(alias, out var value) && !IsBlank(value))
            {
                return value;
            }
        }

        if (fieldDetails is not null)
        {
            foreach (var alias in FieldAliases[canonical])
            {
                if (fieldDetails.TryGetValue(alias, out var detail) && detail.Status == "value" && !string.IsNullOrWhiteSpace(detail.Value))
                {
                    return detail.Value;
                }
            }
        }

        return null;
    }

    private static bool ShouldValidateIbanChecksum(string docType)
    {
        var normalized = docType.ToLowerInvariant();
        return !(normalized.Contains("salary") || normalized.Contains("payslip"));
    }

    private static ValidationCheck PreservePayslipBankIdentifier(object? value)
        => new("iban", 1, "Payslip bank identifier", ValidationStatus.Skipped, $"Extracted value preserved: {Text(value)}");

    private static int Mod97(string value)
    {
        var rem = 0;
        foreach (var ch in value)
        {
            rem = (rem * 10 + (ch - '0')) % 97;
        }

        return rem;
    }

    private static bool IsSwiftLike(string docType)
        => docType.Contains("swift") || docType.Contains("remittance") || docType.Contains("mt103");

    private static int Rank(string status)
        => status switch
        {
            "value" => 0,
            "redacted" => 1,
            _ => 2,
        };

    private static bool IsPlaceholderName(string value)
    {
        var lc = value.Trim().ToLowerInvariant();
        if (lc.Length < 4)
        {
            return true;
        }

        if (Regex.IsMatch(lc, @"^(details|n/?a|none|null|unknown|redacted|missing|tbd)$", RegexOptions.CultureInvariant))
        {
            return true;
        }

        if (!Regex.IsMatch(lc, "[a-z]", RegexOptions.CultureInvariant))
        {
            return true;
        }

        return lc.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length < 2;
    }

    private static object? Get(IReadOnlyDictionary<string, object?> fields, string key)
        => fields.TryGetValue(key, out var value) && !IsBlank(value) ? value : null;

    private static bool TryMoney(object? value, out double parsed)
    {
        if (value is double d)
        {
            parsed = d;
            return true;
        }

        if (value is float f)
        {
            parsed = f;
            return true;
        }

        if (value is decimal m)
        {
            parsed = (double)m;
            return true;
        }

        if (value is int i)
        {
            parsed = i;
            return true;
        }

        if (value is long l)
        {
            parsed = l;
            return true;
        }

        var cleaned = Regex.Replace(Text(value), @"[^0-9.\-]", "");
        return double.TryParse(cleaned, NumberStyles.Number, CultureInfo.InvariantCulture, out parsed);
    }

    private static bool IsBlank(object? value)
        => value is null || string.IsNullOrWhiteSpace(Text(value));

    private static string Text(object? value)
        => Convert.ToString(value, CultureInfo.InvariantCulture) ?? "";
}
