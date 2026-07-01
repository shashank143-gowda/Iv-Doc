import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

const BUCKET = "documents";

export type DocumentRow = Database["public"]["Tables"]["documents"]["Row"];
export type DocumentSplitRow =
  Database["public"]["Tables"]["document_splits"]["Row"];

export type DocumentWithSplits = DocumentRow & {
  document_splits: DocumentSplitRow[];
};

/**
 * Uploads the original PDF to `documents/{userId}/{docId}/original.pdf`
 * and inserts a row into `public.documents`. Returns the new document id.
 */
export async function uploadOriginalPDF(
  userId: string,
  file: File,
): Promise<string> {
  const { data: inserted, error: insertError } = await supabase
    .from("documents")
    .insert({
      user_id: userId,
      original_filename: file.name,
      status: "received",
    })
    .select("id")
    .single();
  if (insertError) throw insertError;

  const docId = inserted.id;
  const storagePath = `${userId}/${docId}/original.pdf`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, {
      contentType: file.type || "application/pdf",
      upsert: false,
    });
  if (uploadError) {
    await supabase.from("documents").delete().eq("id", docId);
    throw uploadError;
  }

  const { error: updateError } = await supabase
    .from("documents")
    .update({ storage_path: storagePath })
    .eq("id", docId);
  if (updateError) throw updateError;

  return docId;
}

/**
 * Uploads a split PDF segment to
 * `documents/{userId}/{parentDocId}/splits/{segmentType}_p{pageRange}.pdf`
 * and inserts a row into `public.document_splits`. Returns the inserted split row.
 */
export async function saveSplit(
  userId: string,
  parentDocId: string,
  segmentType: string,
  pageRange: string,
  pdfBlob: Blob,
  extras?: {
    pageStart?: number;
    pageEnd?: number;
    confidence?: number;
    status?: "ready" | "needs_review" | "rejected" | "confirmed";
    signals?: string[];
    needsReview?: boolean;
  },
): Promise<DocumentSplitRow> {
  const safeRange = pageRange.replace(/[^0-9a-zA-Z_-]/g, "-");
  const safeType = segmentType.replace(/[^0-9a-zA-Z_-]/g, "-");
  const storagePath = `${userId}/${parentDocId}/splits/${safeType}_p${safeRange}.pdf`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, pdfBlob, {
      contentType: "application/pdf",
      upsert: false,
    });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from("document_splits")
    .insert({
      parent_document_id: parentDocId,
      user_id: userId,
      segment_type: segmentType,
      document_type: segmentType,
      page_range: pageRange,
      page_start: extras?.pageStart ?? null,
      page_end: extras?.pageEnd ?? null,
      confidence: extras?.confidence ?? null,
      status: extras?.status ?? (extras?.needsReview ? "needs_review" : "ready"),
      signals: extras?.signals ?? [],
      needs_review: extras?.needsReview ?? false,
      storage_path: storagePath,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/**
 * Lists segments for a given parent document, ordered by start page.
 */
export async function getDocumentSplits(
  parentDocId: string,
): Promise<DocumentSplitRow[]> {
  const { data, error } = await supabase
    .from("document_splits")
    .select("*")
    .eq("parent_document_id", parentDocId)
    .order("page_start", { ascending: true });
  if (error) throw error;
  return data ?? [];
}


/**
 * Returns all documents for the user, with their splits nested,
 * ordered by uploaded_at desc.
 */
export async function getUserDocuments(
  userId: string,
): Promise<DocumentWithSplits[]> {
  const { data, error } = await supabase
    .from("documents")
    .select("*, document_splits(*)")
    .eq("user_id", userId)
    .order("uploaded_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as DocumentWithSplits[];
}

/**
 * Returns a signed URL for a path in the private `documents` bucket,
 * valid for 1 hour.
 */
export async function getSignedDownloadUrl(
  storagePath: string,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 60 * 60);
  if (error) throw error;
  return data.signedUrl;
}
