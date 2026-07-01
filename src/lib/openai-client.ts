// Primary extraction client — OpenAI GPT-5.
//
// Uses the OpenAI chat-completions API with the same tool-call schema already
// used elsewhere in the pipeline, so the returned `argsString` is parsed the
// same way as the Gemini path.

export type OpenAIExtractOptions = {
  arabic?: boolean;
  forceModel?: string;
};

export type OpenAICallResult = {
  argsString: string;
  model: string;
  status: number;
  ok: boolean;
  rateLimited: boolean;
  errorBody?: string;
};

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

const PRIMARY_MODEL = process.env.OPENAI_MODEL_PRIMARY || "gpt-5";

export function isOpenAIConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function extractWithOpenAI(
  messages: ChatMessage[],
  tool: unknown,
  _docType: string | undefined,
  options: OpenAIExtractOptions = {},
): Promise<OpenAICallResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const model = options.forceModel || PRIMARY_MODEL;
  console.log(
    `[openai-client] model=${model} arabic=${Boolean(options.arabic)}`,
  );

  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 90_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        tools: [tool],
        tool_choice: {
          type: "function",
          function: { name: "emit_extraction" },
        },
      }),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const aborted = (e as { name?: string })?.name === "AbortError";
    console.warn(
      `[openai-client] ${aborted ? `timeout after ${timeoutMs}ms` : "network error"}`,
    );
    return {
      argsString: "",
      model,
      status: aborted ? 408 : 0,
      ok: false,
      rateLimited: false,
      errorBody: aborted ? `timeout after ${timeoutMs}ms` : String(e),
    };
  }
  clearTimeout(timer);

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return {
      argsString: "",
      model,
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
    model,
    status: res.status,
    ok: true,
    rateLimited: false,
  };
}

export type OpenAITextResult = {
  text: string;
  model: string;
  status: number;
  ok: boolean;
  rateLimited: boolean;
  errorBody?: string;
};

const PDF_EXTRACTION_PROMPT = (fileName: string) =>
  `You are a high-fidelity document parser. Extract the FULL content of the attached PDF named "${fileName}" preserving structure, reading order, and language (including Arabic right-to-left text).

Output rules — follow exactly:
1. Prefix every page with a line: "--- Page N ---" (N = 1-based page number, in document order).
2. Preserve headings using Markdown (# / ## / ###) reflecting visual hierarchy.
3. Render EVERY table as raw HTML (<table><thead><tr><th>...</th></tr></thead><tbody><tr><td>...</td></tr></tbody></table>). Merge spanned cells with colspan/rowspan. Keep cell text verbatim, including Arabic.
4. Preserve form fields as "Label: value" lines. For empty fields output "Label: ____". For checkboxes use "[x]" / "[ ]" before the option label.
5. Preserve lists as Markdown bullets ("- ") or numbered ("1. ").
6. Keep all numbers, dates, IDs, account numbers, signatures (as "[signature]"), stamps (as "[stamp]"), and footnotes.
7. Do NOT summarize, translate, paraphrase, or omit content. Do not add commentary. If a page is blank, output "[blank page]" after the page marker.
8. Maintain original reading order (Arabic pages right-to-left, mixed pages in logical order).

Return ONLY the extracted document content, nothing else.`;

export async function extractPdfTextWithOpenAI(
  fileName: string,
  base64Pdf: string,
  options: OpenAIExtractOptions = {},
): Promise<OpenAITextResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const model = options.forceModel || PRIMARY_MODEL;
  const timeoutMs = Number(process.env.OPENAI_PDF_TIMEOUT_MS || 180_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: PDF_EXTRACTION_PROMPT(fileName) },
              {
                type: "file",
                file: {
                  filename: fileName,
                  file_data: `data:application/pdf;base64,${base64Pdf}`,
                },
              },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const aborted = (e as { name?: string })?.name === "AbortError";
    return {
      text: "",
      model,
      status: aborted ? 408 : 0,
      ok: false,
      rateLimited: false,
      errorBody: aborted ? `timeout after ${timeoutMs}ms` : String(e),
    };
  }
  clearTimeout(timer);

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return {
      text: "",
      model,
      status: res.status,
      ok: false,
      rateLimited: res.status === 429,
      errorBody: body,
    };
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = (json.choices?.[0]?.message?.content ?? "").trim();

  return { text, model, status: res.status, ok: true, rateLimited: false };
}
