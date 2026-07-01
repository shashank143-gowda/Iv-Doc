// Dual-model Gemini routing layer.
//
// Selects between gemini-2.5-flash (default) and gemini-2.5-pro based on:
//   - Arabic documents
//   - Low-confidence retry (confidence < 0.75)
//   - Heavy doc types (legal_contract, bank_statement)
//
// Both calls use the same OpenAI-compatible chat-completions schema, so the
// existing SYSTEM_PROMPT and TOOL definition in process-stream.ts work as-is.

export type GeminiModelChoice = {
  model: string;
  reason: string;
};

export type GeminiExtractOptions = {
  arabic?: boolean;
  confidence?: number; // first-pass confidence — triggers Pro re-run if < 0.75
  forceModel?: "flash" | "pro";
};

export type GeminiCallResult = {
  argsString: string;
  model: string;
  reason: string;
  status: number;
  ok: boolean;
  rateLimited: boolean;
  errorBody?: string;
};

export type GeminiTextResult = {
  text: string;
  model: string;
  status: number;
  ok: boolean;
  rateLimited: boolean;
  errorBody?: string;
};

const FLASH_MODEL = process.env.GEMINI_MODEL_FLASH || "gemini-2.5-flash";
const PRO_MODEL = process.env.GEMINI_MODEL_PRO || "gemini-2.5-pro";

const HEAVY_DOC_TYPES = new Set<string>(["legal_contract", "bank_statement"]);

export function selectGeminiModel(
  docType: string | undefined,
  options: GeminiExtractOptions = {},
): GeminiModelChoice {
  if (options.forceModel === "pro") {
    return { model: PRO_MODEL, reason: "forced_pro" };
  }
  if (options.forceModel === "flash") {
    return { model: FLASH_MODEL, reason: "forced_flash" };
  }
  if (options.arabic) {
    return { model: PRO_MODEL, reason: "arabic_document" };
  }
  if (typeof options.confidence === "number" && options.confidence < 0.75) {
    return { model: PRO_MODEL, reason: "low_confidence_retry" };
  }
  const dt = (docType || "").toLowerCase();
  if (HEAVY_DOC_TYPES.has(dt)) {
    return { model: PRO_MODEL, reason: `heavy_doc_type:${dt}` };
  }
  return { model: FLASH_MODEL, reason: "standard_doc_type" };
}

type ChatMessage = { role: "system" | "user"; content: unknown };

type ChatCompletionsResponse = {
  choices?: {
    message?: {
      tool_calls?: {
        function?: { arguments?: string };
      }[];
    };
  }[];
};

type GenerateContentResponse = {
  candidates?: {
    content?: {
      parts?: { text?: string }[];
    };
  }[];
};

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Calls Google Gemini via the OpenAI-compatible endpoint so we can reuse the
 * same `tools` / `tool_choice` payload already built for the Lovable AI
 * gateway. Returns the raw tool-call arguments JSON string (the same shape
 * process-stream.ts already parses as ExtractionArgs).
 */
export async function extractWithGemini(
  messages: ChatMessage[],
  tool: unknown,
  docType: string | undefined,
  options: GeminiExtractOptions = {},
): Promise<GeminiCallResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const choice = selectGeminiModel(docType, options);
  console.log(
    `[gemini-client] model=${choice.model} reason=${choice.reason}`,
  );

  const timeoutMs = Number(process.env.GEMINI_TIMEOUT_MS || 90_000);
  let res: Response;
  try {
    res = await fetchWithTimeout(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: choice.model,
          messages,
          tools: [tool],
          tool_choice: {
            type: "function",
            function: { name: "emit_extraction" },
          },
        }),
      },
      timeoutMs,
    );
  } catch (e) {
    const aborted = (e as { name?: string })?.name === "AbortError";
    console.warn(
      `[gemini-client] ${aborted ? `timeout after ${timeoutMs}ms` : "network error"}`,
    );
    return {
      argsString: "",
      model: choice.model,
      reason: choice.reason,
      status: aborted ? 408 : 0,
      ok: false,
      rateLimited: false,
      errorBody: aborted ? `timeout after ${timeoutMs}ms` : String(e),
    };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return {
      argsString: "",
      model: choice.model,
      reason: choice.reason,
      status: res.status,
      ok: false,
      rateLimited: res.status === 429,
      errorBody: body,
    };
  }

  const json = (await res.json()) as ChatCompletionsResponse;
  const argsStr =
    json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ?? "";

  return {
    argsString: argsStr,
    model: choice.model,
    reason: choice.reason,
    status: res.status,
    ok: true,
    rateLimited: false,
  };
}

export async function extractPdfTextWithGemini(
  fileName: string,
  base64Pdf: string,
  options: GeminiExtractOptions = {},
): Promise<GeminiTextResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const choice = selectGeminiModel(undefined, { ...options, forceModel: "pro" });
  const timeoutMs = Number(process.env.GEMINI_PDF_TIMEOUT_MS || 180_000);
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${choice.model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `You are a high-fidelity document parser. Extract the FULL content of the attached PDF named "${fileName}" preserving structure, reading order, and language (including Arabic right-to-left text).

Output rules — follow exactly:
1. Prefix every page with a line: "--- Page N ---" (N = 1-based page number, in document order).
2. Preserve headings using Markdown (# / ## / ###) reflecting visual hierarchy.
3. Render EVERY table as raw HTML (<table><thead><tr><th>...</th></tr></thead><tbody><tr><td>...</td></tr></tbody></table>). Merge spanned cells with colspan/rowspan. Keep cell text verbatim, including Arabic.
4. Preserve form fields as "Label: value" lines. For empty fields output "Label: ____". For checkboxes use "[x]" / "[ ]" before the option label.
5. Preserve lists as Markdown bullets ("- ") or numbered ("1. ").
6. Keep all numbers, dates, IDs, account numbers, signatures (as "[signature]"), stamps (as "[stamp]"), and footnotes.
7. Do NOT summarize, translate, paraphrase, or omit content. Do not add commentary. If a page is blank, output "[blank page]" after the page marker.
8. Maintain original reading order (Arabic pages right-to-left, mixed pages in logical order).

Return ONLY the extracted document content, nothing else.`,
                },
                {
                  inline_data: {
                    mime_type: "application/pdf",
                    data: base64Pdf,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 32768,
          },
        }),
      },
      timeoutMs,
    );
  } catch (e) {
    const aborted = (e as { name?: string })?.name === "AbortError";
    return {
      text: "",
      model: choice.model,
      status: aborted ? 408 : 0,
      ok: false,
      rateLimited: false,
      errorBody: aborted ? `timeout after ${timeoutMs}ms` : String(e),
    };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return {
      text: "",
      model: choice.model,
      status: res.status,
      ok: false,
      rateLimited: res.status === 429,
      errorBody: body,
    };
  }

  const json = (await res.json()) as GenerateContentResponse;
  const text =
    json.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("\n")
      .trim() ?? "";

  return {
    text,
    model: choice.model,
    status: res.status,
    ok: true,
    rateLimited: false,
  };
}
