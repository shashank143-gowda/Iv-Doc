using System.Globalization;
using System.Text.RegularExpressions;

namespace IVDoc.Domain;

public sealed class PackageValidationService
{
    public PackageValidation RunPackageValidation(IReadOnlyList<ProcessedDocument> docs)
    {
        var completed = docs
            .Where(doc => doc.Fields.Count > 0)
            .ToArray();
        var checks = new List<ValidationCheck>();

        if (completed.Length < 2)
        {
            return new PackageValidation(
                [
                    new ValidationCheck(
                        "pkg:minimum-documents",
                        3,
                        "Package has multiple documents",
                        ValidationStatus.Skipped,
                        "Upload at least two documents to run cross-document validation"),
                ],
                Decision.AutoApprove,
                "Tier 3 skipped until this package has multiple completed documents.");
        }

        var named = completed
            .Select(doc => new { Doc = doc, Value = Pick(doc.Fields, ["full_name", "employee_name", "customer_name", "name", "beneficiary", "beneficiary_name"]) })
            .Where(x => !string.IsNullOrWhiteSpace(x.Value))
            .ToArray();
        var uniqueNames = named.Select(x => Normalize(x.Value)).ToHashSet(StringComparer.Ordinal);
        if (named.Length >= 2)
        {
            checks.Add(new ValidationCheck(
                "pkg:name-consistency",
                3,
                "Applicant name consistency",
                uniqueNames.Count <= 1 ? ValidationStatus.Pass : ValidationStatus.Warn,
                uniqueNames.Count <= 1
                    ? $"Matched {named[0].Value}"
                    : string.Join(" | ", named.Select(x => $"{x.Doc.FileName}: {x.Value}"))));
        }

        var ids = completed
            .Select(doc => new { Doc = doc, Value = Pick(doc.Fields, ["document_number", "passport_number", "id_number", "national_id", "pan_number"]) })
            .Where(x => !string.IsNullOrWhiteSpace(x.Value))
            .ToArray();
        if (ids.Length >= 2)
        {
            var grouped = ids.GroupBy(x => Normalize(x.Value)).FirstOrDefault(g => g.Count() > 1);
            checks.Add(new ValidationCheck(
                "pkg:identity-reference",
                3,
                "Identity reference reused intentionally",
                grouped is not null ? ValidationStatus.Pass : ValidationStatus.Skipped,
                grouped is not null ? $"Shared reference {grouped.First().Value}" : "No repeated identity reference found across documents"));
        }

        var salary = completed
            .Select(doc => ParseMoney(Get(doc.Fields, "net_pay") ?? Get(doc.Fields, "gross_pay") ?? Get(doc.Fields, "salary")))
            .FirstOrDefault(value => value is not null);
        var deposits = completed
            .Select(doc => ParseMoney(Get(doc.Fields, "deposit_amount") ?? Get(doc.Fields, "monthly_deposit") ?? Get(doc.Fields, "amount")))
            .Where(value => value is not null)
            .Select(value => value!.Value)
            .ToArray();
        if (salary is not null && deposits.Length > 0)
        {
            var bestDeposit = deposits.Max();
            var ratio = bestDeposit / salary.Value;
            checks.Add(new ValidationCheck(
                "pkg:income-evidence",
                3,
                "Income evidence alignment",
                ratio >= 0.75 && ratio <= 1.5 ? ValidationStatus.Pass : ValidationStatus.Warn,
                $"Salary {salary.Value.ToString("N0", CultureInfo.InvariantCulture)} vs deposit {bestDeposit.ToString("N0", CultureInfo.InvariantCulture)}"));
        }

        var hasHardFailure = completed.Any(doc =>
            doc.Decision == Decision.ExceptionQueue ||
            doc.Validation.Any(check => check.Status is ValidationStatus.Fail or ValidationStatus.Warn));
        var hasPackageWarning = checks.Any(check => check.Status is ValidationStatus.Fail or ValidationStatus.Warn);
        var decision = hasHardFailure || hasPackageWarning ? Decision.ExceptionQueue : Decision.AutoApprove;

        if (checks.Count == 0)
        {
            checks.Add(new ValidationCheck(
                "pkg:no-shared-fields",
                3,
                "Cross-document evidence available",
                ValidationStatus.Warn,
                "No shared name, identity, or income fields were available to compare"));
        }

        return new PackageValidation(
            checks,
            decision,
            decision == Decision.AutoApprove
                ? "All document and package checks passed."
                : "One or more document or package checks require exception review.");
    }

    public IReadOnlyList<ValidationCheck> RunTier3Validation(IReadOnlyList<ProcessedDocument> docs)
    {
        if (docs.Count < 2)
        {
            return [];
        }

        var checks = new List<ValidationCheck>();
        var named = docs
            .Select(doc => new { Doc = doc, Raw = PrimaryNameFor(doc) })
            .Where(item => !string.IsNullOrWhiteSpace(item.Raw))
            .Select(item => new { item.Doc, item.Raw, Normalized = Normalize(item.Raw) })
            .ToArray();

        for (var i = 0; i < named.Length; i++)
        {
            for (var j = i + 1; j < named.Length; j++)
            {
                var overlap = TokenOverlapRatio(named[i].Normalized, named[j].Normalized);
                if (overlap <= 0.6)
                {
                    checks.Add(new ValidationCheck(
                        $"tier3:name:{i}:{j}",
                        3,
                        "Name consistency across documents",
                        ValidationStatus.Warn,
                        $"Name mismatch across documents: {named[i].Doc.FileName} ({named[i].Raw}) vs {named[j].Doc.FileName} ({named[j].Raw})"));
                }
            }
        }

        var salaryDoc = docs.FirstOrDefault(doc => Type(doc).Contains("salary") || Type(doc).Contains("payslip"));
        var bankDoc = docs.FirstOrDefault(doc => Type(doc).Contains("bank_statement") || Type(doc).Contains("bank statement"));
        if (salaryDoc is not null && bankDoc is not null)
        {
            var netPay = ParseMoney(Get(salaryDoc.Fields, "net_pay") ?? Get(salaryDoc.Fields, "netpay") ?? Get(salaryDoc.Fields, "salary"));
            var candidates = new List<double>();
            var statedIncome = ParseMoney(Get(bankDoc.Fields, "stated_income") ?? Get(bankDoc.Fields, "monthly_income") ?? Get(bankDoc.Fields, "income"));
            if (statedIncome is not null)
            {
                candidates.Add(statedIncome.Value);
            }

            var largestCredit = ParseMoney(Get(bankDoc.Fields, "largest_credit") ?? Get(bankDoc.Fields, "max_credit") ?? Get(bankDoc.Fields, "deposit_amount") ?? Get(bankDoc.Fields, "amount"));
            if (largestCredit is not null)
            {
                candidates.Add(largestCredit.Value);
            }

            if (netPay is not null && candidates.Count > 0)
            {
                var bankValue = candidates.Max();
                var diff = Math.Abs(bankValue - netPay.Value) / Math.Max(netPay.Value, 1);
                checks.Add(new ValidationCheck(
                    "tier3:income",
                    3,
                    "Salary vs bank statement income",
                    diff > 0.2 ? ValidationStatus.Warn : ValidationStatus.Pass,
                    diff > 0.2
                        ? $"Income mismatch: salary slip shows {netPay.Value.ToString("N0", CultureInfo.InvariantCulture)}, bank statement shows {bankValue.ToString("N0", CultureInfo.InvariantCulture)}"
                        : $"Within +/-20% (salary {netPay.Value.ToString("N0", CultureInfo.InvariantCulture)} vs bank {bankValue.ToString("N0", CultureInfo.InvariantCulture)})"));
            }
        }

        var currencies = docs
            .Select(doc => Get(doc.Fields, "currency") ?? Get(doc.Fields, "currency_code") ?? Get(doc.Fields, "amount_currency") ?? Get(doc.Fields, "iso_currency_code"))
            .Where(raw => raw is not null && !string.IsNullOrWhiteSpace(Convert.ToString(raw, CultureInfo.InvariantCulture)))
            .Select(raw => Regex.Match(Convert.ToString(raw, CultureInfo.InvariantCulture)!.ToUpperInvariant(), @"[A-Z]{3}"))
            .Where(match => match.Success)
            .Select(match => match.Value)
            .ToHashSet(StringComparer.Ordinal);
        if (currencies.Count > 1)
        {
            checks.Add(new ValidationCheck(
                "tier3:currency",
                3,
                "Currency consistency across documents",
                ValidationStatus.Warn,
                $"Currency inconsistency across documents: [{string.Join(", ", currencies)}]"));
        }

        return checks;
    }

    private static string PrimaryNameFor(ProcessedDocument doc)
    {
        var type = Type(doc);
        if (type.Contains("passport") || type.Contains("kyc"))
        {
            return Pick(doc.Fields, ["full_name", "beneficiary_name", "name"]);
        }

        if (type.Contains("emirates") || type.Contains("aadhaar") || type.Contains("national_id"))
        {
            return Pick(doc.Fields, ["name", "full_name"]);
        }

        if (type.Contains("swift") || type.Contains("remittance") || type.Contains("mt103"))
        {
            return Pick(doc.Fields, ["sender_details", "sender", "ordering_customer"]);
        }

        if (type.Contains("salary") || type.Contains("payslip"))
        {
            return Pick(doc.Fields, ["employee_name", "name", "full_name"]);
        }

        return Pick(doc.Fields, ["full_name", "name", "employee_name", "sender_details", "sender"]);
    }

    private static double TokenOverlapRatio(string a, string b)
    {
        var left = a.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToHashSet(StringComparer.Ordinal);
        var right = b.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToHashSet(StringComparer.Ordinal);
        if (left.Count == 0 || right.Count == 0)
        {
            return 0;
        }

        var shared = left.Count(right.Contains);
        return shared / (double)Math.Max(left.Count, right.Count);
    }

    private static string Pick(IReadOnlyDictionary<string, object?> fields, IReadOnlyList<string> keys)
    {
        foreach (var key in keys)
        {
            var value = Get(fields, key);
            if (value is not null)
            {
                return Convert.ToString(value, CultureInfo.InvariantCulture)?.Trim() ?? "";
            }
        }

        return "";
    }

    private static object? Get(IReadOnlyDictionary<string, object?> fields, string key)
        => fields.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(Convert.ToString(value, CultureInfo.InvariantCulture))
            ? value
            : null;

    private static double? ParseMoney(object? value)
    {
        if (value is null)
        {
            return null;
        }

        if (value is double d)
        {
            return d;
        }

        var cleaned = Regex.Replace(Convert.ToString(value, CultureInfo.InvariantCulture) ?? "", @"[^0-9.\-]", "");
        return double.TryParse(cleaned, NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed) ? parsed : null;
    }

    private static string Normalize(string value)
        => Regex.Replace(value.Trim().ToLowerInvariant(), @"\s+", " ");

    private static string Type(ProcessedDocument doc)
        => (doc.DocumentType ?? "").ToLowerInvariant();
}
