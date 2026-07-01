using System.Text.RegularExpressions;

namespace IVDoc.Domain;

public sealed class PageSegmentationService
{
    private const double DocTypeChangeMinConfidence = 0.7;
    private const double SegmentLowConfidenceThreshold = 0.6;

    public static string NormalizeDigits(string value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return value;
        }

        return Regex.Replace(value, @"[\u0660-\u0669\u06F0-\u06F9]", match =>
        {
            var code = match.Value[0];
            var baseCode = code >= '\u06F0' ? '\u06F0' : '\u0660';
            return ((int)(code - baseCode)).ToString();
        });
    }

    public static (int Current, int Total)? ParsePrintedCounter(string text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return null;
        }

        var normalized = NormalizeDigits(text);
        string[] patterns =
        [
            @"\b(\d{1,4})\s*(?:/|-|of)+\s*(\d{1,4})\b",
            @"\bpage\s+(\d{1,4})\s+of\s+(\d{1,4})\b",
            @"صفحة\s*(\d{1,4})\s*من\s*(\d{1,4})",
        ];

        foreach (var pattern in patterns)
        {
            var match = Regex.Match(normalized, pattern, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
            if (!match.Success)
            {
                continue;
            }

            var current = int.Parse(match.Groups[1].Value);
            var total = int.Parse(match.Groups[2].Value);
            if (current > 0 && total > 0 && current <= total && total <= 9999)
            {
                return (current, total);
            }
        }

        return null;
    }

    public IReadOnlyList<DocumentSegment> StitchSegments(IEnumerable<PageMeta> pages)
    {
        var sorted = pages.OrderBy(p => p.Page).ToArray();
        if (sorted.Length == 0)
        {
            return [];
        }

        var segments = new List<DocumentSegment>();
        OpenSegment? open = null;

        void CloseOpen()
        {
            if (open is null)
            {
                return;
            }

            var confidence = Average(open.Confidences);
            var lowConfidence = confidence < SegmentLowConfidenceThreshold;
            if (lowConfidence)
            {
                open.Signals.Add($"avg_confidence={confidence:F2}");
            }

            segments.Add(new DocumentSegment(
                open.DocType,
                open.StartPage,
                open.EndPage,
                confidence,
                open.Conflict || lowConfidence,
                open.Signals.ToArray()));
            open = null;
        }

        foreach (var page in sorted)
        {
            var docType = string.IsNullOrWhiteSpace(page.DocumentType)
                ? "unknown"
                : page.DocumentType.ToLowerInvariant();
            var confidence = page.Confidence;
            var role = string.IsNullOrWhiteSpace(page.SegmentRole) ? "continuation" : page.SegmentRole;

            if (open is null)
            {
                open = new OpenSegment(
                    docType,
                    page.Page,
                    page.Page,
                    [confidence],
                    page.PrintedPageTotal,
                    page.PrintedPageCurrent,
                    role,
                    [$"start={role}"],
                    false);
                continue;
            }

            var reasons = new List<string>();
            var boundary = false;

            if (page.PrintedPageCurrent is not null &&
                open.LastPrintedCurrent is not null &&
                page.PrintedPageCurrent == 1 &&
                open.LastPrintedCurrent > 1)
            {
                boundary = true;
                reasons.Add("printed_counter_reset");
            }

            if (page.PrintedPageTotal is not null &&
                open.PrintedTotal is not null &&
                page.PrintedPageTotal != open.PrintedTotal)
            {
                boundary = true;
                reasons.Add("printed_total_changed");
            }

            var docTypeChanged = docType != open.DocType &&
                                 confidence >= DocTypeChangeMinConfidence &&
                                 Average(open.Confidences.TakeLast(1)) >= DocTypeChangeMinConfidence;
            if (docTypeChanged)
            {
                boundary = true;
                reasons.Add($"doc_type_change({open.DocType}->{docType})");
            }

            var previousEnded = open.LastRole == "end" ||
                                (open.PrintedTotal is not null &&
                                 open.LastPrintedCurrent is not null &&
                                 open.LastPrintedCurrent >= open.PrintedTotal);
            if (page.CoverLike == true && previousEnded)
            {
                boundary = true;
                reasons.Add("cover_after_end");
            }

            if (role == "start" && page.Page != open.StartPage)
            {
                boundary = true;
                reasons.Add("model_segment_role=start");
            }

            if (docTypeChanged &&
                page.PrintedPageCurrent is not null &&
                open.LastPrintedCurrent is not null &&
                page.PrintedPageCurrent == open.LastPrintedCurrent + 1 &&
                page.PrintedPageTotal == open.PrintedTotal)
            {
                open.Conflict = true;
                reasons.Add("conflict:doctype_change_but_footer_continues");
            }

            var weakOther = (docType == "other" || docType == "unknown") && confidence < 0.5;
            if (boundary && !weakOther)
            {
                open.Signals.AddRange(reasons);
                CloseOpen();
                open = new OpenSegment(
                    docType,
                    page.Page,
                    page.Page,
                    [confidence],
                    page.PrintedPageTotal,
                    page.PrintedPageCurrent,
                    role,
                    [$"start={role}", .. reasons],
                    false);
                continue;
            }

            open.EndPage = page.Page;
            open.Confidences.Add(confidence);
            open.LastRole = role;
            if (page.PrintedPageTotal is not null && open.PrintedTotal is null)
            {
                open.PrintedTotal = page.PrintedPageTotal;
            }

            if (page.PrintedPageCurrent is not null)
            {
                open.LastPrintedCurrent = page.PrintedPageCurrent;
            }

            open.Signals.AddRange(reasons);
        }

        CloseOpen();
        return segments;
    }

    private static double Average(IEnumerable<double> values)
    {
        var materialized = values.ToArray();
        return materialized.Length == 0 ? 0 : materialized.Average();
    }

    private sealed class OpenSegment(
        string docType,
        int startPage,
        int endPage,
        List<double> confidences,
        int? printedTotal,
        int? lastPrintedCurrent,
        string lastRole,
        List<string> signals,
        bool conflict)
    {
        public string DocType { get; } = docType;
        public int StartPage { get; } = startPage;
        public int EndPage { get; set; } = endPage;
        public List<double> Confidences { get; } = confidences;
        public int? PrintedTotal { get; set; } = printedTotal;
        public int? LastPrintedCurrent { get; set; } = lastPrintedCurrent;
        public string LastRole { get; set; } = lastRole;
        public List<string> Signals { get; } = signals;
        public bool Conflict { get; set; } = conflict;
    }
}
