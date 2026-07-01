import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import {
  runValidationShield,
  runSanityChecks,
  type TemplateSpec,
  type ValidationCheck,
  type FieldDetail,
  type FieldDetailsMap,
} from "@/lib/validators";
import type { Database } from "@/integrations/supabase/types";
import { extractWithGemini } from "@/lib/gemini-client";
import { extractPdfTextWithOpenAI } from "@/lib/openai-client";
import { extractWithOpenAI, isOpenAIConfigured } from "@/lib/openai-client";

const imageInput = z.object({
  kind: z.literal("image"),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(120),
  base64: z.string().min(16).max(20_000_000),
  forceArabic: z.boolean().optional(),
  pageCount: z.number().int().nonnegative().optional(),
});

const imagesInput = z.object({
  kind: z.literal("images"),
  fileName: z.string().min(1).max(255),
  images: z
    .array(
      z.object({
        mimeType: z.string().min(1).max(120),
        base64: z.string().min(16).max(20_000_000),
      }),
    )
    .min(1)
    .max(200),
  forceArabic: z.boolean().optional(),
  pageCount: z.number().int().nonnegative().optional(),
});

const pdfInput = z.object({
  kind: z.literal("pdf"),
  fileName: z.string().min(1).max(255),
  mimeType: z.literal("application/pdf"),
  base64: z.string().min(16).max(30_000_000),
  images: z
    .array(
      z.object({
        mimeType: z.string().min(1).max(120),
        base64: z.string().min(16).max(20_000_000),
      }),
    )
    .min(1)
    .max(200),
  forceArabic: z.boolean().optional(),
  pageCount: z.number().int().nonnegative().optional(),
});

// How many page images we send to the vision model in a single
// chat-completions call. Splitting a long document into batches
// avoids context-window truncation that previously caused only
// page 1 to be OCR'd for 40+ page contracts.
const VISION_API_BATCH_SIZE = 6;

const textInput = z.object({
  kind: z.literal("text"),
  fileName: z.string().min(1).max(255),
  text: z.string().min(1).max(500_000),
  forceArabic: z.boolean().optional(),
  pageCount: z.number().int().nonnegative().optional(),
});

// Legacy shape (no kind field)
const legacyInput = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(120),
  base64: z.string().min(16).max(20_000_000),
  forceArabic: z.boolean().optional(),
  pageCount: z.number().int().nonnegative().optional(),
});

const inputSchema = z.union([imageInput, imagesInput, pdfInput, textInput, legacyInput]);


const TOOL = {
  type: "function",
  function: {
    name: "emit_extraction",
    description:
      "Return the document classification, language, full OCR text, and structured per-field extraction state. Always inspect every expected field for the document type and report it explicitly via field_details — even if redacted or not present. Never silently omit expected fields.",
    parameters: {
      type: "object",
      properties: {
        document_type: { type: "string" },
        classification_confidence: { type: "number", minimum: 0, maximum: 1 },
        language: { type: "string" },
        raw_text: { type: "string" },
        fields: {
          type: "object",
          description:
            "Flat snake_case map of only the fields that have a real extracted value (status='value' in field_details). Do NOT put literal 'redacted' or 'not_present' here. Values MUST be strings (stringify numbers and dates).",
          additionalProperties: { type: "string" },
        },
        field_confidence: {
          type: "object",
          description: "Same keys as fields. Each value is confidence 0-1.",
          additionalProperties: { type: "number", minimum: 0, maximum: 1 },
        },
        field_details: {
          type: "object",
          description:
            "Structured per-field state. One entry per expected field for the detected document type, plus any other readable fields. status='value' when legible, 'redacted' when the label is visible but the value is blacked out/covered, 'not_present' when the document genuinely lacks the field. Include page number when known. For checkbox/radio/selection fields, set status by inspecting the visual checkbox/fill state directly — do not infer from nearby prose alone.",
          additionalProperties: {
            type: "object",
            properties: {
              status: { type: "string", enum: ["value", "redacted", "not_present"] },
              value: { type: ["string", "null"] },
              page: { type: ["integer", "null"] },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              evidence: { type: "string" },
            },
            required: ["status", "value", "page", "confidence"],
          },
        },
        pages: {
          type: "array",
          description:
            "Per-page boundary metadata for EVERY attached page in this call, in order. Use the absolute page numbers from the user message. Re-classify each page individually — a multi-doc PDF will have different document_type values on different pages. Detect printed page-counter footers (e.g. '5/10', 'Page 5 of 10', or Arabic 'صفحة ٥ من ١٠' — RTL aware, accept Eastern-Arabic digits) and report them as printed_page_current / printed_page_total. Mark cover_like=true for title/cover pages with little body text. segment_role describes the page's position within its sub-document.",
          items: {
            type: "object",
            properties: {
              page: { type: "integer", minimum: 1 },
              document_type: { type: "string" },
              segment_role: {
                type: "string",
                enum: ["start", "continuation", "end", "standalone"],
              },
              printed_page_current: { type: ["integer", "null"] },
              printed_page_total: { type: ["integer", "null"] },
              cover_like: { type: "boolean" },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            },
            required: ["page", "document_type", "segment_role", "confidence"],
          },
        },
      },
      required: [
        "document_type",
        "classification_confidence",
        "language",
        "raw_text",
        "fields",
        "field_confidence",
        "field_details",
        "pages",
      ],
      additionalProperties: false,
    },
  },
} as const;


// Expected fields per form-style doc type. Sent into the system prompt so
// the model knows exactly which fields to report a status for. Includes the
// validators' required lists plus broader contextual fields.
const EXPECTED_FIELDS_BY_DOC_TYPE: Record<string, string[]> = {
  loan_contract: [
    "contract_number", "customer_name", "id_number", "loan_amount",
    "profit_rate", "number_of_installments", "installment_amount",
    "contract_date", "maturity_date", "branch_code",
  ],
  payment_schedule: [
    "contract_number", "customer_name", "number_of_installments",
    "installment_amount", "first_installment_date", "last_installment_date",
    "total_amount", "currency",
  ],
  account_opening: [
    "customer_name", "id_number", "id_type", "nationality", "date_of_birth",
    "address", "phone", "email", "account_type", "branch",
  ],
  account_opening_agreement: [
    "customer_name", "id_number", "id_type", "nationality", "date_of_birth",
    "address", "phone", "email", "account_type", "branch", "agreement_date",
  ],
  remittance_form: [
    "date", "account_number", "customer_name", "nationality", "id_type",
    "id_number", "id_expiry", "remittance_type", "amount_figures",
    "amount_in_words", "currency", "beneficiary_name", "beneficiary_address",
    "beneficiary_country", "beneficiary_bank", "swift_bic",
    "beneficiary_iban", "purpose_of_remittance",
  ],
  cash_slip: [
    "cheque_type", "cheque_number", "currency", "account_number", "amount",
    "beneficiary", "transaction_date",
  ],
  document_checklist: [
    "customer_name", "id_number", "checklist_date",
    "passport_copy", "id_copy", "salary_certificate", "bank_statement",
    "utility_bill", "employment_letter",
  ],
};

function expectedFieldsBlock(): string {
  return Object.entries(EXPECTED_FIELDS_BY_DOC_TYPE)
    .map(([k, v]) => `- ${k}: ${v.join(", ")}`)
    .join("\n");
}

const SYSTEM_PROMPT = `You are IV Doc, an OCR + IDP engine for ANY document — banking, KYC, identity (PAN, Aadhaar, passport, driver's licence), payroll, invoices, contracts, certificates. Supports English & Arabic.
Steps:
1) Read the document with OCR. Preserve numbers, IBANs, BIC codes, dates, amounts, names, identifiers exactly as printed.
2) Classify the document type (e.g. pan_card, passport, swift_mt103, payslip, invoice, kyc_form).
3) Extract EVERY visible labeled value into a flat snake_case map. Stringify all values. Numeric values must be raw digits with optional decimal (no thousands separators, no currency symbol — put the ISO code in 'currency'). Dates must be ISO YYYY-MM-DD when possible.
4) USE THESE CANONICAL KEYS when the document type matches:
   - payslip / salary slip: employee_name, employee_id, employer, pay_period, pay_date, gross_pay, deductions, net_pay, currency, iban
   - swift_mt103 / remittance: sender, beneficiary, iban, bic, amount, currency, value_date, reference
   - kyc / passport: full_name, document_number, nationality, date_of_birth, sex, issue_date, expiry_date, issuing_country, mrz
5) Assign per-field confidence between 0 and 1 for every field you emitted.
Do NOT return an empty fields object if any text is visible.
Return ONLY via the emit_extraction tool. Do not add commentary.

FIELD_DETAILS REQUIREMENT (critical):
You MUST also emit a "field_details" object alongside "fields". For each expected field of the detected document type, include exactly one entry with:
  status: "value" if the value is legible,
          "redacted" if the label is visible but the value is blacked out/covered/obscured,
          "not_present" if the document genuinely does not contain that field.
  value: the string value when status="value", otherwise null.
  page: the page number where the field appears (or null if unknown).
  confidence: 0-1.
  evidence (optional): short text snippet from the document supporting the entry.
The flat "fields" object MUST contain only entries with status="value" — never put the literal strings "redacted" or "not_present" into "fields". Do NOT silently omit expected fields from "field_details". For checkbox / radio / selection fields, inspect the visual checkbox/fill state directly and report the selected option — do not infer the selection from nearby prose alone.

Expected fields per form-style document type:
${expectedFieldsBlock()}

ARABIC & BILINGUAL DOCUMENTS:
This document may be written in Arabic (right-to-left) or bilingual Arabic/English. When reading Arabic text:
- Read field labels from right to left.
- Arabic field labels and their English equivalents appear side by side on Bank Albilad forms — extract from whichever is clearer.
- Dates may be in Hijri (١٤٤٥/٠١/٠١) or Gregorian format — extract both if present and note the calendar system.
- Numbers in Arabic-Indic script (٠١٢٣٤٥٦٧٨٩) should be converted to Western Arabic numerals (0123456789) in the output.

ADDITIONAL DOCUMENT TYPES — classify and use these slugs when matched:
- "account_opening_agreement": title contains "اتفاقية فتح حساب" / "فتح حساب بنكي" / "Account Opening Agreement" / "Bank Account Opening" — even if the body mentions IBAN, SWIFT, or BIC in boilerplate. PRIORITIZE this over "swift_mt103" / "remittance_form" when the title/heading clearly identifies an account opening agreement.
- "remittance_form": contains "نموذج طلب حوالة" or "REMITTANCE / DRAFT REQUEST FORM" as the form title (not just an IBAN mention).
- "cash_slip": contains "دفع شيك مصرفي" or "سحب ايداع نقدي" or an "Audit" stamp with cheque fields.
- "account_opening": contains "اتفاقية فتح حساب" or "Account Opening Agreement" (alias of account_opening_agreement).
- "loan_contract": contains "عقد تمويل" or "عقد بناء ذاتي" or financing contract terms with an installment table.
- "payment_schedule": contains "جدول السداد" or an amortization table with instalment numbers and dates.
- "document_checklist": contains "حافظة مستندات" or a checkbox list of required documents.

CLASSIFICATION PRIORITY: When the filename or first-page title contains "اتفاقية فتح حساب" or "Account Opening Agreement", the document_type MUST be "account_opening_agreement" with high confidence — do not misclassify as swift_mt103 / remittance_form just because IBAN/SWIFT terms appear in the body.

PER-PAGE BOUNDARY METADATA (critical for multi-document PDFs):
You MUST also emit a "pages" array with ONE entry per attached page, in order, even when every page belongs to the same document. Use the ABSOLUTE page numbers given in the user message (not 1-based within this batch). For each page:
  - document_type: classify the page individually (a single PDF can stitch together a loan_contract, payment_schedule, and document_checklist — report each page's actual type).
  - segment_role: "start" for the first page of a sub-document (cover/title/header page or printed counter shows "1 of N"), "continuation" for middle pages, "end" for the last page of a sub-document (printed counter equals total, signatures + stamps, or doc_type changes on the next page), "standalone" for single-page sub-documents.
  - printed_page_current / printed_page_total: parse footers like "5/10", "Page 5 of 10", or Arabic "صفحة ٥ من ١٠". Accept Eastern-Arabic digits (٠-٩) and convert to Western. Null when no counter is visible.
  - cover_like: true when the page is mostly a title/logo/stamp with little body text (typical first page of a fresh sub-document).
  - confidence: 0-1 on the per-page classification.
Do NOT collapse the array — emit every page, in order.`;


type Parsed = z.infer<typeof inputSchema>;
type ImageLikeInput = z.infer<typeof imageInput> | z.infer<typeof legacyInput>;
export type PageMeta = {
  page: number;
  document_type: string;
  segment_role: "start" | "continuation" | "end" | "standalone";
  printed_page_current?: number | null;
  printed_page_total?: number | null;
  cover_like?: boolean;
  confidence: number;
};

type ExtractionArgs = {
  document_type?: string;
  classification_confidence?: number;
  language?: string;
  raw_text?: string;
  fields?: Record<string, string | number | null>;
  field_confidence?: Record<string, number>;
  field_details?: FieldDetailsMap;
  pages?: PageMeta[];
  arabic?: boolean;
  raw_text_english?: string;
};






type OcrSpaceResponse = {
  ParsedResults?: {
    ParsedText?: string;
    ErrorMessage?: string | string[];
    ErrorDetails?: string;
  }[];
  OCRExitCode?: number;
  IsErroredOnProcessing?: boolean;
  ErrorMessage?: string | string[];
  ErrorDetails?: string;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function normalizeProviderError(error: unknown): string {
  if (Array.isArray(error)) return error.filter(Boolean).join(" ");
  if (typeof error === "string") return error;
  return "";
}

function buildUserContent(parsed: Parsed, pageOffset = 0): unknown[] {
  if ("kind" in parsed && parsed.kind === "text") {
    return [
      {
        type: "text",
        text: `File: ${parsed.fileName}\n\nThe document text has been pre-extracted (from a DOCX or similar). OCR is not required — classify and extract structured fields from the text below.\n\n--- BEGIN DOCUMENT TEXT ---\n${parsed.text}\n--- END DOCUMENT TEXT ---`,
      },
    ];
  }
  if ("kind" in parsed && parsed.kind === "images") {
    const firstPage = pageOffset + 1;
    const lastPage = pageOffset + parsed.images.length;
    return [
      {
        type: "text",
        text: `File: ${parsed.fileName} — pages ${firstPage}–${lastPage} (${parsed.images.length} image${parsed.images.length === 1 ? "" : "s"} attached in order).\nIn raw_text, prefix each page's content with a line of the form "--- Page N ---" using the absolute page numbers above. Extract and classify across all attached pages.`,
      },
      ...parsed.images.map((img) => ({
        type: "image_url",
        image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
      })),
    ];
  }
  // image or legacy
  const image = parsed as ImageLikeInput;
  const mime = image.mimeType;
  const b64 = image.base64;
  return [
    { type: "text", text: `File: ${parsed.fileName}. Extract and classify.` },
    { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
  ];
}

function getImagePages(parsed: Parsed): { mimeType: string; base64: string }[] {
  if ("kind" in parsed && parsed.kind === "text") return [];
  if ("kind" in parsed && parsed.kind === "images") return parsed.images;
  if ("kind" in parsed && parsed.kind === "pdf") return parsed.images;
  const image = parsed as ImageLikeInput;
  return [{ mimeType: image.mimeType, base64: image.base64 }];
}

function meaningfulTextLength(text: string): number {
  return text.replace(/--- Page \d+ ---/g, "").replace(/\s/g, "").length;
}

async function runOcrSpacePage(
  image: { mimeType: string; base64: string },
  pageNumber: number,
  lang?: string,
): Promise<string> {
  const apiKey = process.env.OCR_SPACE_API_KEY || "helloworld";
  const form = new FormData();
  form.append("apikey", apiKey);
  form.append("language", lang || process.env.OCR_SPACE_LANGUAGE || "eng");
  // ocr.space engine 2 does not support Arabic; engine 1 does.
  const engine =
    lang === "ara" ? "1" : process.env.OCR_SPACE_ENGINE || "2";
  form.append("OCREngine", engine);
  form.append("detectOrientation", "true");
  form.append("scale", "true");
  form.append("base64Image", `data:${image.mimeType};base64,${image.base64}`);

  const res = await fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OCR.space error ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as OcrSpaceResponse;
  const providerError =
    normalizeProviderError(json.ErrorMessage) ||
    normalizeProviderError(json.ParsedResults?.[0]?.ErrorMessage) ||
    json.ErrorDetails ||
    json.ParsedResults?.[0]?.ErrorDetails ||
    "";

  if (json.IsErroredOnProcessing || providerError) {
    throw new Error(
      `OCR.space could not process page ${pageNumber}: ${providerError || "unknown provider error"}`,
    );
  }

  return (
    json.ParsedResults?.map((result) => result.ParsedText ?? "")
      .join("\n")
      .trim() ?? ""
  );
}

function arabicRatio(text: string): number {
  if (!text) return 0;
  const arabic = text.match(/[\u0600-\u06FF]/g)?.length ?? 0;
  const meaningful = text.replace(/\s/g, "").length;
  if (meaningful === 0) return 0;
  return arabic / meaningful;
}

function isArabicHeavy(text: string): boolean {
  return arabicRatio(text) > 0.15;
}


function firstMatch(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1] ?? match?.[0];
    if (value) return value.trim().replace(/\s+/g, " ");
  }
  return undefined;
}

function addField(fields: Record<string, string>, key: string, value?: string) {
  if (value && !fields[key]) fields[key] = value;
}

function classifyFromText(fileName: string, rawText: string): string {
  try {
    const combined = `${fileName}\n${rawText}`;
    const text = combined.toLowerCase();
    // Check account opening agreements FIRST — these often mention IBAN/SWIFT
    // in their boilerplate but are NOT remittance forms.
    if (
      /اتفاقية\s*فتح\s*حساب|فتح\s*حساب\s*بنكي|فتح\s*حساب\s*جار/.test(combined) ||
      /\b(account opening agreement|bank account opening|current account opening|account opening contract)\b/.test(text)
    )
      return "account_opening_agreement";
    if (
      /نموذج\s*طلب\s*حوالة|حوالة\s*صادرة/.test(combined) ||
      /\b(remittance\s*(\/|\s)?\s*draft request|remittance form|outward remittance|mt\s*103|swift\s*message)\b/.test(text)
    )
      return "swift_mt103";
    if (
      /جواز\s*سفر|هوية|بطاقة\s*هوية/.test(combined) ||
      /\b(passport|nationality|place of birth|date of birth|mrz)\b/.test(text)
    )
      return "passport";
    if (/\b(permanent account number|income tax department|\bpan\b)\b/.test(text))
      return "pan_card";
    if (
      /فاتورة/.test(combined) ||
      /\b(invoice|bill to|invoice no|tax invoice)\b/.test(text)
    )
      return "invoice";
    if (
      /راتب|قسيمة\s*راتب/.test(combined) ||
      /\b(payslip|pay slip|salary|net pay|gross pay)\b/.test(text)
    )
      return "payslip";
    if (
      /بيان\s*حساب|كشف\s*حساب/.test(combined) ||
      /\b(bank statement|account statement|statement of account|opening balance|closing balance)\b/.test(text)
    )
      return "bank_statement";
    if (
      /هوية\s*إماراتية|بطاقة\s*الهوية\s*الإماراتية/.test(combined) ||
      /\b(emirates id|united arab emirates.*identity|id number.*784)\b/.test(text) ||
      /\b784-?\d{4}-?\d{7}-?\d\b/.test(text)
    )
      return "emirates_id";
    if (
      /आधार|आधार\s*कार्ड/.test(combined) ||
      /\b(aadhaar|aadhar|unique identification authority|uidai)\b/.test(text) ||
      /\b\d{4}\s?\d{4}\s?\d{4}\b/.test(text) && /(government of india|भारत सरकार)/i.test(combined)
    )
      return "aadhaar";
    if (
      /\b(account opening (form|application)|new account application|customer onboarding form|cif\s*(no|number))\b/.test(text)
    )
      return "account_opening_form";
    if (
      /\b(agreement|contract|this agreement|hereinafter referred to|witnesseth|in witness whereof|party of the first part|terms and conditions of this)\b/.test(text)
    )
      return "legal_contract";
    if (/\b(kyc|know your customer|customer due diligence)\b/.test(text))
      return "kyc_form";
    return "unknown_document";
  } catch {
    return "unknown_document";
  }
}


// Map common AI aliases → canonical template field keys so Tier-1 required
// checks resolve regardless of which synonym the model used.
const FIELD_ALIASES: Record<string, Record<string, string[]>> = {
  payslip: {
    employee_name: ["name", "full_name", "emp_name", "staff_name"],
    employee_id: ["emp_id", "staff_id", "employee_number", "emp_no"],
    employer: ["employer_name", "company", "company_name", "organisation", "organization"],
    pay_period: ["period", "salary_month", "month", "pay_month", "for_month", "for_the_month_of"],
    pay_date: ["payment_date", "salary_date", "date", "issue_date", "paid_on"],
    gross_pay: ["gross_salary", "gross", "total_earnings", "earnings", "gross_amount", "basic_salary"],
    net_pay: ["net_salary", "net", "take_home", "net_amount", "amount_paid", "salary"],
    deductions: ["total_deductions", "deduction"],
    currency: ["currency_code", "ccy"],
    iban: ["account_iban", "bank_account_iban"],
  },
  swift_mt103: {
    sender: ["sender_name", "ordering_customer", "applicant", "remitter", "sender_details"],
    beneficiary: ["beneficiary_name", "beneficiary_customer", "recipient", "payee", "beneficiary_details"],
    iban: ["account_number", "beneficiary_account", "iban_account_num", "iban_account_number"],
    bic: ["swift_code", "swift_bic", "swift_bic_code", "bic_code", "beneficiary_bank_bic"],
    amount: ["transaction_amount", "transfer_amount", "amount_value"],
    currency: ["currency_code", "ccy", "iso_currency_code"],
    value_date: ["date", "transaction_date", "execution_date", "settlement_date"],
    reference: ["transaction_ref", "transaction_reference", "reference_number", "ref", "trn"],
  },
  kyc_passport: {
    full_name: ["name", "surname_given_names", "given_names", "holder_name"],
    document_number: ["passport_number", "passport_no", "doc_number", "id_number"],
    nationality: ["nation", "country_of_nationality"],
    date_of_birth: ["dob", "birth_date"],
    sex: ["gender"],
    issue_date: ["date_of_issue"],
    expiry_date: ["date_of_expiry", "expiry"],
    issuing_country: ["country", "country_of_issue", "issuing_state"],
    mrz: ["mrz_line", "mrz_lines"],
  },
};

function aliasGroupFor(docType: string): Record<string, string[]> | undefined {
  const t = docType.toLowerCase();
  if (t.includes("swift") || t.includes("remittance") || t.includes("mt103"))
    return FIELD_ALIASES.swift_mt103;
  if (t.includes("passport") || t.includes("kyc")) return FIELD_ALIASES.kyc_passport;
  if (t.includes("salary") || t.includes("payslip")) return FIELD_ALIASES.payslip;
  return undefined;
}

function normalizeFieldAliases(
  docType: string,
  fields: Record<string, string | number | null>,
  confidence: Record<string, number>,
): void {
  const aliases = aliasGroupFor(docType);
  if (!aliases) return;
  const lcKeys = new Map<string, string>();
  for (const k of Object.keys(fields)) lcKeys.set(k.toLowerCase(), k);
  for (const [canonical, alts] of Object.entries(aliases)) {
    const hasCanonical =
      fields[canonical] != null && String(fields[canonical]).trim() !== "";
    if (hasCanonical) continue;
    for (const alt of alts) {
      const sourceKey = lcKeys.get(alt.toLowerCase());
      if (!sourceKey) continue;
      const value = fields[sourceKey];
      if (value == null || String(value).trim() === "") continue;
      fields[canonical] = value;
      if (confidence[sourceKey] !== undefined && confidence[canonical] === undefined) {
        confidence[canonical] = confidence[sourceKey];
      }
      break;
    }
  }
}


function extractFieldsFromText(rawText: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const normalized = rawText.replace(/\r/g, "\n");

  addField(
    fields,
    "iban",
    firstMatch(normalized, [/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){10,30}\b/i]),
  );
  addField(
    fields,
    "bic",
    firstMatch(normalized, [/\b[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/]),
  );
  addField(
    fields,
    "amount",
    firstMatch(normalized, [
      /\b(?:amount|total|net pay|gross pay|salary)\s*[:-]?\s*(?:[A-Z]{3}\s*)?([\d,]+(?:\.\d{2})?)/i,
      /\b([A-Z]{3}\s*[\d,]+(?:\.\d{2})?)\b/,
    ]),
  );
  addField(
    fields,
    "currency",
    firstMatch(normalized, [/\b(USD|EUR|GBP|AED|SAR|INR|JPY|CHF|CAD|AUD)\b/i]),
  );
  addField(
    fields,
    "date",
    firstMatch(normalized, [
      /\b(?:date|issue date|transaction date)\s*[:-]?\s*([0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{2,4})/i,
      /\b([0-9]{4}[./-][0-9]{1,2}[./-][0-9]{1,2})\b/,
    ]),
  );
  addField(
    fields,
    "expiry_date",
    firstMatch(normalized, [
      /\b(?:expiry|expires|expiration|valid until)\s*(?:date)?\s*[:-]?\s*([0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{2,4})/i,
      /\b(?:expiry|expires|expiration|valid until)\s*(?:date)?\s*[:-]?\s*([0-9]{4}[./-][0-9]{1,2}[./-][0-9]{1,2})/i,
    ]),
  );
  addField(
    fields,
    "document_number",
    firstMatch(normalized, [
      /\b(?:passport|document|id|identity|pan|invoice)\s*(?:no|number|#)?\s*[:-]?\s*([A-Z0-9]{5,20})\b/i,
      /\b([A-Z]{5}\d{4}[A-Z])\b/i,
    ]),
  );
  addField(
    fields,
    "full_name",
    firstMatch(normalized, [
      /\b(?:full name|name|customer name|employee name)\s*[:-]?\s*([A-Z][A-Z .'-]{2,80})/i,
    ]),
  );
  addField(
    fields,
    "sender",
    firstMatch(normalized, [
      /\b(?:sender|ordering customer|applicant)\s*[:-]?\s*([A-Z0-9 &.'-]{2,80})/i,
    ]),
  );
  addField(
    fields,
    "beneficiary",
    firstMatch(normalized, [
      /\b(?:beneficiary|beneficiary customer|recipient)\s*[:-]?\s*([A-Z0-9 &.'-]{2,80})/i,
    ]),
  );

  return fields;
}

type SwiftTemplateField = {
  canonical: string;
  aliases: string[];
  regex?: RegExp;
  capture?: (text: string) => string | undefined;
};

function buildSwiftFields(
  regexPatterns: Record<string, string>,
): SwiftTemplateField[] {
  const compile = (key: string) => {
    const src = regexPatterns?.[key];
    if (!src) return undefined;
    try {
      return new RegExp(src, "i");
    } catch {
      return undefined;
    }
  };
  return [
    {
      canonical: "sender",
      aliases: ["sender", "sender_details", "ordering_customer", "applicant", "sender_name", "remitter"],
      capture: (text) =>
        firstMatch(text, [
          /(?:ordering customer|sender(?:\s*name)?|applicant|remitter)\s*[:\-]?\s*([A-Z0-9 &.,'\-\/]{3,120})/i,
          /\b50[KAF]?:\s*([A-Z0-9 &.,'\-\/]{3,120})/i,
        ]),
    },
    {
      canonical: "beneficiary",
      aliases: [
        "beneficiary",
        "beneficiary_details",
        "beneficiary_customer",
        "beneficiary_name",
        "recipient",
        "payee",
      ],
      capture: (text) =>
        firstMatch(text, [
          /(?:beneficiary(?:\s*customer|\s*name)?|recipient|payee)\s*[:\-]?\s*([A-Z0-9 &.,'\-\/]{3,120})/i,
          /\b59A?:\s*([A-Z0-9 &.,'\-\/]{3,120})/i,
        ]),
    },
    {
      canonical: "iban",
      aliases: [
        "iban",
        "iban_account_num",
        "iban_account_number",
        "account_number",
        "account_no",
        "account",
        "beneficiary_account",
        "beneficiary_account_no",
        "beneficiary_account_number",
        "beneficiary_iban",
      ],
      regex: compile("iban") ?? /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/i,
    },
    {
      canonical: "bic",
      aliases: ["bic", "swift_bic_code", "swift_code", "bic_code", "swift_bic", "beneficiary_bank_bic"],
      regex: compile("bic") ?? /\b[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/,
    },
    {
      canonical: "amount",
      aliases: ["amount", "transaction_amount", "transfer_amount", "amount_value"],
      capture: (text) => {
        const m = text.match(/\b[A-Z]{3}\s*([0-9]{1,3}(?:[,\s][0-9]{3})*(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)\b/);
        if (m) return m[1].replace(/[,\s]/g, "");
        const labelled = text.match(/(?:amount|total)\s*[:\-]?\s*(?:[A-Z]{3}\s*)?([0-9][0-9,\s]*(?:\.[0-9]{2})?)/i);
        return labelled?.[1]?.replace(/[,\s]/g, "");
      },
    },
    {
      canonical: "currency",
      aliases: ["currency", "currency_code", "ccy", "iso_currency_code", "amount_currency"],
      capture: (text) => {
        const m = text.match(/\b(USD|EUR|GBP|AED|SAR|INR|JPY|CHF|CAD|AUD|SGD|HKD|CNY|QAR|KWD|BHD|OMR)\b/);
        return m?.[1];
      },
    },
    {
      canonical: "value_date",
      aliases: ["value_date", "date", "transaction_date", "execution_date", "settlement_date"],
      capture: (text) =>
        firstMatch(text, [
          /(?:value date|transaction date|execution date|settlement date|date)\s*[:\-]?\s*([0-9]{4}[./\-][0-9]{1,2}[./\-][0-9]{1,2})/i,
          /(?:value date|transaction date|execution date|settlement date|date)\s*[:\-]?\s*([0-9]{1,2}[./\-][0-9]{1,2}[./\-][0-9]{2,4})/i,
          /\b32A:\s*([0-9]{6})/,
        ]),
    },
    {
      canonical: "reference",
      aliases: [
        "reference",
        "transaction_ref",
        "transaction_reference",
        "reference_number",
        "ref",
        "trn",
      ],
      capture: (text) =>
        firstMatch(text, [
          /(?:transaction reference|reference(?:\s*number)?|ref(?:erence)? no\.?|trn)\s*[:\-]?\s*([A-Z0-9\-\/]{4,35})/i,
          /\b20:\s*([A-Z0-9\-\/]{4,35})/i,
        ]),
    },
  ];
}

function regexCheck(
  spec: SwiftTemplateField,
  value: string | number | null | undefined,
): boolean {
  if (value === undefined || value === null) return false;
  const s = String(value).trim();
  if (!s) return false;
  if (spec.regex) return spec.regex.test(s);
  return s.length >= 2;
}

function applySwiftTemplateExtraction(
  rawText: string,
  modelFields: Record<string, string | number | null>,
  regexPatterns: Record<string, string>,
): {
  fields: Record<string, string | number | null>;
  sources: Record<string, "template" | "ai">;
} {
  const merged: Record<string, string | number | null> = { ...modelFields };
  const sources: Record<string, "template" | "ai"> = {};
  const specs = buildSwiftFields(regexPatterns);

  for (const spec of specs) {
    // Deterministic regex/capture pass
    let templateValue: string | undefined;
    if (spec.capture) templateValue = spec.capture(rawText);
    if (!templateValue && spec.regex) {
      const m = rawText.match(spec.regex);
      templateValue = m?.[0];
    }
    if (templateValue) templateValue = templateValue.trim().replace(/\s+/g, " ");

    // Find model value across canonical + aliases
    let modelKey: string | undefined;
    let modelValue: string | number | null | undefined;
    for (const k of [spec.canonical, ...spec.aliases]) {
      if (modelFields[k] !== undefined && modelFields[k] !== null) {
        modelKey = k;
        modelValue = modelFields[k];
        break;
      }
    }

    const templateValid = templateValue
      ? regexCheck(spec, templateValue)
      : false;
    const modelValid = regexCheck(spec, modelValue);

    if (templateValid) {
      merged[spec.canonical] = templateValue as string;
      sources[spec.canonical] = "template";
    } else if (modelValue !== undefined && modelValue !== null) {
      merged[spec.canonical] = modelValue;
      sources[spec.canonical] = modelValid ? "ai" : "ai";
    }
    // Strip duplicate alias keys (keep canonical only)
    if (sources[spec.canonical]) {
      for (const k of spec.aliases) {
        if (k !== spec.canonical && k in merged) delete merged[k];
      }
    }
  }
  return { fields: merged, sources };
}

// --- Deterministic fallback extractors for payslip & kyc/passport ----------
// PDFs typically render as "Label\n\nValue". Build a label→value map by
// pairing each label-looking line with the next non-empty line, and also
// honoring inline "Label: value" forms. Used to backfill fields the AI
// model failed to return.
function buildLabelValueMap(text: string): Record<string, string> {
  const lines = text
    .replace(/\r/g, "\n")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const out: Record<string, string> = {};
  const labelLike = (s: string) =>
    /^[A-Za-z][A-Za-z &/()\-]{1,60}$/.test(s) && !/\d/.test(s);
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const inline = ln.match(/^([A-Za-z][A-Za-z &/()\-]{1,60}?)\s*[:\-]\s*(.+)$/);
    if (inline) {
      out[inline[1].trim().toLowerCase()] = inline[2].trim();
      continue;
    }
    if (labelLike(ln) && i + 1 < lines.length) {
      // Pair label with the next non-empty line as its value (works for
      // text-valued fields like names/countries that also look label-like).
      out[ln.toLowerCase()] = lines[i + 1];
    }
  }
  return out;
}

function extractPayslipFields(rawText: string): Record<string, string> {
  const lm = buildLabelValueMap(rawText);
  const pick = (keys: string[]) => {
    for (const k of keys) if (lm[k]) return lm[k];
    return undefined;
  };
  const f: Record<string, string> = {};
  const set = (k: string, v?: string) => {
    if (v) f[k] = v;
  };
  set("employee_name", pick(["employee name", "employee", "name", "full name"]));
  set("employee_id", pick(["employee id", "emp id", "staff id"]));
  set("employer", pick(["employer", "company", "company name", "organisation", "organization"]));
  set("pay_date", pick(["payment date", "pay date", "salary date", "paid on"]));
  set("gross_pay", pick(["gross pay", "gross salary", "total earnings"]));
  set("net_pay", pick(["net pay", "net salary", "take home", "net amount", "amount paid"]));
  set("iban", pick(["iban"]));
  set("currency", pick(["currency", "currency code"]));
  const ps = lm["period start"];
  const pe = lm["period end"];
  if (ps && pe) f["pay_period"] = `${ps} – ${pe}`;
  else set("pay_period", pick(["pay period", "period", "salary month", "month", "for the month of"]));
  if (!f["employer"]) {
    const m = rawText.match(/Employer\s*[:\-]\s*([^\n·\r]+)/i);
    if (m) f["employer"] = m[1].trim();
  }
  if (!f["currency"]) {
    const m = rawText.match(/\b(AED|USD|EUR|GBP|SAR|INR|JPY|CHF|CAD|AUD|OMR|KWD|QAR|BHD|JOD|EGP|PKR|TRY|SGD|HKD|CNY|ZAR|NZD)\b/);
    if (m) f["currency"] = m[1];
  }
  if (!f["net_pay"]) {
    const m = rawText.match(/Net pay[^\n]*\n+\s*[A-Z]{3}?\s*([\d,]+(?:\.\d{2})?)/i);
    if (m) f["net_pay"] = m[1];
  }
  if (!f["gross_pay"]) {
    const m = rawText.match(/Gross pay[^\n]*\n+\s*[A-Z]{3}?\s*([\d,]+(?:\.\d{2})?)/i);
    if (m) f["gross_pay"] = m[1];
  }
  return f;
}

function extractPassportFields(rawText: string): Record<string, string> {
  const lm = buildLabelValueMap(rawText);
  const pick = (keys: string[]) => {
    for (const k of keys) if (lm[k]) return lm[k];
    return undefined;
  };
  const f: Record<string, string> = {};
  const set = (k: string, v?: string) => {
    if (v) f[k] = v;
  };
  set("full_name", pick(["full name", "name", "surname / given names", "given names", "holder name"]));
  set(
    "document_number",
    pick(["document number", "passport number", "passport no", "id number", "doc number"]),
  );
  set("nationality", pick(["nationality"]));
  set("date_of_birth", pick(["date of birth", "dob", "birth date"]));
  set("sex", pick(["sex", "gender"]));
  set("issue_date", pick(["issue date", "date of issue"]));
  set("expiry_date", pick(["expiry date", "date of expiry", "expiry", "valid until"]));
  set(
    "issuing_country",
    pick(["issuing country", "country of issue", "country", "issuing state"]),
  );
  return f;
}

// Convert Arabic-Indic digits (٠-٩) to Western (0-9).
function arDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => {
    const code = d.charCodeAt(0);
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
    if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
    return d;
  });
}

function extractRemittanceFormFields(rawText: string): Record<string, string> {
  const text = arDigits(rawText);
  const lm = buildLabelValueMap(text);
  const pick = (keys: string[]) => {
    for (const k of keys) if (lm[k]) return lm[k];
    return undefined;
  };
  const f: Record<string, string> = {};
  const set = (k: string, v?: string) => {
    if (v) f[k] = v.trim();
  };
  set("date", pick(["date", "التاريخ", "تاريخ"]));
  set("account_number", pick(["a/c number", "account number", "account no", "رقم الحساب"]));
  set("customer_name", pick(["customer name", "applicant name", "name", "اسم العميل", "اسم مقدم الطلب"]));
  set("nationality", pick(["nationality", "الجنسية"]));
  set("id_type", pick(["id type", "نوع الهوية", "نوع الإثبات"]));
  set("id_number", pick(["id number", "id no", "رقم الهوية"]));
  set("id_expiry", pick(["id expiry", "expiry date", "تاريخ الانتهاء"]));
  set("remittance_type", pick(["remittance type", "نوع الحوالة"]));
  set("amount_in_words", pick(["amount in words", "المبلغ كتابة", "المبلغ بالحروف"]));
  set("amount_figures", pick(["amount", "amount in figures", "المبلغ", "المبلغ بالأرقام"]));
  set("currency", pick(["currency", "العملة", "عملة"]));
  set("beneficiary_name", pick(["beneficiary name", "beneficiary", "المستفيد", "اسم المستفيد"]));
  set("beneficiary_address", pick(["beneficiary address", "عنوان المستفيد"]));
  set("beneficiary_country", pick(["beneficiary country", "country", "دولة المستفيد"]));
  set("beneficiary_bank", pick(["beneficiary bank", "bank name", "بنك المستفيد", "اسم البنك"]));
  set("swift_bic", pick(["swift", "bic", "swift / bic", "swift code", "سويفت"]));
  set("beneficiary_iban", pick(["iban", "beneficiary iban", "آيبان"]));
  set("purpose_of_remittance", pick(["purpose of remittance", "purpose", "غرض الحوالة", "الغرض"]));
  if (!f["beneficiary_iban"]) {
    const m = text.match(/\b([A-Z]{2}[0-9]{2}[A-Z0-9]{4,30})\b/);
    if (m) f["beneficiary_iban"] = m[1];
  }
  if (!f["currency"]) {
    const m = text.match(/\b(AED|USD|EUR|GBP|SAR|INR|JPY|CHF|CAD|AUD|OMR|KWD|QAR|BHD|JOD|EGP|PKR|TRY|SGD|HKD|CNY|ZAR|NZD)\b/);
    if (m) f["currency"] = m[1];
  }
  return f;
}

function extractCashSlipFields(rawText: string): Record<string, string> {
  const text = arDigits(rawText);
  const lm = buildLabelValueMap(text);
  const pick = (keys: string[]) => {
    for (const k of keys) if (lm[k]) return lm[k];
    return undefined;
  };
  const f: Record<string, string> = {};
  const set = (k: string, v?: string) => {
    if (v) f[k] = v.trim();
  };
  set("cheque_type", pick(["cheque type", "نوع الشيك"]));
  set("cheque_number", pick(["cheque number", "cheque no", "رقم الشيك"]));
  set("currency", pick(["currency", "عملة", "العملة"]));
  set("account_number", pick(["account number", "debit account", "حساب الخصم", "رقم الحساب"]));
  set("amount", pick(["amount", "المبلغ"]));
  set("beneficiary", pick(["beneficiary", "payee", "المستفيد"]));
  set("transaction_date", pick(["date", "transaction date", "تاريخ العملية", "التاريخ"]));
  return f;
}

function extractAccountOpeningFields(rawText: string): Record<string, string> {
  const text = arDigits(rawText);
  const lm = buildLabelValueMap(text);
  const pick = (keys: string[]) => {
    for (const k of keys) if (lm[k]) return lm[k];
    return undefined;
  };
  const f: Record<string, string> = {};
  const set = (k: string, v?: string) => {
    if (v) f[k] = v.trim();
  };
  set("customer_name", pick(["customer name", "name", "اسم العميل"]));
  set("id_number", pick(["id number", "national id", "رقم الهوية"]));
  set("id_type", pick(["id type", "نوع الهوية"]));
  set("nationality", pick(["nationality", "الجنسية"]));
  set("date_of_birth", pick(["date of birth", "dob", "تاريخ الميلاد"]));
  set("address", pick(["address", "العنوان"]));
  set("phone", pick(["phone", "mobile", "telephone", "الجوال", "الهاتف", "رقم الجوال"]));
  set("email", pick(["email", "e-mail", "البريد الإلكتروني"]));
  set("account_type", pick(["account type", "نوع الحساب"]));
  set("branch", pick(["branch", "branch name", "الفرع", "اسم الفرع"]));
  return f;
}

function extractLoanContractFields(rawText: string): Record<string, string> {
  const text = arDigits(rawText);
  const lm = buildLabelValueMap(text);
  const pick = (keys: string[]) => {
    for (const k of keys) if (lm[k]) return lm[k];
    return undefined;
  };
  const f: Record<string, string> = {};
  const set = (k: string, v?: string) => {
    if (v) f[k] = v.trim();
  };
  set("contract_number", pick(["contract number", "contract no", "رقم العقد"]));
  set("customer_name", pick(["customer name", "borrower", "name", "اسم العميل", "اسم المتمول"]));
  set("id_number", pick(["id number", "national id", "رقم الهوية"]));
  set("loan_amount", pick(["loan amount", "financing amount", "مبلغ التمويل", "مبلغ القرض"]));
  set("profit_rate", pick(["profit rate", "interest rate", "نسبة الربح", "معدل الربح"]));
  set("number_of_installments", pick(["number of installments", "no of installments", "عدد الأقساط"]));
  set("installment_amount", pick(["installment amount", "monthly installment", "قسط شهري", "مبلغ القسط"]));
  set("contract_date", pick(["contract date", "date", "تاريخ العقد"]));
  set("maturity_date", pick(["maturity date", "end date", "تاريخ الاستحقاق", "تاريخ الانتهاء"]));
  set("branch_code", pick(["branch code", "branch", "رمز الفرع", "الفرع"]));
  return f;
}

function applyDeterministicFallback(
  docType: string,
  rawText: string,
  fields: Record<string, string | number | null>,
  fieldConfidence: Record<string, number>,
  extractionSource: Record<string, "template" | "ai">,
  fieldDetails?: FieldDetailsMap,
): void {
  const t = docType.toLowerCase();
  let det: Record<string, string> = {};
  if (t.includes("payslip") || t.includes("salary"))
    det = extractPayslipFields(rawText);
  else if (t.includes("passport") || t.includes("kyc"))
    det = extractPassportFields(rawText);
  else if (t.includes("remittance"))
    det = extractRemittanceFormFields(rawText);
  else if (t.includes("cash_slip") || t.includes("cash slip") || t.includes("cheque"))
    det = extractCashSlipFields(rawText);
  else if (t.includes("account_opening") || t.includes("account opening"))
    det = extractAccountOpeningFields(rawText);
  else if (t.includes("loan") || t.includes("financing") || t.includes("contract"))
    det = extractLoanContractFields(rawText);
  else return;
  for (const [k, v] of Object.entries(det)) {
    // Never overwrite a field the model explicitly marked as redacted —
    // the value is intentionally obscured in the source and a heuristic
    // guess would be misleading.
    if (fieldDetails && fieldDetails[k]?.status === "redacted") continue;
    const cur = fields[k];
    if (cur == null || String(cur).trim() === "") {
      fields[k] = v;
      if (fieldConfidence[k] === undefined) fieldConfidence[k] = 0.7;
      if (!extractionSource[k]) extractionSource[k] = "template";
      // Mirror into field_details so downstream consumers see a value entry.
      if (fieldDetails && !fieldDetails[k]) {
        fieldDetails[k] = { status: "value", value: v, page: null, confidence: 0.7 };
      }
    }
  }
}

// Merge a per-batch field_details object into the running merged map.
// Precedence: status="value" > "redacted" > "not_present"; on same status,
// higher confidence wins. Page numbers/evidence from the chosen entry are
// preserved. Mutates `merged` in place.
function mergeFieldDetails(
  merged: FieldDetailsMap,
  incoming: FieldDetailsMap | undefined,
): void {
  if (!incoming) return;
  const rank = (s: FieldDetail["status"]) =>
    s === "value" ? 2 : s === "redacted" ? 1 : 0;
  for (const [k, next] of Object.entries(incoming)) {
    if (!next || typeof next !== "object" || !next.status) continue;
    const cur = merged[k];
    if (!cur) {
      merged[k] = next;
      continue;
    }
    const dr = rank(next.status) - rank(cur.status);
    if (dr > 0) {
      merged[k] = next;
    } else if (dr === 0 && (next.confidence ?? 0) > (cur.confidence ?? 0)) {
      merged[k] = next;
    }
  }
}

// Rebuild the flat fields + confidence maps from a field_details map,
// keeping only entries with status="value" and a non-empty value.
function syncFieldsFromDetails(
  details: FieldDetailsMap,
  fields: Record<string, string | number | null>,
  fieldConfidence: Record<string, number>,
): void {
  for (const [k, d] of Object.entries(details)) {
    if (d?.status !== "value") continue;
    const v = d.value;
    if (v == null || String(v).trim() === "") continue;
    if (fields[k] == null || String(fields[k]).trim() === "") {
      fields[k] = v;
    }
    if (fieldConfidence[k] === undefined && typeof d.confidence === "number") {
      fieldConfidence[k] = d.confidence;
    }
  }
}

// Minimum raw_text chars per page below which we consider the vision
// extraction "sparse" and supplement it with a direct OCR.space pass.
// The downstream sanity gate requires 80 chars/page; we aim higher here
// so the supplement provides meaningful headroom for field extraction.
const SUPPLEMENT_YIELD_THRESHOLD = 80;

// Run OCR.space across every image in a batch (best-effort, parallel) and
// append the recovered text to the batch's raw_text. Used when the primary
// vision extractor returned suspiciously little text — typical of large
// image-only Arabic scans where GPT-5 sometimes truncates per-page output.
async function supplementBatchWithOcrSpace(
  batchParsed: Parsed,
  batchArgs: ExtractionArgs,
  pageOffset: number,
  emit: (obj: unknown) => void,
  forceArabic: boolean,
): Promise<void> {
  const images = getImagePages(batchParsed);
  if (images.length === 0) return;
  const currentText = batchArgs.raw_text ?? "";
  const perPage = currentText.length / images.length;
  if (perPage >= SUPPLEMENT_YIELD_THRESHOLD) return;

  const arabic =
    forceArabic ||
    Boolean(batchArgs.arabic) ||
    isArabicHeavy(currentText) ||
    (batchArgs.language ?? "").toLowerCase().startsWith("ar");
  const lang = arabic ? "ara" : process.env.OCR_SPACE_LANGUAGE || "eng";

  emit({
    step: "ocr_supplement",
    message: `Sparse vision output (${perPage.toFixed(0)} chars/page) — supplementing with backup OCR${arabic ? " (Arabic)" : ""}`,
  });

  const recovered = await Promise.all(
    images.map(async (img, idx) => {
      const absPage = pageOffset + idx + 1;
      try {
        const txt = await runOcrSpacePage(img, absPage, lang);
        return `--- Page ${absPage} (supplement) ---\n${txt}`;
      } catch (e) {
        emit({
          step: "ocr_supplement_warn",
          message: `Backup OCR failed for page ${absPage}: ${getErrorMessage(e)}`,
        });
        return "";
      }
    }),
  );
  const supplementText = recovered.filter(Boolean).join("\n\n").trim();
  if (!supplementText) return;

  batchArgs.raw_text = currentText
    ? `${currentText}\n\n${supplementText}`
    : supplementText;
  if (arabic) {
    batchArgs.arabic = true;
    if (!batchArgs.language) batchArgs.language = "ara";
  }
  emit({
    step: "ocr_supplement_done",
    message: `Backup OCR added ${supplementText.length} chars across ${images.length} page(s)`,
  });
}

async function runFreeOcrExtraction(
  parsed: Parsed,
  emit: (obj: unknown) => void,
  forceArabic: boolean,
): Promise<ExtractionArgs> {
  const isTextInput = "kind" in parsed && parsed.kind === "text";

  const ocrPages = async (lang?: string) =>
    (
      await Promise.all(
        getImagePages(parsed).map(async (image, index) => {
          emit({
            step: "ocr_page",
            message: `OCR page ${index + 1}${lang === "ara" ? " (Arabic)" : ""}`,
          });
          const text = await runOcrSpacePage(image, index + 1, lang);
          return `--- Page ${index + 1} ---\n${text}`;
        }),
      )
    )
      .join("\n\n")
      .trim();

  let rawText: string;
  let rawTextEnglish: string | undefined;
  let arabic = false;
  let language = process.env.OCR_SPACE_LANGUAGE || "eng";

  if (isTextInput) {
    rawText = (parsed as { text: string }).text;
    arabic = forceArabic || isArabicHeavy(rawText);
    if (arabic) language = "ara";
  } else if (forceArabic) {
    emit({ step: "ocr_lang", message: "Arabic mode forced — lang=ara" });
    rawText = await ocrPages("ara");
    arabic = true;
    language = "ara";
  } else {
    rawText = await ocrPages();
    if (isArabicHeavy(rawText)) {
      arabic = true;
      language = "ara";
      emit({
        step: "ocr_lang",
        message: `Arabic detected (${Math.round(arabicRatio(rawText) * 100)}%) — re-running with lang=ara`,
      });
      rawTextEnglish = rawText;
      try {
        rawText = await ocrPages("ara");
      } catch (e) {
        // Fall back to English pass if Arabic re-run fails.
        emit({
          step: "ocr_lang",
          message: `Arabic re-run failed (${getErrorMessage(e)}) — keeping English text`,
        });
        rawText = rawTextEnglish;
        rawTextEnglish = undefined;
      }
    }
  }

  const fields = extractFieldsFromText(rawText);
  const documentType = classifyFromText(parsed.fileName, rawText);
  const fieldConfidence = Object.fromEntries(
    Object.keys(fields).map((key) => [key, 0.62]),
  );

  return {
    document_type: documentType,
    classification_confidence:
      documentType === "unknown_document" ? 0.45 : 0.65,
    language,
    raw_text: rawText,
    fields,
    field_confidence: fieldConfidence,
    arabic,
    raw_text_english: rawTextEnglish,
  };
}


export const Route = createFileRoute("/api/process-stream")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let parsed: Parsed;
        try {
          parsed = inputSchema.parse(await request.json());
        } catch (e) {
          return new Response(JSON.stringify({ error: "Invalid input" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const openaiKey = process.env.OPENAI_API_KEY;
        const geminiKey = process.env.GEMINI_API_KEY;
        const primaryLabel = "extraction";

        const fileName = parsed.fileName;
        const isText = "kind" in parsed && parsed.kind === "text";
        const forceArabic = Boolean(
          (parsed as { forceArabic?: boolean }).forceArabic,
        );
        const pageCount =
          "kind" in parsed && (parsed.kind === "images" || parsed.kind === "pdf")
            ? parsed.images.length
            : undefined;
        // Deterministic page count from the actual PDF rasterization step on
        // the client. Vision-extracted page_count is informational only and
        // gets overwritten with this value before validation/storage.
        const deterministicPageCount =
          (parsed as { pageCount?: number }).pageCount ?? pageCount ?? 0;


        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            const emit = (obj: unknown) =>
              controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
            const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

            try {
              emit({ step: "received", message: `Received ${fileName}` });
              await sleep(80);
              emit({
                step: "ocr_start",
                message: isText ? "Parsing text..." : "OCR in progress...",
              });

              // Split image inputs into batches so multi-page PDFs don't
              // hit the vision model's context limit (which previously
              // truncated 40+ page docs to only page 1's content).
              type Batch = { parsed: Parsed; pageOffset: number };
              const batches: Batch[] = [];
              let directPdfRawText = "";
              if ("kind" in parsed && parsed.kind === "pdf" && openaiKey) {
                emit({
                  step: "ocr_start",
                  message: "Extracting text...",
                });
                const pdfText = await extractPdfTextWithOpenAI(
                  parsed.fileName,
                  parsed.base64,
                  { arabic: forceArabic },
                );
                if (pdfText.ok && meaningfulTextLength(pdfText.text) >= 50) {
                  directPdfRawText = pdfText.text;
                  emit({
                    step: "ocr_done",
                    rawText: directPdfRawText,
                    message: `Direct PDF text extraction complete · ${directPdfRawText.length} chars`,
                  });
                } else if (!pdfText.ok) {
                  emit({
                    step: "ocr_start",
                    message: "OCR in progress...",
                  });
                }
              }
              // Arabic vision extraction is heavier (larger token output,
              // slower model responses) — use a smaller batch so a single
              // request can't stall the entire stream.
              const effectiveBatchSize =
                parsed.forceArabic === true
                  ? Math.min(3, VISION_API_BATCH_SIZE)
                  : VISION_API_BATCH_SIZE;
              const batchSource: Parsed = directPdfRawText
                ? ({
                    kind: "text",
                    fileName: parsed.fileName,
                    text: directPdfRawText,
                    forceArabic,
                    pageCount: deterministicPageCount,
                  } as Parsed)
                : parsed;
              const batchSourceImages =
                "images" in batchSource ? batchSource.images : undefined;
              if (
                batchSourceImages &&
                batchSourceImages.length > effectiveBatchSize
              ) {
                for (let i = 0; i < batchSourceImages.length; i += effectiveBatchSize) {
                  const slice = batchSourceImages.slice(i, i + effectiveBatchSize);
                  batches.push({
                    parsed: {
                      kind: "images",
                      fileName: batchSource.fileName,
                      images: slice,
                      forceArabic: (batchSource as { forceArabic?: boolean }).forceArabic,
                      pageCount: (batchSource as { pageCount?: number }).pageCount,
                    } as Parsed,
                    pageOffset: i,
                  });
                }
              } else if (batchSourceImages) {
                batches.push({
                  parsed: {
                    kind: "images",
                    fileName: batchSource.fileName,
                    images: batchSourceImages,
                    forceArabic: (batchSource as { forceArabic?: boolean }).forceArabic,
                    pageCount: (batchSource as { pageCount?: number }).pageCount,
                  } as Parsed,
                  pageOffset: 0,
                });
              } else {
                batches.push({ parsed: batchSource, pageOffset: 0 });
              }

              if (batches.length > 1) {
                const splitPageCount =
                  batchSourceImages?.length ??
                  ("kind" in parsed && (parsed.kind === "images" || parsed.kind === "pdf")
                    ? parsed.images.length
                    : 1);
                emit({
                  step: "ocr_start",
                  message: "OCR in progress...",
                });
              }

              const tryGemini = async (batchParsed: Parsed, pageOffset: number): Promise<ExtractionArgs | undefined> => {
                if (!geminiKey) return undefined;
                const batchMessages = [
                  { role: "system" as const, content: SYSTEM_PROMPT },
                  { role: "user" as const, content: buildUserContent(batchParsed, pageOffset) },
                ];
                let result = await extractWithGemini(
                  batchMessages,
                  TOOL,
                  undefined,
                  { arabic: forceArabic },
                );
                if (result.rateLimited) {
                  emit({
                    step: "ocr_start",
                    message: "OCR in progress...",
                  });
                  return await runFreeOcrExtraction(batchParsed, emit, forceArabic);
                }
                if (!result.ok || !result.argsString) return undefined;
                let parsedArgs: ExtractionArgs;
                try {
                  parsedArgs = JSON.parse(result.argsString) as ExtractionArgs;
                } catch {
                  return undefined;
                }
                const firstConf = parsedArgs.classification_confidence ?? 0;
                const detectedArabic =
                  Boolean(parsedArgs.arabic) ||
                  forceArabic ||
                  isArabicHeavy(parsedArgs.raw_text ?? "");
                const usedFlash = result.model.includes("flash");
                if (usedFlash && firstConf < 0.75) {
                  const retry = await extractWithGemini(
                    batchMessages,
                    TOOL,
                    parsedArgs.document_type,
                    { confidence: firstConf, arabic: detectedArabic },
                  );
                  if (retry.ok && retry.argsString) {
                    try {
                      const retryArgs = JSON.parse(
                        retry.argsString,
                      ) as ExtractionArgs;
                      if (
                        (retryArgs.classification_confidence ?? 0) >= firstConf
                      ) {
                        parsedArgs = retryArgs;
                      }
                    } catch {
                      // keep first pass
                    }
                  }
                }
                return parsedArgs;
              };

              // Run primary→fallback chain for a single batch independently.
              const runBatch = async (
                batchParsed: Parsed,
                pageOffset: number,
              ): Promise<{ args: ExtractionArgs; fallback: boolean }> => {
                const batchMessages = [
                  { role: "system" as const, content: SYSTEM_PROMPT },
                  { role: "user" as const, content: buildUserContent(batchParsed, pageOffset) },
                ];
                let batchArgs: ExtractionArgs | undefined;
                let fellBack = false;

                if (isOpenAIConfigured()) {
                  // When the batch input is plain text (already extracted by
                  // the direct PDF reader), use a faster/cheaper model for
                  // classification + structured extraction. The big PDF call
                  // is already done — no need to spend another full gpt-5 pass.
                  const isTextBatch =
                    "kind" in batchParsed && batchParsed.kind === "text";
                  const fastModel =
                    process.env.OPENAI_MODEL_TEXT_FAST || "gpt-5-mini";
                  const result = await extractWithOpenAI(
                    batchMessages,
                    TOOL,
                    undefined,
                    {
                      arabic: forceArabic,
                      forceModel: isTextBatch ? fastModel : undefined,
                    },
                  );
                  if (result.ok && result.argsString) {
                    try {
                      batchArgs = JSON.parse(result.argsString) as ExtractionArgs;
                    } catch {
                      batchArgs = undefined;
                    }
                  }
                  if (!batchArgs) {
                    fellBack = true;
                    const reason = result.rateLimited
                      ? "Primary extractor rate-limited"
                      : !result.ok
                        ? `Primary extractor error ${result.status}`
                        : "Primary extractor returned no structured extraction";
                    emit({
                      step: "ocr_start",
                      message: "OCR in progress...",
                    });
                    batchArgs =
                      (await tryGemini(batchParsed, pageOffset)) ??
                      (await runFreeOcrExtraction(batchParsed, emit, forceArabic));
                  }
                } else if (geminiKey) {
                  fellBack = true;
                  batchArgs =
                    (await tryGemini(batchParsed, pageOffset)) ??
                    (await runFreeOcrExtraction(batchParsed, emit, forceArabic));
                } else {
                  fellBack = true;
                  batchArgs = await runFreeOcrExtraction(batchParsed, emit, forceArabic);
                }

                return { args: batchArgs ?? {}, fallback: fellBack };
              };

              // Wrap runBatch so every batch is checked for sparse vision
              // output and supplemented with backup OCR when needed. This
              // ensures image-only scans (especially large Arabic PDFs)
              // accumulate enough raw_text to clear the sanity gate and
              // feed the deterministic field extractors downstream.
              const runBatchSupplemented = async (
                batchParsed: Parsed,
                pageOffset: number,
              ): Promise<{ args: ExtractionArgs; fallback: boolean }> => {
                const out = await runBatch(batchParsed, pageOffset);
                if (!out.fallback) {
                  try {
                    await supplementBatchWithOcrSpace(
                      batchParsed,
                      out.args,
                      pageOffset,
                      emit,
                      forceArabic,
                    );
                  } catch (e) {
                    emit({
                      step: "ocr_supplement_warn",
                      message: `Backup OCR supplement skipped: ${getErrorMessage(e)}`,
                    });
                  }
                }
                return out;
              };

              let args: ExtractionArgs | undefined;
              let isFallbackExtraction = false;
              const perBatchDiagnostics: Array<{
                batch: number;
                pageRange: string;
                imageCount: number;
                rawTextChars: number;
                fieldsCount: number;
                fallback: boolean;
                docType?: string;
              }> = [];

              if (batches.length === 1) {
                const { args: a, fallback } = await runBatchSupplemented(batches[0].parsed, batches[0].pageOffset);
                args = a;
                isFallbackExtraction = fallback;
                const imgCount = "kind" in batches[0].parsed && batches[0].parsed.kind === "images"
                  ? batches[0].parsed.images.length
                  : isText ? 0 : 1;
                perBatchDiagnostics.push({
                  batch: 1,
                  pageRange: imgCount > 0 ? `1–${imgCount}` : "text",
                  imageCount: imgCount,
                  rawTextChars: (a.raw_text ?? "").length,
                  fieldsCount: Object.keys(a.fields ?? {}).length,
                  fallback,
                  docType: a.document_type,
                });
                emit({
                  step: "batch_done",
                  batch: 1,
                  totalBatches: 1,
                  imageCount: imgCount,
                  pageRange: imgCount > 0 ? `1-${imgCount}` : "text",
                  rawTextChars: (a.raw_text ?? "").length,
                  fieldsCount: Object.keys(a.fields ?? {}).length,
                  fallback,
                  message: `Batch 1/1 · ${(a.raw_text ?? "").length} chars · ${Object.keys(a.fields ?? {}).length} fields${fallback ? " (fallback)" : ""}`,
                });
              } else {
                // Multi-batch: run sequentially to avoid rate limits.
                const merged: ExtractionArgs = {
                  document_type: undefined,
                  classification_confidence: 0,
                  language: undefined,
                  raw_text: "",
                  fields: {},
                  field_confidence: {},
                  field_details: {},
                  pages: [],
                  arabic: false,
                };

                const rawParts: string[] = [];
                const rawEnglishParts: string[] = [];
                let bestConf = -1;
                for (let bi = 0; bi < batches.length; bi++) {
                  const b = batches[bi];
                  const imgCount = "kind" in b.parsed && b.parsed.kind === "images" ? b.parsed.images.length : 0;
                  const firstPage = b.pageOffset + 1;
                  const lastPage = b.pageOffset + imgCount;
                  emit({
                    step: "batch_start",
                    batch: bi + 1,
                    totalBatches: batches.length,
                    imageCount: imgCount,
                    pageRange: `${firstPage}-${lastPage}`,
                    message: `Vision batch ${bi + 1}/${batches.length} · pages ${firstPage}–${lastPage} (${imgCount} images)`,
                  });
                  let batchResult: { args: ExtractionArgs; fallback: boolean };
                  const heartbeat = setInterval(() => {
                    emit({
                      step: "batch_progress",
                      batch: bi + 1,
                      totalBatches: batches.length,
                      message: `Batch ${bi + 1}/${batches.length} · still working on pages ${firstPage}–${lastPage}...`,
                    });
                  }, 15_000);
                  try {
                    batchResult = await runBatchSupplemented(b.parsed, b.pageOffset);
                  } catch (e) {
                    emit({
                      step: "batch_error",
                      batch: bi + 1,
                      message: `Batch ${bi + 1} failed: ${getErrorMessage(e)}`,
                    });
                    batchResult = { args: { raw_text: "", fields: {}, field_confidence: {} }, fallback: true };
                  } finally {
                    clearInterval(heartbeat);
                  }
                  const { args: a, fallback } = batchResult;
                  if (fallback) isFallbackExtraction = true;
                  const rt = a.raw_text ?? "";
                  // Ensure a page marker is present for this batch even if
                  // the model didn't emit one.
                  const marker = `--- Page ${firstPage}${imgCount > 1 ? `–${lastPage}` : ""} ---`;
                  rawParts.push(rt.includes("--- Page ") ? rt : `${marker}\n${rt}`);
                  if (a.raw_text_english) rawEnglishParts.push(a.raw_text_english);
                  // Merge fields: first non-empty wins.
                  const aFields = (a.fields ?? {}) as Record<string, string | number | null>;
                  const aConf = (a.field_confidence ?? {}) as Record<string, number>;
                  for (const [k, v] of Object.entries(aFields)) {
                    if (v == null || String(v).trim() === "") continue;
                    const cur = merged.fields![k];
                    if (cur == null || String(cur).trim() === "") {
                      merged.fields![k] = v;
                      if (aConf[k] !== undefined) merged.field_confidence![k] = aConf[k];
                    } else if (aConf[k] !== undefined && (merged.field_confidence![k] ?? 0) < aConf[k]) {
                      merged.field_confidence![k] = aConf[k];
                    }
                  }
                  // Merge per-field metadata (status/page/confidence/evidence).
                  mergeFieldDetails(merged.field_details!, a.field_details);
                  // Accumulate per-page boundary metadata. Trust the model's
                  // absolute page numbers; fall back to pageOffset+index if missing.
                  if (Array.isArray(a.pages)) {
                    for (let pi = 0; pi < a.pages.length; pi++) {
                      const p = a.pages[pi];
                      if (!p) continue;
                      const abs =
                        typeof p.page === "number" && p.page > 0
                          ? p.page
                          : b.pageOffset + pi + 1;
                      merged.pages!.push({ ...p, page: abs });
                    }
                  }
                  // Pick document_type from the batch with highest confidence

                  // (preferring non-"unknown" classifications).
                  const conf = a.classification_confidence ?? 0;
                  const dt = (a.document_type ?? "").toLowerCase();
                  const isUnknown = !dt || dt.includes("unknown");
                  if (!isUnknown && conf > bestConf) {
                    bestConf = conf;
                    merged.document_type = a.document_type;
                    merged.classification_confidence = conf;
                  }
                  if (a.arabic || (a.language ?? "").toLowerCase().startsWith("ar")) {
                    merged.arabic = true;
                    merged.language = "ara";
                  } else if (!merged.language) {
                    merged.language = a.language;
                  }
                  perBatchDiagnostics.push({
                    batch: bi + 1,
                    pageRange: `${firstPage}-${lastPage}`,
                    imageCount: imgCount,
                    rawTextChars: rt.length,
                    fieldsCount: Object.keys(aFields).length,
                    fallback,
                    docType: a.document_type,
                  });
                  emit({
                    step: "batch_done",
                    batch: bi + 1,
                    totalBatches: batches.length,
                    imageCount: imgCount,
                    pageRange: `${firstPage}-${lastPage}`,
                    rawTextChars: rt.length,
                    fieldsCount: Object.keys(aFields).length,
                    fallback,
                    docType: a.document_type,
                    message: `Batch ${bi + 1}/${batches.length} · pages ${firstPage}–${lastPage} · ${rt.length} chars · ${Object.keys(aFields).length} fields${fallback ? " (fallback)" : ""}`,
                  });
                }
                merged.raw_text = rawParts.join("\n\n").trim();
                if (rawEnglishParts.length) merged.raw_text_english = rawEnglishParts.join("\n\n").trim();
                if (!merged.document_type) {
                  // No batch produced a confident classification — fall back
                  // to keyword-based classification over the merged text.
                  merged.document_type = classifyFromText(fileName, merged.raw_text ?? "");
                  merged.classification_confidence = 0.5;
                }
                args = merged;
                emit({
                  step: "batch_summary",
                  batches: perBatchDiagnostics,
                  totalChars: (merged.raw_text ?? "").length,
                  totalFields: Object.keys(merged.fields ?? {}).length,
                  message: `Merged ${batches.length} batches · ${(merged.raw_text ?? "").length} total chars · ${Object.keys(merged.fields ?? {}).length} fields${isFallbackExtraction ? " (some fallback)" : ""}`,
                });
              }

              if (
                directPdfRawText &&
                meaningfulTextLength(directPdfRawText) >
                  meaningfulTextLength(args.raw_text ?? "")
              ) {
                args.raw_text = directPdfRawText;
                args.arabic = args.arabic || forceArabic || isArabicHeavy(directPdfRawText);
                if (args.arabic && !args.language) args.language = "ara";
              }





              const docType: string = args.document_type ?? "Unknown";
              const classificationConfidence: number =
                args.classification_confidence ?? 0;
              const language: string = args.language ?? "unknown";
              const rawText: string = args.raw_text ?? "";
              const fields = (args.fields ?? {}) as Record<
                string,
                string | number | null
              >;
              const fieldConfidence = (args.field_confidence ?? {}) as Record<
                string,
                number
              >;
              const fieldDetails: FieldDetailsMap = (args.field_details ?? {}) as FieldDetailsMap;
              // Ensure the flat fields/confidence maps reflect every status="value"
              // entry the model emitted via field_details (covers cases where the
              // model populated only field_details).
              syncFieldsFromDetails(fieldDetails, fields, fieldConfidence);
              let extractionSource: Record<string, "template" | "ai"> = {};

              // Task 9 — Arabic detection. Free-OCR path may already set this;
              // for the AI path, derive it from raw_text post-hoc (no re-run).
              const arabic =
                Boolean(args.arabic) || forceArabic || isArabicHeavy(rawText);
              const rawTextEnglish = args.raw_text_english;
              if (arabic) {
                console.log(
                  `[process-stream] Arabic document detected (forced=${forceArabic}, ratio=${arabicRatio(rawText).toFixed(2)})`,
                );
              }


              // Load active templates once (used for SWIFT extraction + validation).
              let templates: TemplateSpec[] = [];
              try {
                const supabaseUrl = process.env.SUPABASE_URL;
                const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;
                if (supabaseUrl && supabaseKey) {
                  const sb = createClient<Database>(supabaseUrl, supabaseKey, {
                    auth: {
                      storage: undefined,
                      persistSession: false,
                      autoRefreshToken: false,
                    },
                  });
                  const { data: tplRows } = await sb
                    .from("templates")
                    .select("template_key, fields, regex_patterns")
                    .eq("active", true);
                  if (tplRows) templates = tplRows as TemplateSpec[];
                }
              } catch {
                // Templates are optional; fall back to built-in defaults.
              }

              // Normalize alias keys → canonical names BEFORE any template
              // extraction so downstream consumers see consistent keys.
              normalizeFieldAliases(docType, fields, fieldConfidence);

              // Task 6 — deterministic template extraction for SWIFT MT103.
              if (
                docType === "swift_mt103" ||
                docType === "swift_remittance" ||
                docType.toLowerCase().includes("swift") ||
                docType.toLowerCase().includes("remittance")
              ) {
                const swiftTpl =
                  templates.find((t) => t.template_key === "swift_remittance") ??
                  templates.find((t) => t.template_key === "swift_mt103");
                const patterns = (swiftTpl?.regex_patterns ?? {}) as Record<
                  string,
                  string
                >;
                const { fields: mergedFields, sources } =
                  applySwiftTemplateExtraction(rawText, fields, patterns);
                for (const k of Object.keys(fields)) delete fields[k];
                Object.assign(fields, mergedFields);
                extractionSource = sources;
                const fromTemplate = Object.entries(sources)
                  .filter(([, v]) => v === "template")
                  .map(([k]) => k);
                const fromAi = Object.entries(sources)
                  .filter(([, v]) => v === "ai")
                  .map(([k]) => k);
                console.log(
                  `[process-stream] SWIFT extraction · template=[${fromTemplate.join(", ") || "—"}] ai=[${fromAi.join(", ") || "—"}]`,
                );
              }

              // Deterministic fallback for non-SWIFT doctypes — backfill any
              // required fields the AI omitted (gemini sometimes returns {}).
              // Will NOT overwrite a field flagged redacted in field_details.
              applyDeterministicFallback(
                docType,
                rawText,
                fields,
                fieldConfidence,
                extractionSource,
                fieldDetails,
              );

              // Deterministic page count from the actual PDF rasterization
              // step always wins over any vision-extracted page_count value.
              if (deterministicPageCount > 0) {
                fields.page_count = deterministicPageCount;
                fieldConfidence.page_count = 1;
                extractionSource.page_count = "template";
              }




              emit({
                step: "classified",
                documentType: docType,
                classificationConfidence,
                language,
                message: `Classified as ${docType}`,
              });
              await sleep(120);

              emit({
                step: "ocr_done",
                rawText,
                message: `${isText ? "Text parse" : "OCR"} complete · ${rawText.length} chars`,
              });
              await sleep(120);

              const entries = Object.entries(fields);
              const partial: Record<string, string | number | null> = {};
              const partialConf: Record<string, number> = {};
              const chunkSize = Math.max(1, Math.ceil(entries.length / 6));
              for (let i = 0; i < entries.length; i += chunkSize) {
                for (const [k, v] of entries.slice(i, i + chunkSize)) {
                  partial[k] = v;
                  if (fieldConfidence[k] !== undefined)
                    partialConf[k] = fieldConfidence[k];
                }
                emit({
                  step: "field_chunk",
                  fields: { ...partial },
                  fieldConfidence: { ...partialConf },
                  fieldDetails,
                  message: `Extracted ${Object.keys(partial).length}/${entries.length} fields`,
                });
                await sleep(100);
              }
              emit({
                step: "extracted",
                fields,
                fieldConfidence,
                fieldDetails,
                message: `Extracted ${entries.length} fields`,
              });
              await sleep(100);

              emit({
                step: "validate_start",
                message: "Running validation shield…",
              });
              await sleep(100);
              // templates already loaded above
              // Normalize alias keys → canonical template keys so Tier-1
              // required-field checks resolve correctly.
              normalizeFieldAliases(docType, fields, fieldConfidence);

              const validation: ValidationCheck[] = runValidationShield(
                docType,
                fields,
                templates,
                fieldDetails,
              );

              // Post-OCR sanity checks — hard gates. Any failure here forces
              // exception_queue regardless of other tiers, and a fallback
              // extraction always fails the OCR-yield gate.
              const sanityChecks = runSanityChecks({
                docType,
                rawText,
                pageCount: deterministicPageCount,
                fields,
                isFallbackExtraction,
                fieldDetails,
              });
              validation.push(...sanityChecks);

              for (const c of validation) {
                emit({ step: "validate_check", check: c });
                await sleep(40);
              }
              emit({
                step: "validated",
                validation,
                message: "Validation complete",
              });

              const sanityFail = sanityChecks.find((c) => c.status === "fail");
              const anyFail = validation.some((c) => c.status === "fail");
              const anyWarn = validation.some((c) => c.status === "warn");
              const lowConfidence = classificationConfidence < 0.5;
              const decision: "auto_approve" | "exception_queue" =
                sanityFail || anyFail || anyWarn || lowConfidence
                  ? "exception_queue"
                  : "auto_approve";
              const decisionReason = sanityFail
                ? `Sanity check failed — ${sanityFail.detail ?? sanityFail.label}`
                : anyFail
                  ? "Validation tier failed — human review required."
                  : anyWarn
                    ? "Tier-2 warning raised — compliance review recommended."
                    : lowConfidence
                      ? "Confidence below threshold — human verification."
                      : "All checks passed — auto-approved for downstream delivery.";



              emit({
                step: "done",
                result: {
                  documentType: docType,
                  classificationConfidence,
                  language,
                  rawText,
                  fields,
                  fieldConfidence,
                  fieldDetails,
                  extractionSource,
                  validation,
                  decision,
                  decisionReason,
                  arabic,
                  rawTextEnglish,
                  isFallbackExtraction,
                  pageCount: deterministicPageCount,
                  pages: (() => {
                    const raw = (args.pages ?? []) as PageMeta[];
                    // Dedupe by absolute page (keep highest-confidence entry) and sort.
                    const byPage = new Map<number, PageMeta>();
                    for (const p of raw) {
                      if (!p || typeof p.page !== "number") continue;
                      const cur = byPage.get(p.page);
                      if (!cur || (p.confidence ?? 0) > (cur.confidence ?? 0)) {
                        byPage.set(p.page, p);
                      }
                    }
                    return Array.from(byPage.values()).sort((a, b) => a.page - b.page);
                  })(),
                },

              });

              controller.close();
            } catch (err: unknown) {
              try {
                emit({
                  step: "error",
                  message: getErrorMessage(err),
                });
              } catch {
                // The stream may already be closed.
              }
              controller.close();
            }
          },
        });

        return new Response(stream, {
          status: 200,
          headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
          },
        });
      },
    },
  },
});
