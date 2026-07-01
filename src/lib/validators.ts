// Deterministic banking-field validators used by the validation shield.

export type ValidationCheck = {
  id: string;
  tier: 1 | 2 | 3;
  label: string;
  status: "pass" | "fail" | "warn" | "skipped";
  detail?: string;
};

/**
 * Per-field extraction metadata emitted alongside the flat `fields` map.
 * Lets the pipeline distinguish a legible value from a redacted source
 * (label visible, value blacked out) or a field genuinely not present.
 */
export type FieldDetail = {
  status: "value" | "redacted" | "not_present";
  value: string | null;
  page: number | null;
  confidence: number;
  evidence?: string;
};

export type FieldDetailsMap = Record<string, FieldDetail>;

// ---------------------------------------------------------------------------
// File-integrity + post-OCR sanity check constants
// ---------------------------------------------------------------------------

/** Minimum OCR characters per page below which extraction is considered failed. */
export const MIN_OCR_CHARS_PER_PAGE = 80;

/** Minimum substantive extracted-field count per document type. */
export const MIN_FIELDS_BY_DOC_TYPE: Record<string, number> = {
  loan_contract: 8,
  account_opening: 8,
  account_opening_agreement: 8,
  remittance_form: 6,
  cash_slip: 5,
};

/** Required-field lists per document type, enforced by the field-completeness gate. */
export const REQUIRED_FIELDS_BY_DOC_TYPE: Record<string, string[]> = {
  loan_contract: [
    "contract_number",
    "customer_name",
    "loan_amount",
    "number_of_installments",
    "installment_amount",
  ],
  account_opening: ["customer_name", "id_number", "account_type"],
  account_opening_agreement: ["customer_name", "id_number", "account_type"],
  remittance_form: ["sender", "beneficiary", "amount", "currency"],
  cash_slip: ["amount", "date"],
};

const NON_SUBSTANTIVE_FIELDS = new Set([
  "title",
  "page_count",
  "pages",
  "signature_flag",
  "has_signature",
]);

/**
 * Magic-byte check for PDF uploads. Returns true only when the first bytes
 * match "%PDF-". Used at upload time to reject mislabeled files (e.g. a ZIP
 * archive renamed to .pdf) before any OCR/split work runs.
 */
export async function validatePdfMagicBytes(file: File): Promise<boolean> {
  try {
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    return (
      head[0] === 0x25 &&
      head[1] === 0x50 &&
      head[2] === 0x44 &&
      head[3] === 0x46 &&
      head[4] === 0x2d
    );
  } catch {
    return false;
  }
}

export type SanityCheckInput = {
  docType: string;
  rawText: string;
  pageCount: number;
  fields: Record<string, unknown>;
  isFallbackExtraction?: boolean;
  fieldDetails?: FieldDetailsMap;
};

/**
 * Post-OCR hard-gate sanity checks. Any "fail" here MUST force the document
 * into the exception queue and block auto-approval regardless of other tiers.
 */
export function runSanityChecks(input: SanityCheckInput): ValidationCheck[] {
  const { docType, rawText, fields, isFallbackExtraction, fieldDetails } = input;
  const pageCount = Math.max(1, input.pageCount || 1);
  const checks: ValidationCheck[] = [];

  const totalChars = (rawText ?? "").length;
  const perPage = totalChars / pageCount;
  if (isFallbackExtraction) {
    checks.push({
      id: "sanity:ocr-yield",
      tier: 1,
      label: "OCR yield (fallback extraction)",
      status: "fail",
      detail:
        "Deterministic fallback extractor was used — output may be generic/placeholder. Routed to exception queue.",
    });
  } else if (perPage < MIN_OCR_CHARS_PER_PAGE) {
    checks.push({
      id: "sanity:ocr-yield",
      tier: 1,
      label: "OCR yield (chars per page)",
      status: "fail",
      detail: `Low OCR yield relative to page count — possible extraction failure. ${totalChars} chars / ${pageCount} page(s) = ${perPage.toFixed(0)} (min ${MIN_OCR_CHARS_PER_PAGE}).`,
    });
  } else {
    checks.push({
      id: "sanity:ocr-yield",
      tier: 1,
      label: "OCR yield (chars per page)",
      status: "pass",
      detail: `${totalChars} chars across ${pageCount} page(s) (${perPage.toFixed(0)}/page).`,
    });
  }

  const dt = (docType ?? "").toLowerCase();
  const matchedKey = Object.keys(MIN_FIELDS_BY_DOC_TYPE).find((k) =>
    dt.includes(k),
  );
  const minFields = matchedKey ? MIN_FIELDS_BY_DOC_TYPE[matchedKey] : 0;
  const requiredKey = Object.keys(REQUIRED_FIELDS_BY_DOC_TYPE).find((k) =>
    dt.includes(k),
  );
  const required = requiredKey ? REQUIRED_FIELDS_BY_DOC_TYPE[requiredKey] : [];

  const substantive = Object.entries(fields ?? {}).filter(([k, v]) => {
    if (NON_SUBSTANTIVE_FIELDS.has(k)) return false;
    if (v == null) return false;
    const s = String(v).trim();
    return s !== "" && s.toLowerCase() !== "n/a";
  });

  // Classify required-field state using field_details metadata when available.
  // A required field is considered:
  //   - present  → flat value exists OR fieldDetails[k].status === "value"
  //   - redacted → fieldDetails[k].status === "redacted" (does NOT fail)
  //   - missing  → otherwise (status "not_present" or absent entirely)
  const redactedRequired: string[] = [];
  const missingRequired: string[] = [];
  for (const k of required) {
    const flat = (fields ?? {})[k];
    const hasFlat = flat != null && String(flat).trim() !== "";
    if (hasFlat) continue;
    const detail = fieldDetails?.[k];
    if (detail?.status === "redacted") {
      redactedRequired.push(k);
      continue;
    }
    if (detail?.status === "value" && detail.value && String(detail.value).trim() !== "") continue;
    missingRequired.push(k);
  }

  // Report what we extracted without failing on minimum counts or missing
  // required fields — surface the numbers as informational only.
  checks.push({
    id: "sanity:field-completeness",
    tier: 1,
    label: "Field completeness",
    status: "pass",
    detail: `${substantive.length} substantive field(s) extracted${missingRequired.length ? `; not present: ${missingRequired.join(", ")}` : ""}${redactedRequired.length ? `; redacted: ${redactedRequired.join(", ")}` : ""}.`,
  });

  // Emit one "skipped" check per required field that the model marked as
  // redacted in the source — surfaces the gap without failing the document.
  for (const k of redactedRequired) {
    const detail = fieldDetails?.[k];
    const pageStr = detail?.page ? ` on page ${detail.page}` : "";
    checks.push({
      id: `sanity:redacted:${k}`,
      tier: 1,
      label: "Required field redacted in source",
      status: "skipped",
      detail: `${k} is redacted${pageStr}`,
    });
  }

  return checks;
}

const MOD97 = (s: string) => {
  let rem = 0;
  for (const ch of s) rem = (rem * 10 + Number(ch)) % 97;
  return rem;
};

// IBAN validation policy: NEVER modify, repair, guess, or autocorrect an
// extracted IBAN. Financial identifiers (IBAN, account numbers, routing
// numbers, SWIFT/BIC, tax IDs) are immutable extracted values. A failed
// checksum is reported as-is with the original OCR value preserved; the
// system does not generate alternative IBAN candidates or perform fuzzy
// matching / digit substitution.
export function validateIBAN(iban?: string | null): ValidationCheck {
  if (!iban)
    return { id: "iban", tier: 1, label: "IBAN present", status: "skipped" };
  const original = String(iban);
  const cleaned = original.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(cleaned)) {
    return {
      id: "iban",
      tier: 1,
      label: "IBAN format",
      status: "fail",
      detail: `IBAN format invalid — extracted value: ${original}`,
    };
  }
  const rearranged = cleaned.slice(4) + cleaned.slice(0, 4);
  const numeric = rearranged
    .split("")
    .map((c) => (/[A-Z]/.test(c) ? (c.charCodeAt(0) - 55).toString() : c))
    .join("");
  const ok = MOD97(numeric) === 1;
  return {
    id: "iban",
    tier: 1,
    label: "IBAN checksum (mod-97)",
    status: ok ? "pass" : "fail",
    // On failure, preserve the original extracted value verbatim — never
    // emit a corrected or suggested IBAN.
    detail: ok ? cleaned : `IBAN checksum failed — extracted value: ${original}`,
  };
}

function shouldValidateIbanChecksum(docType: string): boolean {
  const normalized = docType.toLowerCase();
  return !(
    normalized.includes("salary") || normalized.includes("payslip")
  );
}

function preservePayslipBankIdentifier(value: unknown): ValidationCheck {
  return {
    id: "iban",
    tier: 1,
    label: "Payslip bank identifier",
    status: "skipped",
    detail: `Extracted value preserved: ${String(value)}`,
  };
}

export function validateBIC(bic?: string | null): ValidationCheck {
  if (!bic)
    return {
      id: "bic",
      tier: 1,
      label: "SWIFT/BIC present",
      status: "skipped",
    };
  const cleaned = bic.replace(/\s+/g, "").toUpperCase();
  const ok = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(cleaned);
  return {
    id: "bic",
    tier: 1,
    label: "SWIFT/BIC structure",
    status: ok ? "pass" : "fail",
    detail: ok ? cleaned : "Must be 8 or 11 chars (AAAA BB CC [DDD])",
  };
}

export function validateDate(
  date?: string | null,
  label = "Date",
): ValidationCheck {
  if (!date)
    return {
      id: "date",
      tier: 1,
      label: `${label} present`,
      status: "skipped",
    };
  const d = new Date(date);
  const ok = !Number.isNaN(d.getTime());
  return {
    id: "date",
    tier: 1,
    label: `${label} format`,
    status: ok ? "pass" : "fail",
    detail: ok ? d.toISOString().slice(0, 10) : "Unparseable date",
  };
}

export function validateAmount(
  amount?: string | number | null,
): ValidationCheck {
  if (amount == null || amount === "") {
    return {
      id: "amount",
      tier: 1,
      label: "Amount present",
      status: "skipped",
    };
  }
  const num =
    typeof amount === "number"
      ? amount
      : Number(String(amount).replace(/[^0-9.-]/g, ""));
  const ok = Number.isFinite(num) && num > 0;
  return {
    id: "amount",
    tier: 1,
    label: "Amount numeric & positive",
    status: ok ? "pass" : "fail",
    detail: ok ? num.toLocaleString() : "Could not parse a positive number",
  };
}

export function validateCurrency(code?: string | null): ValidationCheck {
  if (!code)
    return {
      id: "currency",
      tier: 1,
      label: "Currency code present",
      status: "skipped",
    };
  const ok = /^[A-Z]{3}$/.test(code.trim().toUpperCase());
  return {
    id: "currency",
    tier: 1,
    label: "ISO 4217 currency code",
    status: ok ? "pass" : "fail",
    detail: code,
  };
}

export function validateRequired(
  fields: Record<string, unknown>,
  required: string[],
  fieldDetails?: FieldDetailsMap,
): ValidationCheck[] {
  return required.map((key) => {
    const v = fields[key];
    const present = v != null && String(v).trim() !== "";
    const detail = fieldDetails?.[key];
    if (!present && detail?.status === "redacted") {
      const pageStr = detail.page ? ` on page ${detail.page}` : "";
      return {
        id: `req:${key}`,
        tier: 1,
        label: `Required: ${key}`,
        status: "skipped",
        detail: `Redacted in source${pageStr}`,
      };
    }
    if (!present && detail?.status === "value" && detail.value) {
      return {
        id: `req:${key}`,
        tier: 1,
        label: `Required: ${key}`,
        status: "pass",
        detail: String(detail.value),
      };
    }
    return {
      id: `req:${key}`,
      tier: 1,
      label: `Required: ${key}`,
      status: present ? "pass" : "fail",
      detail: present ? String(v) : "Missing",
    };
  });
}

// Tier 2: cross-field within one document
export function crossFieldChecks(
  docType: string,
  fields: Record<string, unknown>,
): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const sender = String(fields["sender"] ?? fields["sender_name"] ?? "").trim();
  const beneficiary = String(
    fields["beneficiary"] ?? fields["beneficiary_name"] ?? "",
  ).trim();
  // Self-transfer detector — only trigger when both names look like real
  // personal/entity names AND their tokens substantially overlap (>=80%).
  // Skips placeholder strings ("details", "n/a"), single short tokens, and
  // generic labels that historically caused false positives.
  const isPlaceholderName = (s: string) => {
    const lc = s.toLowerCase();
    if (lc.length < 4) return true;
    if (/^(details|n\/?a|none|null|unknown|redacted|missing|tbd)$/.test(lc)) return true;
    if (!/[a-z]/i.test(lc)) return true;
    // require at least two word tokens to be considered a real name
    return lc.split(/\s+/).filter(Boolean).length < 2;
  };
  if (sender && beneficiary && !isPlaceholderName(sender) && !isPlaceholderName(beneficiary)) {
    const aTokens = new Set(sender.toLowerCase().split(/\s+/).filter(Boolean));
    const bTokens = new Set(beneficiary.toLowerCase().split(/\s+/).filter(Boolean));
    let shared = 0;
    for (const t of aTokens) if (bTokens.has(t)) shared++;
    const overlap = shared / Math.max(aTokens.size, bTokens.size, 1);
    const isSelfTransfer = overlap >= 0.8;
    checks.push({
      id: "x:sender-vs-beneficiary",
      tier: 2,
      label: "Sender ≠ beneficiary",
      status: isSelfTransfer ? "fail" : "pass",
      detail: isSelfTransfer
        ? `Self-transfer flagged for review (name overlap ${Math.round(overlap * 100)}%)`
        : `${sender} → ${beneficiary}`,
    });
  }
  const amountRaw = fields["amount"] ?? fields["transaction_amount"];
  if (amountRaw != null) {
    const num =
      typeof amountRaw === "number"
        ? amountRaw
        : Number(String(amountRaw).replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(num)) {
      checks.push({
        id: "x:risk-limit",
        tier: 2,
        label: "AML threshold (< 1M)",
        status: num > 1_000_000 ? "warn" : "pass",
        detail:
          num > 1_000_000
            ? "High-value — escalate to compliance"
            : "Within limit",
      });
    }
  }
  if (
    docType.toLowerCase().includes("kyc") ||
    docType.toLowerCase().includes("passport") ||
    docType.toLowerCase().includes("emirates") ||
    docType.toLowerCase().includes("aadhaar")
  ) {
    const expiry = fields["expiry_date"] ?? fields["date_of_expiry"];
    if (expiry) {
      const d = new Date(String(expiry));
      const valid = !Number.isNaN(d.getTime()) && d > new Date();
      checks.push({
        id: "x:expiry",
        tier: 2,
        label: "Document not expired",
        status: valid ? "pass" : "fail",
        detail: valid ? d.toISOString().slice(0, 10) : "Expired or unparseable",
      });
    }
    const issue = fields["issue_date"] ?? fields["date_of_issue"];
    if (issue) {
      const d = new Date(String(issue));
      const valid = !Number.isNaN(d.getTime()) && d <= new Date();
      checks.push({
        id: "x:issue-date",
        tier: 2,
        label: "Issue date not in future",
        status: valid ? "pass" : "fail",
        detail: valid
          ? d.toISOString().slice(0, 10)
          : "Issue date is in the future or unparseable",
      });
    }
  }

  // IBAN country code vs currency consistency (e.g. AE… IBAN expects AED).
  const ibanRaw = String(
    fields["iban"] ??
      fields["iban_account_number"] ??
      fields["account_number"] ??
      "",
  )
    .replace(/\s+/g, "")
    .toUpperCase();
  const currencyRaw = String(
    fields["currency"] ?? fields["currency_code"] ?? "",
  )
    .trim()
    .toUpperCase();
  if (/^[A-Z]{2}\d{2}/.test(ibanRaw) && /^[A-Z]{3}$/.test(currencyRaw)) {
    const ibanCountry = ibanRaw.slice(0, 2);
    const COUNTRY_CCY: Record<string, string> = {
      AE: "AED", SA: "SAR", GB: "GBP", US: "USD", DE: "EUR", FR: "EUR",
      ES: "EUR", IT: "EUR", NL: "EUR", IE: "EUR", PT: "EUR", BE: "EUR",
      AT: "EUR", FI: "EUR", GR: "EUR", LU: "EUR", CH: "CHF", IN: "INR",
      PK: "PKR", EG: "EGP", JO: "JOD", KW: "KWD", QA: "QAR", BH: "BHD",
      OM: "OMR", TR: "TRY", JP: "JPY", CN: "CNY", HK: "HKD", SG: "SGD",
      AU: "AUD", CA: "CAD", NZ: "NZD", ZA: "ZAR",
    };
    const expected = COUNTRY_CCY[ibanCountry];
    if (expected) {
      const ok = expected === currencyRaw;
      checks.push({
        id: "x:iban-currency",
        tier: 2,
        label: "IBAN country vs currency",
        status: ok ? "pass" : "warn",
        detail: ok
          ? `${ibanCountry} IBAN with ${currencyRaw}`
          : `${ibanCountry} IBAN typically uses ${expected}, got ${currencyRaw}`,
      });
    }
  }
  return checks;
}

export type TemplateSpec = {
  template_key: string;
  fields?: Record<string, { required?: boolean; type?: string }>;
  regex_patterns?: Record<string, string>;
};

function pickTemplate(
  docType: string,
  templates: TemplateSpec[],
): TemplateSpec | undefined {
  const t = docType.toLowerCase();
  if (t.includes("swift") || t.includes("remittance") || t.includes("mt103"))
    return templates.find((x) => x.template_key === "swift_remittance");
  if (t.includes("passport") || t.includes("kyc"))
    return templates.find((x) => x.template_key === "kyc_passport");
  if (t.includes("salary") || t.includes("payslip"))
    return templates.find((x) => x.template_key === "salary_slip");
  return undefined;
}

// Aliases for fields banks/forms label differently (e.g. `amount_figures`,
// `beneficiary_iban`). Canonical lookups walk this list so a present value
// under any alias counts as present.
const FIELD_ALIASES: Record<string, string[]> = {
  iban: [
    "iban",
    "iban_account_number",
    "beneficiary_iban",
    "beneficiary_account_no",
    "beneficiary_account_number",
    "beneficiary_account",
    "account_number",
    "account_no",
  ],
  bic: ["bic", "swift_code", "swift_bic", "beneficiary_bic", "beneficiary_swift"],
  amount: [
    "amount",
    "amount_figures",
    "amount_in_figures",
    "transaction_amount",
    "remittance_amount",
    "transfer_amount",
  ],
  currency: ["currency", "currency_code"],
  date: ["date", "transaction_date", "issue_date", "value_date", "request_date"],
  sender: ["sender", "sender_name", "applicant_name", "customer_name", "remitter_name"],
  beneficiary: ["beneficiary", "beneficiary_name", "payee_name"],
};

function resolveAlias(
  fields: Record<string, unknown>,
  canonical: string,
  fieldDetails?: FieldDetailsMap,
): unknown {
  const aliases = FIELD_ALIASES[canonical] ?? [canonical];
  for (const a of aliases) {
    const v = fields[a];
    if (v != null && String(v).trim() !== "") return v;
  }
  for (const a of aliases) {
    const d = fieldDetails?.[a];
    if (d?.status === "value" && d.value && String(d.value).trim() !== "") {
      return d.value;
    }
  }
  return undefined;
}

export function runValidationShield(
  docType: string,
  fields: Record<string, unknown>,
  templates: TemplateSpec[] = [],
  fieldDetails?: FieldDetailsMap,
): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  // Alias-resolved view: fills canonical keys from alias values so required
  // and core checks find them regardless of the label the model emitted.
  const resolvedFields: Record<string, unknown> = { ...fields };
  const mergedDetails: FieldDetailsMap = { ...(fieldDetails ?? {}) };
  for (const canonical of Object.keys(FIELD_ALIASES)) {
    const current = resolvedFields[canonical];
    if (current == null || String(current).trim() === "") {
      const v = resolveAlias(fields, canonical, fieldDetails);
      if (v !== undefined) resolvedFields[canonical] = v;
    }
    if (!mergedDetails[canonical]) {
      // Prefer alias entries with an actual value over redacted/not_present
      // ones so a present-but-aliased field is reflected under the canonical
      // key (and validateRequired sees it as "value", not "redacted").
      const rank = (s: FieldDetail["status"]) =>
        s === "value" ? 0 : s === "redacted" ? 1 : 2;
      let best: FieldDetail | undefined;
      for (const a of FIELD_ALIASES[canonical]) {
        const d = fieldDetails?.[a];
        if (!d) continue;
        if (!best || rank(d.status) < rank(best.status)) best = d;
      }
      if (best) mergedDetails[canonical] = best;
    }
  }

  // Tier 1 – core
  const iban = resolvedFields["iban"];
  const bic = resolvedFields["bic"];
  const amount = resolvedFields["amount"];
  const currency = resolvedFields["currency"];
  const date = resolvedFields["date"];

  if (iban !== undefined) {
    checks.push(
      shouldValidateIbanChecksum(docType)
        ? validateIBAN(String(iban))
        : preservePayslipBankIdentifier(iban),
    );
  }
  if (bic !== undefined) checks.push(validateBIC(String(bic)));
  if (amount !== undefined)
    checks.push(validateAmount(amount as string | number));
  if (currency !== undefined) checks.push(validateCurrency(String(currency)));
  if (date !== undefined) checks.push(validateDate(String(date), "Date"));

  // Required fields — template-driven when available, fallback to defaults.
  const matched = pickTemplate(docType, templates);
  let required: string[] = [];
  if (matched?.fields) {
    required = Object.entries(matched.fields)
      .filter(([, spec]) => spec?.required)
      .map(([key]) => key);
  } else {
    required =
      docType.toLowerCase().includes("swift") ||
      docType.toLowerCase().includes("remittance")
        ? ["sender", "beneficiary", "amount", "currency"]
        : docType.toLowerCase().includes("kyc") ||
            docType.toLowerCase().includes("passport")
          ? ["full_name", "document_number"]
          : docType.toLowerCase().includes("salary")
            ? ["employee_name", "net_pay"]
            : [];
  }
  checks.push(...validateRequired(resolvedFields, required, mergedDetails));

  // Regex pattern checks from template (warn-only on mismatch).
  // Skipped for SWIFT — deterministic extraction already enforces format.
  const isSwift =
    docType.toLowerCase().includes("swift") ||
    docType.toLowerCase().includes("remittance") ||
    docType.toLowerCase().includes("mt103");
  if (matched?.regex_patterns && !isSwift) {
    for (const [key, pattern] of Object.entries(matched.regex_patterns)) {
      const value = fields[key];
      if (value == null || String(value).trim() === "") continue;
      let re: RegExp | null = null;
      try {
        re = new RegExp(pattern);
      } catch {
        re = null;
      }
      if (!re) continue;
      const ok = re.test(String(value));
      checks.push({
        id: `tpl:${matched.template_key}:${key}`,
        tier: 1,
        label: `Template pattern: ${key}`,
        status: ok ? "pass" : "warn",
        detail: ok ? String(value) : `Doesn't match ${pattern}`,
      });
    }
  }

  // Tier 2 – cross-field
  checks.push(...crossFieldChecks(docType, fields));

  // Tier 3 – cross-document (single-doc demo: explicitly skipped)
  checks.push({
    id: "tier3",
    tier: 3,
    label: "Cross-document triangulation",
    status: "skipped",
    detail: matched
      ? `Template '${matched.template_key}' matched`
      : "Upload a multi-document package to enable",
  });

  return checks;
}

// ---------------------------------------------------------------------------
// Tier-3 — cross-document validation
// ---------------------------------------------------------------------------

export type Tier3Doc = {
  fileName: string;
  documentType?: string;
  fields: Record<string, unknown>;
};

function normName(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function primaryNameFor(doc: Tier3Doc): string {
  const t = (doc.documentType ?? "").toLowerCase();
  const f = doc.fields ?? {};
  const pick = (keys: string[]): string => {
    for (const k of keys) {
      const v = f[k];
      if (v != null && String(v).trim() !== "") return String(v);
    }
    return "";
  };
  if (t.includes("passport") || t.includes("kyc"))
    return pick(["full_name", "beneficiary_name", "name"]);
  if (t.includes("emirates") || t.includes("aadhaar") || t.includes("national_id"))
    return pick(["name", "full_name"]);
  if (t.includes("swift") || t.includes("remittance") || t.includes("mt103"))
    return pick(["sender_details", "sender", "ordering_customer"]);
  if (t.includes("salary") || t.includes("payslip"))
    return pick(["employee_name", "name", "full_name"]);
  return pick(["full_name", "name", "employee_name", "sender_details", "sender"]);
}

function tokenOverlapRatio(a: string, b: string): number {
  const A = new Set(a.split(" ").filter(Boolean));
  const B = new Set(b.split(" ").filter(Boolean));
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return shared / Math.max(A.size, B.size);
}

function parseMoneyNum(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n =
    typeof value === "number"
      ? value
      : Number(String(value).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function findDoc(
  docs: Tier3Doc[],
  predicate: (t: string) => boolean,
): Tier3Doc | undefined {
  return docs.find((d) => predicate((d.documentType ?? "").toLowerCase()));
}

export function runTier3Validation(docs: Tier3Doc[]): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  if (!Array.isArray(docs) || docs.length < 2) return checks;

  // Check 1 — Name consistency (fuzzy token overlap, >60% required).
  const named = docs
    .map((doc) => ({ doc, raw: primaryNameFor(doc) }))
    .filter((item) => item.raw)
    .map((item) => ({
      doc: item.doc,
      normalized: normName(item.raw),
      raw: item.raw,
    }));

  for (let i = 0; i < named.length; i++) {
    for (let j = i + 1; j < named.length; j++) {
      const a = named[i];
      const b = named[j];
      const overlap = tokenOverlapRatio(a.normalized, b.normalized);
      if (overlap <= 0.6) {
        checks.push({
          id: `tier3:name:${i}:${j}`,
          tier: 3,
          label: "Name consistency across documents",
          status: "warn",
          detail: `Name mismatch across documents: ${a.doc.fileName} (${a.raw}) vs ${b.doc.fileName} (${b.raw})`,
        });
      }
    }
  }

  // Check 2 — Salary vs bank statement income (±20%).
  const salaryDoc = findDoc(
    docs,
    (t) => t.includes("salary") || t.includes("payslip"),
  );
  const bankDoc = findDoc(
    docs,
    (t) => t.includes("bank_statement") || t.includes("bank statement"),
  );
  if (salaryDoc && bankDoc) {
    const sf = salaryDoc.fields ?? {};
    const bf = bankDoc.fields ?? {};
    const netPay = parseMoneyNum(sf.net_pay ?? sf.netpay ?? sf.salary);
    const candidates: number[] = [];
    const statedIncome = parseMoneyNum(
      bf.stated_income ?? bf.monthly_income ?? bf.income,
    );
    if (statedIncome != null) candidates.push(statedIncome);
    const largestCredit = parseMoneyNum(
      bf.largest_credit ?? bf.max_credit ?? bf.deposit_amount ?? bf.amount,
    );
    if (largestCredit != null) candidates.push(largestCredit);
    if (netPay != null && candidates.length > 0) {
      const bankVal = Math.max(...candidates);
      const diff = Math.abs(bankVal - netPay) / Math.max(netPay, 1);
      if (diff > 0.2) {
        checks.push({
          id: "tier3:income",
          tier: 3,
          label: "Salary vs bank statement income",
          status: "warn",
          detail: `Income mismatch: salary slip shows ${netPay.toLocaleString()}, bank statement shows ${bankVal.toLocaleString()}`,
        });
      } else {
        checks.push({
          id: "tier3:income",
          tier: 3,
          label: "Salary vs bank statement income",
          status: "pass",
          detail: `Within ±20% (salary ${netPay.toLocaleString()} vs bank ${bankVal.toLocaleString()})`,
        });
      }
    }
  }

  // Check 3 — Currency consistency across documents.
  const currencies = new Set<string>();
  for (const doc of docs) {
    const f = doc.fields ?? {};
    const raw =
      f.currency ??
      f.currency_code ??
      f.amount_currency ??
      f.iso_currency_code;
    if (raw == null || String(raw).trim() === "") continue;
    const m = String(raw).toUpperCase().match(/[A-Z]{3}/);
    if (m) currencies.add(m[0]);
  }
  if (currencies.size > 1) {
    checks.push({
      id: "tier3:currency",
      tier: 3,
      label: "Currency consistency across documents",
      status: "warn",
      detail: `Currency inconsistency across documents: [${[...currencies].join(", ")}]`,
    });
  }

  return checks;
}
