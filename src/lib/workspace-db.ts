import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import type {
  FieldMap,
  PackageValidation,
  ProcessedDocLike,
  StoredSession,
} from "./workspace";
import { runTier3Validation, type ValidationCheck } from "./validators";

type ProjectInsert = Database["public"]["Tables"]["projects"]["Insert"];
type ProjectRow = Database["public"]["Tables"]["projects"]["Row"];
type SessionInsert =
  Database["public"]["Tables"]["processing_sessions"]["Insert"];
type SessionRow = Database["public"]["Tables"]["processing_sessions"]["Row"];
type DocumentInsert =
  Database["public"]["Tables"]["project_documents"]["Insert"];
type DocumentRow = Database["public"]["Tables"]["project_documents"]["Row"];

const DEFAULT_PROJECT_NAME = "IV Doc Workspace";
const HISTORY_LIMIT = 25;

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}

function asFieldMap(value: Json): FieldMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const fields: FieldMap = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined || raw === null) {
      fields[key] = null;
    } else if (typeof raw === "string" || typeof raw === "number") {
      fields[key] = raw;
    } else {
      fields[key] = String(raw);
    }
  }
  return fields;
}

function asConfidenceMap(value: Json): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const confidence: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    const numberValue = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(numberValue)) confidence[key] = numberValue;
  }
  return confidence;
}

function asValidation(value: Json): ValidationCheck[] {
  return Array.isArray(value) ? (value as ValidationCheck[]) : [];
}

function asPackageValidation(
  row: Pick<
    SessionRow,
    "package_validation" | "package_decision" | "package_decision_reason"
  >,
): PackageValidation {
  const value = row.package_validation;
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "checks" in value &&
    "decision" in value
  ) {
    return value as unknown as PackageValidation;
  }

  return {
    checks: asValidation(value),
    decision:
      row.package_decision === "exception_queue"
        ? "exception_queue"
        : "auto_approve",
    decisionReason:
      row.package_decision_reason ??
      "Loaded from an earlier workspace session.",
  };
}

function mapDocument(row: DocumentRow): ProcessedDocLike {
  return {
    id: row.id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    fileSize: row.file_size ?? undefined,
    documentType: row.document_type ?? undefined,
    classificationConfidence: row.classification_confidence ?? undefined,
    language: row.language ?? undefined,
    rawText: row.raw_text ?? undefined,
    fields: asFieldMap(row.fields),
    fieldConfidence: asConfidenceMap(row.field_confidence),
    validation: asValidation(row.validation),
    decision:
      row.decision === "auto_approve" ||
      row.decision === "exception_queue" ||
      row.decision === "rejected"
        ? row.decision
        : undefined,
    decisionReason: row.decision_reason ?? undefined,
    error: row.error ?? undefined,
    reviewStatus:
      row.review_status === "open" ||
      row.review_status === "approved_override" ||
      row.review_status === "rejected"
        ? row.review_status
        : undefined,
    reviewNote: row.review_note ?? undefined,
    extractionSource: row.extraction_source ?? undefined,
  };
}

function mapSession(row: SessionRow, docs: DocumentRow[]): StoredSession {
  return {
    id: row.id,
    name: row.name ?? DEFAULT_PROJECT_NAME,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    docs: docs.map(mapDocument),
    packageValidation: asPackageValidation(row),
  };
}

async function resolveProject(
  userId: string,
  projectId?: string | null,
): Promise<ProjectRow> {
  if (projectId) {
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }
  return ensureWorkspaceProject(userId);
}

async function ensureWorkspaceProject(userId: string): Promise<ProjectRow> {
  const { data: existing, error: readError } = await supabase
    .from("projects")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (readError) throw readError;
  if (existing) return existing;

  const insert: ProjectInsert = {
    user_id: userId,
    name: DEFAULT_PROJECT_NAME,
    description: "Lovable Cloud document processing workspace.",
  };
  const { data, error } = await supabase
    .from("projects")
    .insert(insert)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export type OverrideAction = "approve_override" | "reject";

function extFromMime(mime: string | undefined, fileName: string): string {
  const fromName = fileName.includes(".")
    ? fileName.split(".").pop()!.toLowerCase()
    : "";
  if (fromName && fromName.length <= 5) return fromName;
  if (!mime) return "bin";
  if (mime.includes("pdf")) return "pdf";
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("tiff")) return "tiff";
  return "bin";
}

export async function recordDocumentOverride({
  userId,
  doc,
  beforeFields,
  afterFields,
  action,
  note,
  sessionId,
  originalFile,
}: {
  userId: string;
  doc: ProcessedDocLike;
  beforeFields: FieldMap;
  afterFields: FieldMap;
  action: OverrideAction;
  note?: string;
  sessionId?: string | null;
  originalFile?: Blob | null;
}): Promise<{ documentId: string; imagePath: string | null }> {
  const project = await ensureWorkspaceProject(userId);
  const reviewedAt = new Date().toISOString();
  const reviewStatus = action === "approve_override" ? "approved" : "rejected";

  // Upsert the project_documents row so the override history FK resolves.
  const docInsert: DocumentInsert = {
    id: doc.id,
    project_id: project.id,
    session_id: sessionId ?? null,
    user_id: userId,
    file_name: doc.fileName,
    mime_type: doc.mimeType || "application/octet-stream",
    file_size: doc.fileSize ?? null,
    status: doc.error ? "error" : (doc.decision ? "done" : "pending"),
    document_type: doc.documentType ?? null,
    classification_confidence: doc.classificationConfidence ?? null,
    language: doc.language ?? null,
    raw_text: doc.rawText ?? null,
    fields: toJson(afterFields),
    field_confidence: toJson(doc.fieldConfidence),
    validation: toJson(doc.validation),
    decision: doc.decision ?? null,
    decision_reason: doc.decisionReason ?? null,
    error: doc.error ?? null,
    review_status: reviewStatus,
    review_note: note ?? null,
    reviewed_at: reviewedAt,
    corrected_fields:
      action === "approve_override" ? toJson(afterFields) : toJson({}),
  };

  const { data: docRow, error: upsertError } = await supabase
    .from("project_documents")
    .upsert(docInsert, { onConflict: "id" })
    .select("id")
    .single();
  if (upsertError) throw upsertError;

  const { error: historyError } = await supabase
    .from("document_override_history")
    .insert({
      document_id: docRow.id,
      session_id: sessionId ?? null,
      user_id: userId,
      action,
      before_fields: toJson(beforeFields),
      after_fields: toJson(afterFields),
      note: note ?? null,
    });
  if (historyError) throw historyError;

  // Upload the original page image and store a corpus entry. Failures here
  // must not break the override flow — log and continue.
  let imagePath: string | null = null;
  try {
    if (originalFile) {
      const ts = Date.now();
      const ext = extFromMime(doc.mimeType, doc.fileName);
      imagePath = `${project.id}/corpus/${docRow.id}/${ts}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("projects")
        .upload(imagePath, originalFile, {
          contentType: doc.mimeType || "application/octet-stream",
          upsert: false,
        });
      if (uploadError) {
        console.error("[corpus] upload failed", uploadError);
        imagePath = null;
      }
    }

    const corpusInsert = {
      user_id: userId,
      project_id: project.id,
      document_id: docRow.id,
      doc_type: doc.documentType ?? null,
      original_fields: toJson(beforeFields),
      corrected_fields: toJson(afterFields),
      image_path: imagePath,
    };
    const { error: corpusError } = await supabase
      .from("corpus_entries" as never)
      .insert(corpusInsert as never);
    if (corpusError) console.error("[corpus] insert failed", corpusError);
  } catch (err) {
    console.error("[corpus] unexpected failure", err);
  }

  return { documentId: docRow.id, imagePath };
}

export interface CorpusEntry {
  id: string;
  documentId: string;
  docType: string | null;
  originalFields: FieldMap;
  correctedFields: FieldMap;
  imagePath: string | null;
  createdAt: string;
}

export async function loadCorpusEntries(userId: string): Promise<CorpusEntry[]> {
  const { data, error } = await supabase
    .from("corpus_entries" as never)
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    id: string;
    document_id: string;
    doc_type: string | null;
    original_fields: Json;
    corrected_fields: Json;
    image_path: string | null;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    documentId: r.document_id,
    docType: r.doc_type,
    originalFields: asFieldMap(r.original_fields),
    correctedFields: asFieldMap(r.corrected_fields),
    imagePath: r.image_path,
    createdAt: r.created_at,
  }));
}

export async function getCorpusImageUrl(
  imagePath: string,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from("projects")
    .createSignedUrl(imagePath, 60 * 10);
  if (error) {
    console.error("[corpus] sign url failed", error);
    return null;
  }
  return data?.signedUrl ?? null;
}

export async function loadWorkspaceSessions(
  userId: string,
): Promise<StoredSession[]> {
  const { data: sessions, error: sessionsError } = await supabase
    .from("processing_sessions")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  if (sessionsError) throw sessionsError;
  const sessionRows = (sessions ?? []) as SessionRow[];
  const sessionIds = sessionRows.map((session) => session.id);
  if (sessionIds.length === 0) return [];

  const { data: documents, error: documentsError } = await supabase
    .from("project_documents")
    .select("*")
    .in("session_id", sessionIds)
    .order("created_at", { ascending: true });

  if (documentsError) throw documentsError;

  const docsBySession = new Map<string, DocumentRow[]>();
  for (const doc of (documents ?? []) as DocumentRow[]) {
    if (!doc.session_id) continue;
    const group = docsBySession.get(doc.session_id) ?? [];
    group.push(doc);
    docsBySession.set(doc.session_id, group);
  }

  return sessionRows.map((session) =>
    mapSession(session, docsBySession.get(session.id) ?? []),
  );
}

export async function saveWorkspaceSession({
  userId,
  name,
  docs,
  packageValidation,
  projectId,
}: {
  userId: string;
  name: string;
  docs: ProcessedDocLike[];
  packageValidation: PackageValidation;
  projectId?: string | null;
}): Promise<StoredSession> {
  const project = await resolveProject(userId, projectId);


  // Tier-3 cross-document validation runs only when the session has more than
  // one extracted document. Results are persisted to a separate JSON column.
  const tier3Docs = docs
    .filter((d) => d.fields && Object.keys(d.fields).length > 0)
    .map((d) => ({
      fileName: d.fileName,
      documentType: d.documentType,
      fields: d.fields as Record<string, unknown>,
    }));
  const tier3Checks: ValidationCheck[] =
    tier3Docs.length > 1 ? runTier3Validation(tier3Docs) : [];
  const tier3Triggered = tier3Checks.some(
    (c) => c.status === "fail" || c.status === "warn",
  );
  const effectiveDecision = tier3Triggered
    ? "exception_queue"
    : packageValidation.decision;
  const effectiveReason = tier3Triggered
    ? `Tier-3 cross-document check raised ${tier3Checks
        .filter((c) => c.status === "fail" || c.status === "warn")
        .length} issue(s) — review required.`
    : packageValidation.decisionReason;

  const sessionInsert: SessionInsert = {
    project_id: project.id,
    user_id: userId,
    name,
    package_validation: toJson(packageValidation),
    package_validation_results: toJson(tier3Checks),
    package_decision: effectiveDecision,
    package_decision_reason: effectiveReason,
  };
  const { data: session, error: sessionError } = await supabase
    .from("processing_sessions")
    .insert(sessionInsert)
    .select("*")
    .single();

  if (sessionError) throw sessionError;

  const documentRows: DocumentInsert[] = docs.map((doc) => ({
    project_id: project.id,
    session_id: session.id,
    user_id: userId,
    file_name: doc.fileName,
    mime_type: doc.mimeType || "application/octet-stream",
    file_size: doc.fileSize ?? null,
    status: doc.error ? "error" : doc.decision ? "done" : "pending",
    document_type: doc.documentType ?? null,
    classification_confidence: doc.classificationConfidence ?? null,
    language: doc.language ?? null,
    raw_text: doc.rawText ?? null,
    fields: toJson(doc.fields),
    field_confidence: toJson(doc.fieldConfidence),
    validation: toJson(doc.validation),
    decision: doc.decision ?? null,
    decision_reason: doc.decisionReason ?? null,
    error: doc.error ?? null,
    review_status: doc.reviewStatus ?? "open",
    review_note: doc.reviewNote ?? null,
    reviewed_at:
      doc.reviewStatus && doc.reviewStatus !== "open"
        ? new Date().toISOString()
        : null,
    corrected_fields:
      doc.reviewStatus === "approved_override"
        ? toJson(doc.fields)
        : toJson({}),
    pages: toJson(doc.pages ?? []),
    page_info: toJson(doc.pageInfo ?? []),
    segments: toJson(doc.segments ?? []),
  }));

  let insertedDocs: DocumentRow[] = [];
  if (documentRows.length > 0) {
    const { data, error } = await supabase
      .from("project_documents")
      .insert(documentRows)
      .select("*");

    if (error) throw error;
    insertedDocs = (data ?? []) as DocumentRow[];
  }

  return mapSession(session as SessionRow, insertedDocs);
}
