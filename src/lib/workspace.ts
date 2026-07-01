import type { FieldDetailsMap, ValidationCheck } from "./validators";
import type { PageInfo } from "./file-extract";
import type { PageMeta, DocumentSegment } from "./segment-pages";

export type FieldMap = Record<string, string | number | null>;

export type Decision = "auto_approve" | "exception_queue" | "rejected";

export type ReviewStatus = "open" | "approved_override" | "rejected";

export type ProcessedDocLike = {
  id: string;
  fileName: string;
  mimeType?: string;
  fileSize?: number;
  documentType?: string;
  classificationConfidence?: number;
  language?: string;
  rawText?: string;
  fields: FieldMap;
  fieldConfidence: Record<string, number>;
  fieldDetails?: FieldDetailsMap;
  validation: ValidationCheck[];
  decision?: Decision;
  decisionReason?: string;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
  reviewStatus?: ReviewStatus;
  reviewNote?: string;
  extractionSource?: string;
  pageInfo?: PageInfo[];
  pages?: PageMeta[];
  segments?: DocumentSegment[];
};

export type PackageValidation = {
  checks: ValidationCheck[];
  decision: "auto_approve" | "exception_queue";
  decisionReason: string;
};

export type StoredSession = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  docs: ProcessedDocLike[];
  packageValidation: PackageValidation;
};

function norm(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function pick(fields: FieldMap, keys: string[]): string {
  for (const key of keys) {
    const value = fields[key];
    if (value != null && String(value).trim() !== "")
      return String(value).trim();
  }
  return "";
}

function parseMoney(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed =
    typeof value === "number"
      ? value
      : Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function runPackageValidation(
  docs: ProcessedDocLike[],
): PackageValidation {
  const completed = docs.filter(
    (doc) => doc.fields && Object.keys(doc.fields).length > 0,
  );
  const checks: ValidationCheck[] = [];

  if (completed.length < 2) {
    return {
      checks: [
        {
          id: "pkg:minimum-documents",
          tier: 3,
          label: "Package has multiple documents",
          status: "skipped",
          detail:
            "Upload at least two documents to run cross-document validation",
        },
      ],
      decision: "auto_approve",
      decisionReason:
        "Tier 3 skipped until this package has multiple completed documents.",
    };
  }

  const named = completed
    .map((doc) => ({
      doc,
      value: pick(doc.fields, [
        "full_name",
        "employee_name",
        "customer_name",
        "name",
        "beneficiary",
        "beneficiary_name",
      ]),
    }))
    .filter((item) => item.value);
  const uniqueNames = new Set(named.map((item) => norm(item.value)));
  if (named.length >= 2) {
    checks.push({
      id: "pkg:name-consistency",
      tier: 3,
      label: "Applicant name consistency",
      status: uniqueNames.size <= 1 ? "pass" : "warn",
      detail:
        uniqueNames.size <= 1
          ? `Matched ${named[0].value}`
          : named
              .map((item) => `${item.doc.fileName}: ${item.value}`)
              .join(" | "),
    });
  }

  const ids = completed
    .map((doc) => ({
      doc,
      value: pick(doc.fields, [
        "document_number",
        "passport_number",
        "id_number",
        "national_id",
        "pan_number",
      ]),
    }))
    .filter((item) => item.value);
  if (ids.length >= 2) {
    const duplicateIds = ids.filter(
      (item, index) =>
        ids.findIndex(
          (candidate) => norm(candidate.value) === norm(item.value),
        ) !== index,
    );
    checks.push({
      id: "pkg:identity-reference",
      tier: 3,
      label: "Identity reference reused intentionally",
      status: duplicateIds.length > 0 ? "pass" : "skipped",
      detail:
        duplicateIds.length > 0
          ? `Shared reference ${duplicateIds[0].value}`
          : "No repeated identity reference found across documents",
    });
  }

  const salary = completed
    .map((doc) =>
      parseMoney(
        doc.fields.net_pay ?? doc.fields.gross_pay ?? doc.fields.salary,
      ),
    )
    .find((value): value is number => value != null);
  const deposits = completed
    .map((doc) =>
      parseMoney(
        doc.fields.deposit_amount ??
          doc.fields.monthly_deposit ??
          doc.fields.amount,
      ),
    )
    .filter((value): value is number => value != null);
  if (salary != null && deposits.length > 0) {
    const bestDeposit = Math.max(...deposits);
    const ratio = bestDeposit / salary;
    checks.push({
      id: "pkg:income-evidence",
      tier: 3,
      label: "Income evidence alignment",
      status: ratio >= 0.75 && ratio <= 1.5 ? "pass" : "warn",
      detail: `Salary ${salary.toLocaleString()} vs deposit ${bestDeposit.toLocaleString()}`,
    });
  }

  const hasHardFailure = completed.some(
    (doc) =>
      doc.decision === "exception_queue" ||
      doc.validation.some(
        (check) => check.status === "fail" || check.status === "warn",
      ),
  );
  const hasPackageWarning = checks.some(
    (check) => check.status === "fail" || check.status === "warn",
  );
  const decision =
    hasHardFailure || hasPackageWarning ? "exception_queue" : "auto_approve";

  return {
    checks:
      checks.length > 0
        ? checks
        : [
            {
              id: "pkg:no-shared-fields",
              tier: 3,
              label: "Cross-document evidence available",
              status: "warn",
              detail:
                "No shared name, identity, or income fields were available to compare",
            },
          ],
    decision,
    decisionReason:
      decision === "auto_approve"
        ? "All document and package checks passed."
        : "One or more document or package checks require exception review.",
  };
}

export function snapshotDoc(doc: ProcessedDocLike): ProcessedDocLike {
  return {
    id: doc.id,
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    fileSize: doc.fileSize,
    documentType: doc.documentType,
    classificationConfidence: doc.classificationConfidence,
    language: doc.language,
    rawText: doc.rawText,
    fields: doc.fields,
    fieldConfidence: doc.fieldConfidence,
    fieldDetails: doc.fieldDetails,
    validation: doc.validation,
    decision: doc.decision,
    decisionReason: doc.decisionReason,
    error: doc.error,
    startedAt: doc.startedAt,
    finishedAt: doc.finishedAt,
    reviewStatus: doc.reviewStatus,
    reviewNote: doc.reviewNote,
    extractionSource: doc.extractionSource,
    pageInfo: doc.pageInfo,
    pages: doc.pages,
    segments: doc.segments,
  };
}

export function toCsv(
  docs: ProcessedDocLike[],
  packageValidation: PackageValidation,
): string {
  const rows = docs.map((doc) => ({
    file_name: doc.fileName,
    document_type: doc.documentType ?? "",
    decision: doc.decision ?? "",
    decision_reason: doc.decisionReason ?? "",
    package_decision: packageValidation.decision,
    fields: JSON.stringify(doc.fields),
    validation: JSON.stringify(doc.validation),
  }));
  const headers = [
    "file_name",
    "document_type",
    "decision",
    "decision_reason",
    "package_decision",
    "fields",
    "validation",
  ];
  const escape = (value: unknown) =>
    `"${String(value ?? "").replace(/"/g, '""')}"`;
  return [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) => escape(row[header as keyof typeof row]))
        .join(","),
    ),
  ].join("\n");
}

function worstTierStatus(
  validation: ValidationCheck[],
  tier: 1 | 2,
): string {
  const inTier = validation.filter((v) => v.tier === tier);
  if (inTier.length === 0) return "skipped";
  if (inTier.some((v) => v.status === "fail")) return "fail";
  if (inTier.some((v) => v.status === "warn")) return "warn";
  if (inTier.some((v) => v.status === "pass")) return "pass";
  return "skipped";
}

export function sessionToJson(session: StoredSession): string {
  return JSON.stringify(
    {
      id: session.id,
      name: session.name,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      packageValidation: session.packageValidation,
      packageDecision: session.packageValidation.decision,
      docs: session.docs,
    },
    null,
    2,
  );
}

export function sessionToFieldRowsCsv(session: StoredSession): string {
  const headers = [
    "document_id",
    "doc_type",
    "field_name",
    "field_value",
    "extraction_source",
    "confidence",
    "tier1_status",
    "tier2_status",
  ];
  const escape = (value: unknown) =>
    `"${String(value ?? "").replace(/"/g, '""')}"`;
  const rows: string[] = [headers.join(",")];
  for (const doc of session.docs) {
    const tier1 = worstTierStatus(doc.validation, 1);
    const tier2 = worstTierStatus(doc.validation, 2);
    const source = doc.extractionSource ?? "";
    const entries = Object.entries(doc.fields);
    if (entries.length === 0) {
      rows.push(
        [
          doc.id,
          doc.documentType ?? "",
          "",
          "",
          source,
          "",
          tier1,
          tier2,
        ]
          .map(escape)
          .join(","),
      );
      continue;
    }
    for (const [key, value] of entries) {
      const confidence = doc.fieldConfidence?.[key];
      rows.push(
        [
          doc.id,
          doc.documentType ?? "",
          key,
          value ?? "",
          source,
          confidence ?? "",
          tier1,
          tier2,
        ]
          .map(escape)
          .join(","),
      );
    }
  }
  return rows.join("\n");
}

export function templateSuggestionFor(
  current: ProcessedDocLike,
  history: StoredSession[],
): string | null {
  const currentKeys = new Set(Object.keys(current.fields));
  if (!current.documentType || currentKeys.size === 0) return null;

  let best: { score: number; fileName: string } | null = null;
  for (const session of history) {
    for (const candidate of session.docs) {
      if (norm(candidate.documentType) !== norm(current.documentType)) continue;
      const candidateKeys = Object.keys(candidate.fields);
      const overlap = candidateKeys.filter((key) =>
        currentKeys.has(key),
      ).length;
      const score =
        overlap / Math.max(currentKeys.size, candidateKeys.length, 1);
      if (!best || score > best.score)
        best = { score, fileName: candidate.fileName };
    }
  }

  if (!best || best.score < 0.5) return null;
  return `Template candidate: ${best.fileName} (${Math.round(best.score * 100)}% field overlap)`;
}
