using IVDoc.Application;
using IVDoc.Infrastructure.OpenAI.Models;

namespace IVDoc.Infrastructure.OpenAI;

public static class PromptBuilder
{
    public static List<ChatMessage> BuildMessages(
        ProcessingInput input,
        string systemPrompt)
    {
        return new List<ChatMessage>
        {
            new()
            {
                Role = "system",
                Content = systemPrompt
            },
            new()
            {
                Role = "user",
                Content = BuildUserContent(input)
            }
        };
    }

    private static object BuildUserContent(ProcessingInput input)
    {
        // Text-only inputs (DOCX, or PDFs with an embedded text layer that
        // the frontend already extracted) can be sent as plain text.
        if (input.Kind == "text")
        {
            return input.Text ?? "";
        }

        // Image / PDF inputs: OpenAI chat completions accept an array of
        // content parts. We send one "text" part with instructions/context
        // plus one "image_url" part per page (base64 data URI), so the
        // vision-capable model actually receives the rasterized pages
        // produced by the frontend's extractPdf()/preprocessImageBase64().
        var parts = new List<object>
        {
            new
            {
                type = "text",
                text = $"Document: {input.FileName}. Extract all fields from the following {Math.Max(1, input.Images?.Count ?? 1)} page image(s).",
            },
        };

        if (input.Images is { Count: > 0 })
        {
            foreach (var image in input.Images)
            {
                parts.Add(new
                {
                    type = "image_url",
                    image_url = new
                    {
                        url = $"data:{image.MimeType};base64,{image.Base64}",
                        // "high" gives the model full-resolution detail for
                        // dense banking documents; cheaper "low"/"auto" can
                        // be substituted later if cost becomes a concern.
                        detail = "high",
                    },
                });
            }
        }
        else if (!string.IsNullOrWhiteSpace(input.Base64))
        {
            // Single-image upload (kind == "image"): one base64 payload,
            // no Images list populated.
            var mime = string.IsNullOrWhiteSpace(input.MimeType) ? "image/png" : input.MimeType;
            parts.Add(new
            {
                type = "image_url",
                image_url = new
                {
                    url = $"data:{mime};base64,{input.Base64}",
                    detail = "high",
                },
            });
        }

        return parts;
    }
}