import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import type { Decision, FieldMap, ProcessedDocLike } from "./workspace";
import type { ValidationCheck } from "./validators";
import type { PageInfo } from "./file-extract";
import type { PageMeta, DocumentSegment } from "./segment-pages";

type ProjectRow = Database["public"]["Tables"]["projects"]["Row"];
type DocumentRow = Database["public"]["Tables"]["project_documents"]["Row"];

export type ProjectRollup = "ready" | "needs_review" | "has_exceptions";

export interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  docCount: number;
  lastActivityAt: string | null;
  decisionCounts: {
    auto_approve: number;
    exception_queue: number;
    rejected: number;
    pending: number;
  };
  rollup: ProjectRollup;
}

export interface ProjectDocument extends ProcessedDocLike {
  projectId: string;
  sessionId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

function asFieldMap(value: Json): FieldMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const fields: FieldMap = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined || raw === null) fields[key] = null;
    else if (typeof raw === "string" || typeof raw === "number") fields[key] = raw;
    else fields[key] = String(raw);
  }
  return fields;
}

function asConfidenceMap(value: Json): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    const n = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(n)) out[key] = n;
  }
  return out;
}

function asArray<T>(value: Json): T[] {
  return Array.isArray(value) ? (value as unknown as T[]) : [];
}

function rowToDoc(row: DocumentRow): ProjectDocument {
  return {
    id: row.id,
    projectId: row.project_id,
    sessionId: row.session_id ?? null,
    status: row.status ?? "pending",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    fileName: row.file_name,
    mimeType: row.mime_type,
    fileSize: row.file_size ?? undefined,
    documentType: row.document_type ?? undefined,
    classificationConfidence: row.classification_confidence ?? undefined,
    language: row.language ?? undefined,
    rawText: row.raw_text ?? undefined,
    fields: asFieldMap(row.fields),
    fieldConfidence: asConfidenceMap(row.field_confidence),
    validation: Array.isArray(row.validation)
      ? (row.validation as unknown as ValidationCheck[])
      : [],
    decision:
      row.decision === "auto_approve" ||
      row.decision === "exception_queue" ||
      row.decision === "rejected"
        ? (row.decision as Decision)
        : undefined,
    decisionReason: row.decision_reason ?? undefined,
    error: row.error ?? undefined,
    reviewStatus:
      row.review_status === "open" ||
      row.review_status === "approved_override" ||
      row.review_status === "rejected"
        ? (row.review_status as ProcessedDocLike["reviewStatus"])
        : undefined,
    reviewNote: row.review_note ?? undefined,
    extractionSource: row.extraction_source ?? undefined,
    pages: asArray<PageMeta>(row.pages),
    pageInfo: asArray<PageInfo>(row.page_info),
    segments: asArray<DocumentSegment>(row.segments),
  };
}

function computeRollup(counts: ProjectSummary["decisionCounts"]): ProjectRollup {
  if (counts.rejected > 0) return "has_exceptions";
  if (counts.exception_queue > 0 || counts.pending > 0) return "needs_review";
  if (counts.auto_approve > 0) return "ready";
  return "needs_review";
}

export async function listUserProjects(userId: string): Promise<ProjectSummary[]> {
  const { data: projects, error } = await supabase
    .from("projects")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;

  const rows = (projects ?? []) as ProjectRow[];
  if (rows.length === 0) return [];

  const ids = rows.map((p) => p.id);
  const { data: docs, error: docsError } = await supabase
    .from("project_documents")
    .select("project_id, decision, status, updated_at")
    .in("project_id", ids);
  if (docsError) throw docsError;

  const byProject = new Map<
    string,
    { count: number; last: string | null; counts: ProjectSummary["decisionCounts"] }
  >();
  for (const id of ids)
    byProject.set(id, {
      count: 0,
      last: null,
      counts: { auto_approve: 0, exception_queue: 0, rejected: 0, pending: 0 },
    });
  for (const d of (docs ?? []) as Array<{
    project_id: string;
    decision: string | null;
    status: string | null;
    updated_at: string;
  }>) {
    const entry = byProject.get(d.project_id);
    if (!entry) continue;
    entry.count += 1;
    if (!entry.last || entry.last < d.updated_at) entry.last = d.updated_at;
    if (d.decision === "auto_approve") entry.counts.auto_approve += 1;
    else if (d.decision === "exception_queue") entry.counts.exception_queue += 1;
    else if (d.decision === "rejected") entry.counts.rejected += 1;
    else entry.counts.pending += 1;
  }

  return rows.map((p) => {
    const agg = byProject.get(p.id)!;
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      docCount: agg.count,
      lastActivityAt: agg.last,
      decisionCounts: agg.counts,
      rollup: computeRollup(agg.counts),
    };
  });
}

export async function createUserProject(
  userId: string,
  name: string,
  description?: string,
): Promise<ProjectRow> {
  const { data, error } = await supabase
    .from("projects")
    .insert({ user_id: userId, name: name.trim(), description: description?.trim() || null })
    .select("*")
    .single();
  if (error) throw error;
  return data as ProjectRow;
}

export async function updateUserProject(
  projectId: string,
  patch: { name?: string; description?: string | null },
): Promise<void> {
  const { error } = await supabase
    .from("projects")
    .update({
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
    })
    .eq("id", projectId);
  if (error) throw error;
}

export async function deleteUserProject(projectId: string): Promise<void> {
  const { error } = await supabase.from("projects").delete().eq("id", projectId);
  if (error) throw error;
}

export async function getUserProject(
  userId: string,
  projectId: string,
): Promise<ProjectRow | null> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as ProjectRow) ?? null;
}

export async function listProjectDocuments(
  projectId: string,
): Promise<ProjectDocument[]> {
  const { data, error } = await supabase
    .from("project_documents")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as DocumentRow[]).map(rowToDoc);
}

export function summarizeRollup(rollup: ProjectRollup): {
  label: string;
  tone: "ready" | "warn" | "danger";
} {
  if (rollup === "ready") return { label: "Ready", tone: "ready" };
  if (rollup === "has_exceptions") return { label: "Has exceptions", tone: "danger" };
  return { label: "Needs review", tone: "warn" };
}
