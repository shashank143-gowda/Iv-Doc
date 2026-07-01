using IVDoc.Domain;

namespace IVDoc.Application;

public sealed class DocumentProcessingService(
    IProcessingJobStore jobs,
    IDocumentExtractionEngine extractionEngine,
    ValidationShield validationShield,
    PageSegmentationService pageSegmentation,
    IClock clock)
{
    public async Task ProcessAsync(string jobId, CancellationToken cancellationToken)
    {
        var job = await jobs.GetJobAsync(jobId, cancellationToken)
                  ?? throw new InvalidOperationException($"Job '{jobId}' was not found.");

        job.Status = JobStatus.Running;
        job.CurrentStep = "received";
        job.Progress = 5;
        job.UpdatedAt = clock.UtcNow;
        await jobs.UpdateJobAsync(job, cancellationToken);

        async Task EmitAsync(string step, string? message, object? payload, CancellationToken ct)
        {
            job.CurrentStep = step;
            job.Progress = ProgressFor(step);
            job.UpdatedAt = clock.UtcNow;
            await jobs.UpdateJobAsync(job, ct);
            await jobs.AddEventAsync(new ProcessingEvent
            {
                JobId = job.Id,
                Step = step,
                Message = message,
                Payload = payload,
                CreatedAt = clock.UtcNow,
            }, ct);
        }

        try
        {
            await EmitAsync("received", "Received document", new { jobId = job.Id, fileName = job.Input.FileName }, cancellationToken);
            await EmitAsync("ocr_start", job.Input.Kind == "text" ? "Parsing text..." : "OCR in progress...", null, cancellationToken);

            var draft = await extractionEngine.ExtractAsync(job.Input, EmitAsync, cancellationToken);
            SyncFieldsFromDetails(draft.Fields, draft.FieldConfidence, draft.FieldDetails);

            await EmitAsync("classified", $"Classified as {draft.DocumentType}", new
            {
                documentType = draft.DocumentType,
                classificationConfidence = draft.ClassificationConfidence,
                language = draft.Language,
            }, cancellationToken);

            await EmitAsync("ocr_done", $"{(job.Input.Kind == "text" ? "Text parse" : "OCR")} complete - {draft.RawText.Length} chars", new
            {
                rawText = draft.RawText,
            }, cancellationToken);

            if (draft.Fields.Count > 0)
            {
                await EmitAsync("field_chunk", $"Extracted {draft.Fields.Count}/{draft.Fields.Count} fields", new
                {
                    fields = draft.Fields,
                    fieldConfidence = draft.FieldConfidence,
                    fieldDetails = draft.FieldDetails,
                }, cancellationToken);
            }

            await EmitAsync("extracted", $"Extracted {draft.Fields.Count} fields", new
            {
                fields = draft.Fields,
                fieldConfidence = draft.FieldConfidence,
                fieldDetails = draft.FieldDetails,
            }, cancellationToken);

            await EmitAsync("validate_start", "Running validation shield...", null, cancellationToken);

            var validation = validationShield
                .RunValidationShield(draft.DocumentType, draft.Fields, [], draft.FieldDetails)
                .ToList();
            validation.AddRange(validationShield.RunSanityChecks(
                draft.DocumentType,
                draft.RawText,
                Math.Max(1, draft.PageCount),
                draft.Fields,
                draft.IsFallbackExtraction,
                draft.FieldDetails));

            foreach (var check in validation)
            {
                await EmitAsync("validate_check", check.Label, new { check }, cancellationToken);
            }

            await EmitAsync("validated", "Validation complete", new { validation }, cancellationToken);

            var sanityFail = validation.FirstOrDefault(check => check.Id.StartsWith("sanity:", StringComparison.OrdinalIgnoreCase) && check.Status == ValidationStatus.Fail);
            var anyFail = validation.Any(check => check.Status == ValidationStatus.Fail);
            var anyWarn = validation.Any(check => check.Status == ValidationStatus.Warn);
            var lowConfidence = draft.ClassificationConfidence < 0.5;
            var decision = sanityFail is not null || anyFail || anyWarn || lowConfidence
                ? Decision.ExceptionQueue
                : Decision.AutoApprove;
            var decisionReason = sanityFail is not null
                ? $"Sanity check failed - {sanityFail.Detail ?? sanityFail.Label}"
                : anyFail
                    ? "Validation tier failed - human review required."
                    : anyWarn
                        ? "Tier-2 warning raised - compliance review recommended."
                        : lowConfidence
                            ? "Confidence below threshold - human verification."
                            : "All checks passed - auto-approved for downstream delivery.";

            var pages = draft.Pages
                .GroupBy(page => page.Page)
                .Select(group => group.OrderByDescending(page => page.Confidence).First())
                .OrderBy(page => page.Page)
                .ToList();
            var segments = pageSegmentation.StitchSegments(pages).ToList();

            var result = new ProcessedDocument
            {
                Id = job.Id,
                FileName = job.Input.FileName,
                MimeType = job.Input.MimeType,
                DocumentType = draft.DocumentType,
                ClassificationConfidence = draft.ClassificationConfidence,
                Language = draft.Language,
                RawText = draft.RawText,
                Fields = new Dictionary<string, object?>(draft.Fields, StringComparer.OrdinalIgnoreCase),
                FieldConfidence = new Dictionary<string, double>(draft.FieldConfidence, StringComparer.OrdinalIgnoreCase),
                FieldDetails = new Dictionary<string, FieldDetail>(draft.FieldDetails, StringComparer.OrdinalIgnoreCase),
                Validation = validation,
                Decision = decision,
                DecisionReason = decisionReason,
                ExtractionSource = draft.IsFallbackExtraction ? "fallback" : "ai",
                Pages = pages,
                Segments = segments,
            };

            job.Result = result;
            job.Status = JobStatus.Succeeded;
            job.CurrentStep = "done";
            job.Progress = 100;
            job.UpdatedAt = clock.UtcNow;
            await jobs.UpdateJobAsync(job, cancellationToken);

            await EmitAsync("done", decisionReason, new
            {
                result,
            }, cancellationToken);
        }
        catch (OperationCanceledException)
        {
            job.Status = JobStatus.Canceled;
            job.Error = "Processing was canceled.";
            job.CurrentStep = "error";
            job.UpdatedAt = clock.UtcNow;
            await jobs.UpdateJobAsync(job, CancellationToken.None);
            await jobs.AddEventAsync(new ProcessingEvent
            {
                JobId = job.Id,
                Step = "error",
                Message = job.Error,
                CreatedAt = clock.UtcNow,
            }, CancellationToken.None);
            throw;
        }
        catch (Exception ex)
        {
            job.Status = JobStatus.Failed;
            job.Error = ex.Message;
            job.CurrentStep = "error";
            job.UpdatedAt = clock.UtcNow;
            await jobs.UpdateJobAsync(job, cancellationToken);
            await jobs.AddEventAsync(new ProcessingEvent
            {
                JobId = job.Id,
                Step = "error",
                Message = ex.Message,
                CreatedAt = clock.UtcNow,
            }, cancellationToken);
        }
    }

    private static int ProgressFor(string step)
        => step switch
        {
            "received" => 5,
            "ocr_start" => 15,
            "classified" => 35,
            "ocr_done" => 50,
            "field_chunk" => 65,
            "extracted" => 72,
            "validate_start" => 80,
            "validate_check" => 86,
            "validated" => 92,
            "done" => 100,
            "error" => 100,
            _ => 10,
        };

    private static void SyncFieldsFromDetails(
        IDictionary<string, object?> fields,
        IDictionary<string, double> confidence,
        IReadOnlyDictionary<string, FieldDetail> details)
    {
        foreach (var (key, detail) in details)
        {
            if (detail.Status != "value" || string.IsNullOrWhiteSpace(detail.Value))
            {
                continue;
            }

            if (!fields.TryGetValue(key, out var value) || string.IsNullOrWhiteSpace(Convert.ToString(value)))
            {
                fields[key] = detail.Value;
                confidence[key] = detail.Confidence;
            }
        }
    }
}
