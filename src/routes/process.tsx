import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  createJob,
  streamJobEvents,
  getJobResult,
} from "@/lib/backend-client";
import { Logo } from "@/components/Logo";
import { ProfileDropdown } from "@/components/ProfileDropdown";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleDashed,
  CircleX,
  Cloud,
  Download,
  Eye,
  FileJson,
  FileText,
  History,
  Loader2,
  LogIn,
  LogOut,
  PackageCheck,
  Pencil,
  RotateCcw,
  Save,
  ScanLine,
  Send,
  ShieldCheck,
  Sparkles,
  Table2,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { ACCEPT_ATTR, extractFile, isSupported } from "@/lib/file-extract";
import { uploadOriginalPDF } from "@/lib/documents";
import { segmentAndStorePdf } from "@/lib/splitPdf";
import { stitchSegments, type PageMeta } from "@/lib/segment-pages";


import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  runValidationShield,
  validatePdfMagicBytes,
  type FieldDetailsMap,
  type ValidationCheck,
} from "@/lib/validators";
import {
  loadWorkspaceSessions,
  recordDocumentOverride,
  saveWorkspaceSession,
} from "@/lib/workspace-db";
import {
  runPackageValidation,
  sessionToFieldRowsCsv,
  sessionToJson,
  snapshotDoc,
  templateSuggestionFor,
  toCsv,
  type Decision,
  type FieldMap,
  type ProcessedDocLike,
  type ReviewStatus,
  type StoredSession,
} from "@/lib/workspace";
import { OverrideHistoryPanel } from "@/components/process/OverrideHistoryPanel";
import { Tier3Panel } from "@/components/process/Tier3Panel";
import { PageBreakdown } from "@/components/PageBreakdown";
import { SegmentationPanel } from "@/components/process/SegmentationPanel";


export const Route = createFileRoute("/process")({
  head: () => ({
    meta: [
      { title: "IV Doc - Process documents" },
      {
        name: "description",
        content:
          "Upload multiple banking documents and watch IV Doc OCR, classify, extract, validate, review, and export each package.",
      },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    projectId:
      typeof search.projectId === "string" && search.projectId.length > 0
        ? search.projectId
        : undefined,
  }),
  component: ProcessPage,
});

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_CONCURRENCY = 3;

type Phase =
  | "queued"
  | "received"
  | "ocr"
  | "classified"
  | "extracting"
  | "validating"
  | "done"
  | "error";

type DocState = ProcessedDocLike & {
  file: File;
  previewUrl: string;
  status: Phase;
  message: string;
  totalExpectedFields?: number;
  expanded: boolean;
  originalFields?: FieldMap;
  pageInfo?: import("@/lib/file-extract").PageInfo[];
  pages?: PageMeta[];
  segments?: import("@/lib/segment-pages").DocumentSegment[];
};

type StreamResult = {
  documentType: string;
  classificationConfidence: number;
  language: string;
  rawText: string;
  fields: FieldMap;
  fieldConfidence: Record<string, number>;
  fieldDetails?: FieldDetailsMap;
  validation?: ValidationCheck[];
  decision: Decision;
  decisionReason: string;
  pages?: PageMeta[];
};

type StreamEvent = {
  step?: string;
  message?: string;
  documentType?: string;
  classificationConfidence?: number;
  language?: string;
  rawText?: string;
  fields?: FieldMap;
  fieldConfidence?: Record<string, number>;
  fieldDetails?: FieldDetailsMap;
  validation?: ValidationCheck[];
  check?: ValidationCheck;
  result?: StreamResult;
};


type Action =
  | { type: "add"; doc: DocState }
  | { type: "remove"; id: string }
  | { type: "toggle"; id: string }
  | { type: "patch"; id: string; patch: Partial<DocState> }
  | {
      type: "mergeFields";
      id: string;
      fields: FieldMap;
      conf: Record<string, number>;
      details?: FieldDetailsMap;
      total?: number;
    }
  | { type: "replaceValidation"; id: string; checks: ValidationCheck[] }
  | { type: "pushCheck"; id: string; check: ValidationCheck }
  | { type: "editField"; id: string; key: string; value: string }
  | {
      type: "review";
      id: string;
      status: ReviewStatus;
      note?: string;
      decision: Decision;
    };

function reducer(state: DocState[], action: Action): DocState[] {
  switch (action.type) {
    case "add":
      return [...state, action.doc];
    case "remove":
      return state.filter((doc) => doc.id !== action.id);
    case "toggle":
      return state.map((doc) =>
        doc.id === action.id ? { ...doc, expanded: !doc.expanded } : doc,
      );
    case "patch":
      return state.map((doc) =>
        doc.id === action.id ? { ...doc, ...action.patch } : doc,
      );
    case "mergeFields":
      return state.map((doc) =>
        doc.id === action.id
          ? {
              ...doc,
              fields: { ...doc.fields, ...action.fields },
              fieldConfidence: { ...doc.fieldConfidence, ...action.conf },
              fieldDetails: action.details
                ? { ...(doc.fieldDetails ?? {}), ...action.details }
                : doc.fieldDetails,
              totalExpectedFields: action.total ?? doc.totalExpectedFields,
            }
          : doc,
      );
    case "replaceValidation":
      return state.map((doc) =>
        doc.id === action.id ? { ...doc, validation: action.checks } : doc,
      );
    case "pushCheck":
      return state.map((doc) =>
        doc.id === action.id
          ? { ...doc, validation: [...doc.validation, action.check] }
          : doc,
      );
    case "editField":
      return state.map((doc) =>
        doc.id === action.id
          ? {
              ...doc,
              fields: { ...doc.fields, [action.key]: action.value },
              fieldConfidence: { ...doc.fieldConfidence, [action.key]: 1 },
              decision: "exception_queue",
              decisionReason:
                "Field edited by operator - re-validation required.",
            }
          : doc,
      );
    case "review":
      return state.map((doc) =>
        doc.id === action.id
          ? {
              ...doc,
              reviewStatus: action.status,
              reviewNote: action.note,
              decision: action.decision,
              decisionReason:
                action.status === "approved_override"
                  ? `Approved by operator override${action.note ? `: ${action.note}` : ""}`
                  : `Rejected by operator${action.note ? `: ${action.note}` : ""}`,
            }
          : doc,
      );
    default:
      return state;
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

async function* readNdjson(res: Response): AsyncGenerator<StreamEvent> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try {
        yield JSON.parse(line) as StreamEvent;
      } catch {
        /* ignore malformed stream fragments */
      }
    }
  }
  const tail = buffer.trim();
  if (tail) {
    try {
      yield JSON.parse(tail) as StreamEvent;
    } catch {
      /* ignore malformed stream fragments */
    }
  }
}

const PHASE_STEPS: { key: Phase; label: string }[] = [
  { key: "received", label: "Uploaded" },
  { key: "ocr", label: "OCR" },
  { key: "classified", label: "Classified" },
  { key: "extracting", label: "Extract" },
  { key: "validating", label: "Validate" },
  { key: "done", label: "Decision" },
];

function phaseIndex(phase: Phase): number {
  const index = PHASE_STEPS.findIndex((step) => step.key === phase);
  return index < 0 ? 0 : index;
}

const SAMPLES: { file: string; label: string; tag: string; desc: string }[] = [
  {
    file: "swift_mt103.pdf",
    label: "SWIFT MT103",
    tag: "Cross-border payment",
    desc: "EUR 248,500 wire instruction",
  },
  {
    file: "payslip_april_2026.pdf",
    label: "Payslip - Apr 2026",
    tag: "Payroll",
    desc: "Northwind Bank salary statement",
  },
  {
    file: "kyc_passport.pdf",
    label: "KYC - Passport",
    tag: "Identity",
    desc: "Passport bio-page extraction",
  },
  {
    file: "invoice_apex_logistics.pdf",
    label: "Invoice",
    tag: "Accounts payable",
    desc: "Apex Logistics INV-2026-0488",
  },
];

function asSnapshot(doc: DocState): ProcessedDocLike {
  return snapshotDoc({
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
    validation: doc.validation,
    decision: doc.decision,
    decisionReason: doc.decisionReason,
    error: doc.error,
    startedAt: doc.startedAt,
    finishedAt: doc.finishedAt,
    reviewStatus: doc.reviewStatus,
    reviewNote: doc.reviewNote,
  });
}

function downloadText(fileName: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function decideFromValidation(
  checks: ValidationCheck[],
  fieldConfidence: Record<string, number>,
) {
  const failed = checks.filter((check) => check.status === "fail").length;
  const warned = checks.filter((check) => check.status === "warn").length;
  const lowConfidence = Object.values(fieldConfidence).some(
    (confidence) => confidence < 0.6,
  );
  const decision: "auto_approve" | "exception_queue" =
    failed === 0 && warned === 0 && !lowConfidence
      ? "auto_approve"
      : "exception_queue";
  const decisionReason =
    decision === "auto_approve"
      ? "All checks passed - auto-approved for downstream delivery."
      : `${failed} failed / ${warned} warnings${lowConfidence ? " / low confidence" : ""} - sent to exception queue.`;
  return { decision, decisionReason };
}

function SampleDocsRow({
  onPick,
}: {
  onPick: (files: File[] | FileList) => void;
}) {
  const [loading, setLoading] = useState<string | null>(null);

  const fetchOne = async (name: string): Promise<File> => {
    const res = await fetch(`/samples/${name}`);
    if (!res.ok) throw new Error(`Failed to load ${name}`);
    const blob = await res.blob();
    return new File([blob], name, { type: "application/pdf" });
  };

  const loadOne = async (name: string) => {
    setLoading(name);
    try {
      onPick([await fetchOne(name)]);
    } finally {
      setLoading(null);
    }
  };

  const loadAll = async () => {
    setLoading("__all__");
    try {
      onPick(await Promise.all(SAMPLES.map((sample) => fetchOne(sample.file))));
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="bento mt-4 p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--color-accent)]" />
          <span className="font-medium text-sm">Try a sample</span>
          <span className="text-xs text-muted-foreground">
            - synthetic banking PDFs
          </span>
        </div>
        <button
          onClick={loadAll}
          disabled={loading !== null}
          className="text-xs inline-flex items-center gap-1.5 rounded-md border hairline bg-[var(--color-elevated)] px-2.5 py-1.5 hover:bg-[var(--color-mist)] disabled:opacity-50"
        >
          {loading === "__all__" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          Run all 4
        </button>
      </div>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {SAMPLES.map((sample) => (
          <div
            key={sample.file}
            className="relative group rounded-lg border hairline bg-[var(--color-elevated)] hover:bg-[var(--color-mist)] transition-colors cursor-pointer"
          >
            <button
              onClick={() => loadOne(sample.file)}
              disabled={loading !== null}
              className="text-left w-full p-3 disabled:opacity-50 cursor-pointer"
            >
              <div className="flex items-center gap-2 pr-7">
                <FileText className="h-4 w-4 text-[var(--color-accent)] shrink-0" />
                <span className="text-sm font-medium truncate">
                  {sample.label}
                </span>
                {loading === sample.file && (
                  <Loader2 className="h-3 w-3 animate-spin ml-auto" />
                )}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {sample.tag}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground truncate">
                {sample.desc}
              </div>
            </button>
            <a
              href={`/samples/${sample.file}`}
              target="_blank"
              rel="noreferrer"
              title="Preview PDF"
              onClick={(event) => event.stopPropagation()}
              className="absolute top-2 right-2 inline-flex items-center justify-center h-6 w-6 rounded-md border hairline bg-background/80 text-muted-foreground hover:text-foreground hover:bg-background"
            >
              <Eye className="h-3.5 w-3.5" />
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}

function AuthControls() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const signOut = async () => {
    setPending(true);
    setError("");
    try {
      await auth.signOut();
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setPending(false);
    }
  };

  if (auth.loading) {
    return (
      <span className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border hairline px-2.5 py-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Checking auth
      </span>
    );
  }

  if (auth.user) {
    return (
      <div className="relative">
        <button
          onClick={signOut}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg border hairline px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-[var(--color-mist)] disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <LogOut className="h-3.5 w-3.5" />
          )}
          Sign out
        </button>
        {error && (
          <span className="absolute right-0 top-full mt-1 w-56 rounded-lg border border-destructive/30 bg-background p-2 text-xs text-destructive shadow-sm">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => void navigate({ to: "/auth" })}
      className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-ink)] px-2.5 py-1.5 text-xs text-[var(--color-mist)] hover:opacity-90"
    >
      <LogIn className="h-3.5 w-3.5" />
      Sign in
    </button>
  );
}

function ProcessPage() {
  const auth = useAuth();
  const { projectId: activeProjectId } = Route.useSearch();
  const [docs, dispatch] = useReducer(reducer, [] as DocState[]);
  const [dragOver, setDragOver] = useState(false);
  const [arabicMode, setArabicMode] = useState(false);
  const arabicModeRef = useRef(false);
  arabicModeRef.current = arabicMode;

  const [history, setHistory] = useState<StoredSession[]>([]);
  const [historyStatus, setHistoryStatus] = useState(
    "Sign in to load saved packages from Lovable Cloud.",
  );
  const [savingSession, setSavingSession] = useState(false);
  const [autoSavedAt, setAutoSavedAt] = useState<number | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookStatus, setWebhookStatus] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const lastAutoSavedSigRef = useRef<string | null>(null);

  const activeCount = useRef(0);
  const queue = useRef<string[]>([]);
  const filesRef = useRef<Map<string, File>>(new Map());
  const docsRef = useRef<DocState[]>([]);
  const segmentCtxRef = useRef<
    Map<string, { parentDocId: string; bytes: ArrayBuffer; userId: string }>
  >(new Map());

  docsRef.current = docs;

  useEffect(() => {
    let active = true;

    if (auth.loading) {
      setHistoryStatus("Checking workspace session...");
      return () => {
        active = false;
      };
    }

    if (!auth.user) {
      setHistory([]);
      setHistoryStatus("Sign in to load and save packages in Lovable Cloud.");
      return () => {
        active = false;
      };
    }

    setHistoryStatus("Loading cloud history...");
    loadWorkspaceSessions(auth.user.id)
      .then((sessions) => {
        if (!active) return;
        setHistory(sessions);
        setHistoryStatus(
          sessions.length === 0
            ? "No saved cloud packages yet."
            : `Loaded ${sessions.length} saved cloud package${sessions.length === 1 ? "" : "s"}.`,
        );
      })
      .catch((error: unknown) => {
        if (!active) return;
        setHistory([]);
        setHistoryStatus(getErrorMessage(error));
      });

    return () => {
      active = false;
    };
  }, [auth.loading, auth.user]);

  const snapshots = useMemo(() => docs.map(asSnapshot), [docs]);
  const packageValidation = useMemo(
    () => runPackageValidation(snapshots),
    [snapshots],
  );
  const exceptions = docs.filter(
    (doc) =>
      doc.status === "error" ||
      doc.decision === "exception_queue" ||
      doc.decision === "rejected" ||
      doc.validation.some(
        (check) => check.status === "fail" || check.status === "warn",
      ),
  );
  const templateSuggestions = docs
    .map((doc) => ({
      id: doc.id,
      suggestion: templateSuggestionFor(asSnapshot(doc), history),
    }))
    .filter(
      (item): item is { id: string; suggestion: string } =>
        item.suggestion != null,
    );

  const startNext = useCallback(() => {
    while (activeCount.current < MAX_CONCURRENCY && queue.current.length > 0) {
      const id = queue.current.shift()!;
      activeCount.current++;
      runDoc(id).finally(() => {
        activeCount.current--;
        startNext();
      });
    }
  }, []);

  const runDoc = async (id: string) => {
    const file = filesRef.current.get(id);
    if (!file) return;
    dispatch({
      type: "patch",
      id,
      patch: {
        status: "received",
        message: "Uploading...",
        startedAt: Date.now(),
      },
    });
    try {
      const extracted = await extractFile(file);
      const forceArabic = arabicModeRef.current;
      const pageInfo =
        "pageInfo" in extracted ? extracted.pageInfo : undefined;
      if (pageInfo) {
        dispatch({ type: "patch", id, patch: { pageInfo } });
      }

      // Persist + split multi-document PDFs in the background (>3 pages, signed in).
      const isPdf =
        file.type === "application/pdf" ||
        file.name.toLowerCase().endsWith(".pdf");
      const pdfPageCount =
        extracted.kind === "images" || extracted.kind === "pdf"
          ? extracted.pageCount
          : 0;
      // Persist the original PDF up front so we have a parent_document_id by
      // the time the stream emits its per-page metadata. Segmentation itself
      // runs after the `done` event in the stream handler below.
      const currentUserId = auth.user?.id ?? null;
      if (currentUserId && isPdf && pdfPageCount >= 2) {
        const userId = currentUserId;
        void (async () => {
          try {
            const docId = await uploadOriginalPDF(userId, file);
            await supabase
              .from("documents")
              .update({ status: "received", page_count: pdfPageCount })
              .eq("id", docId);
            const bytes = await file.arrayBuffer();
            segmentCtxRef.current.set(id, { parentDocId: docId, bytes, userId });
          } catch (err) {
            console.error("[uploadOriginalPDF] failed", err);
          }
        })();
      }


      const body =
        extracted.kind === "image"
          ? {
              kind: "image",
              fileName: extracted.fileName,
              mimeType: extracted.mimeType,
              base64: extracted.base64,
              forceArabic,
            }
          : extracted.kind === "images" || extracted.kind === "pdf"
            ? {
                kind: extracted.kind,
                fileName: extracted.fileName,
                images: extracted.images,
                ...(extracted.kind === "pdf"
                  ? { mimeType: extracted.mimeType, base64: extracted.base64 }
                  : {}),
                forceArabic,
                pageCount: extracted.pageCount,
              }
            : {
                kind: "text",
                fileName: extracted.fileName,
                text: extracted.text,
                forceArabic,
                pageCount: extracted.pageCount,
              };

      const job = await createJob(body);
      console.log("[C# Backend] Job created:", job);

      /*
      const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";
      const res = await fetch(`${API_BASE}/api/process-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Server error ${res.status}: ${text.slice(0, 200)}`);
      }
      */

      for await (const rawEvt of streamJobEvents(job.jobId)) {
        console.log("[PROCESS EVENT]", rawEvt);
        console.log("[STEP]", rawEvt.step);
        const evt: StreamEvent = {
          step: rawEvt.step,
          message: rawEvt.message,
          documentType: rawEvt.payload?.documentType,
          classificationConfidence: rawEvt.payload?.classificationConfidence,
          language: rawEvt.payload?.language,
          rawText: rawEvt.payload?.rawText,
          fields: rawEvt.payload?.fields,
          fieldConfidence: rawEvt.payload?.fieldConfidence,
          fieldDetails: rawEvt.payload?.fieldDetails,
          validation: rawEvt.payload?.validation,
          check: rawEvt.payload?.check,
          result: rawEvt.payload?.result,
        };
        switch (evt.step) {
          case "received":
            dispatch({
              type: "patch",
              id,
              patch: { status: "received", message: evt.message ?? "Received" },
            });
            break;
          case "ocr_start":
            dispatch({
              type: "patch",
              id,
              patch: { status: "ocr", message: evt.message ?? "Running OCR" },
            });
            break;
          case "openai_start":
          case "openai_request_ready":
          case "openai_response_received":
            dispatch({
              type: "patch",
              id,
              patch: {
                status: "extracting",
                message: evt.message ?? "Extracting fields",
              },
            });
            break;
          case "classified":
            dispatch({
              type: "patch",
              id,
              patch: {
                status: "classified",
                documentType: evt.documentType,
                classificationConfidence: evt.classificationConfidence,
                language: evt.language,
                message: evt.message ?? "Classified",
              },
            });
            break;
          case "ocr_done":
            dispatch({
              type: "patch",
              id,
              patch: {
                rawText: evt.rawText,
                message: evt.message ?? "OCR complete",
              },
            });
            break;
          case "field_chunk":
            dispatch({
              type: "patch",
              id,
              patch: {
                status: "extracting",
                message: evt.message ?? "Extracting fields",
              },
            });
            dispatch({
              type: "mergeFields",
              id,
              fields: evt.fields ?? {},
              conf: evt.fieldConfidence ?? {},
              details: evt.fieldDetails,
            });
            break;
          case "extracted":
            dispatch({
              type: "patch",
              id,
              patch: {
                status: "extracting",
                message: evt.message ?? "Fields extracted",
              },
            });
            dispatch({
              type: "mergeFields",
              id,
              fields: evt.fields ?? {},
              conf: evt.fieldConfidence ?? {},
              details: evt.fieldDetails,
              total: Object.keys(evt.fields ?? {}).length,
            });
            break;
          case "validate_start":
            dispatch({
              type: "patch",
              id,
              patch: {
                status: "validating",
                message: evt.message ?? "Running validation",
                validation: [],
              },
            });
            break;
          case "validate_check":
            if (evt.check)
              dispatch({ type: "pushCheck", id, check: evt.check });
            break;
          case "validated":
            dispatch({
              type: "patch",
              id,
              patch: {
                status: "validating",
                validation: evt.validation ?? [],
                message: evt.message ?? "Validation complete",
              },
            });
            break;
          case "done":
            if (!evt.result) break;
            {
              const pages = evt.result.pages;
              const segments = pages && pages.length
                ? stitchSegments(pages)
                : undefined;
              dispatch({
                type: "patch",
                id,
                patch: {
                  status: "done",
                  message: evt.result.decisionReason,
                  fields: evt.result.fields,
                  originalFields: { ...evt.result.fields },
                  fieldConfidence: evt.result.fieldConfidence,
                  fieldDetails: evt.result.fieldDetails,
                  rawText: evt.result.rawText,
                  documentType: evt.result.documentType,
                  classificationConfidence: evt.result.classificationConfidence,
                  language: evt.result.language,
                  validation: evt.result.validation ?? [],
                  decision: evt.result.decision,
                  decisionReason: evt.result.decisionReason,
                  pages,
                  segments,
                  finishedAt: Date.now(),
                },
              });
              // Persist physical segment PDFs in the background when the
              // stitcher detects more than one sub-document.
              const ctx = segmentCtxRef.current.get(id);
              if (ctx && pages && pages.length >= 2 && segments && segments.length >= 2) {
                void (async () => {
                  try {
                    await supabase
                      .from("documents")
                      .update({ status: "splitting" })
                      .eq("id", ctx.parentDocId);
                    await segmentAndStorePdf(ctx.userId, ctx.parentDocId, ctx.bytes, pages);
                    await supabase
                      .from("documents")
                      .update({ status: "split_done" })
                      .eq("id", ctx.parentDocId);
                  } catch (err) {
                    console.error("[segmentAndStorePdf] failed", err);
                  } finally {
                    segmentCtxRef.current.delete(id);
                  }
                })();
              }
            }
            break;

          case "error":
            dispatch({
              type: "patch",
              id,
              patch: {
                status: "error",
                error: evt.message ?? "Unknown processing error",
                message: evt.message ?? "Unknown processing error",
                finishedAt: Date.now(),
              },
            });
            break;
        }
      }
    } catch (err: unknown) {
      dispatch({
        type: "patch",
        id,
        patch: {
          status: "error",
          error: getErrorMessage(err),
          message: getErrorMessage(err),
          finishedAt: Date.now(),
        },
      });
    }
  };

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const newIds: string[] = [];
      for (const file of Array.from(files)) {
        if (!isSupported(file)) continue;
        if (file.size > MAX_BYTES) continue;
        const id =
          (globalThis.crypto?.randomUUID?.() ??
            Math.random().toString(36).slice(2)) +
          "-" +
          Date.now() +
          "-" +
          Math.random().toString(36).slice(2, 8);

        // Magic-byte check for PDF uploads. A ZIP-of-images renamed to .pdf
        // (or any other mislabeled file) must be rejected synchronously
        // BEFORE we enqueue, persist, or fire the split/process pipelines.
        const claimsPdf =
          file.type === "application/pdf" ||
          file.name.toLowerCase().endsWith(".pdf");
        if (claimsPdf) {
          const ok = await validatePdfMagicBytes(file);
          if (!ok) {
            const rejectMsg = "File does not appear to be a valid PDF";
            const doc: DocState = {
              id,
              file,
              fileName: file.name,
              mimeType: file.type,
              fileSize: file.size,
              previewUrl: URL.createObjectURL(file),
              status: "error",
              message: rejectMsg,
              error: rejectMsg,
              fields: {},
              fieldConfidence: {},
              validation: [],
              expanded: true,
              finishedAt: Date.now(),
            };
            dispatch({ type: "add", doc });
            continue;
          }
        }

        const doc: DocState = {
          id,
          file,
          fileName: file.name,
          mimeType: file.type,
          fileSize: file.size,
          previewUrl: URL.createObjectURL(file),
          status: "queued",
          message: "Queued",
          fields: {},
          fieldConfidence: {},
          validation: [],
          expanded: true,
        };
        filesRef.current.set(id, file);
        dispatch({ type: "add", doc });
        newIds.push(id);
      }
      queue.current.push(...newIds);
      startNext();
    },
    [startNext],
  );

  const remove = (id: string) => {
    const doc = docsRef.current.find((candidate) => candidate.id === id);
    if (doc) URL.revokeObjectURL(doc.previewUrl);
    filesRef.current.delete(id);
    dispatch({ type: "remove", id });
  };

  const clearDone = () => {
    for (const doc of docsRef.current) {
      if (doc.status === "done" || doc.status === "error") remove(doc.id);
    }
  };

  const validateDoc = (id: string) => {
    const doc = docsRef.current.find((candidate) => candidate.id === id);
    if (!doc || Object.keys(doc.fields).length === 0) return;
    const checks = runValidationShield(doc.documentType ?? "", doc.fields);
    const { decision, decisionReason } = decideFromValidation(
      checks,
      doc.fieldConfidence,
    );
    dispatch({
      type: "patch",
      id,
      patch: {
        validation: checks,
        decision,
        decisionReason,
        message: decisionReason,
        reviewStatus: decision === "exception_queue" ? "open" : undefined,
      },
    });
  };

  const saveSession = async () => {
    if (!auth.user) {
      setHistoryStatus("Sign in before saving packages to Lovable Cloud.");
      return;
    }
    const now = new Date().toISOString();
    setSavingSession(true);
    setHistoryStatus("Saving package to Lovable Cloud...");
    try {
      const session = await saveWorkspaceSession({
        userId: auth.user.id,
        name: `Package ${new Date(now).toLocaleString()}`,
        docs: snapshots,
        packageValidation,
        projectId: activeProjectId,
      });
      setHistory((current) =>
        [session, ...current.filter((item) => item.id !== session.id)].slice(
          0,
          25,
        ),
      );
      setHistoryStatus("Saved package to Lovable Cloud.");
    } catch (error: unknown) {
      setHistoryStatus(getErrorMessage(error));
    } finally {
      setSavingSession(false);
    }
  };

  // Auto-save to project when project context is active: triggers once docs
  // have settled (no in-flight processing) and the snapshot signature changes.
  useEffect(() => {
    if (!activeProjectId || !auth.user) return;
    if (docs.length === 0) return;
    const settled = docs.every(
      (d) => d.status === "done" || d.status === "error",
    );
    if (!settled) return;
    const sig = JSON.stringify({
      d: snapshots.map((s) => ({
        id: s.id,
        fields: s.fields,
        decision: s.decision,
        reviewStatus: s.reviewStatus,
        validation: s.validation?.length ?? 0,
      })),
      p: packageValidation.decision,
    });
    if (lastAutoSavedSigRef.current === sig) return;
    lastAutoSavedSigRef.current = sig;
    let cancelled = false;
    const t = setTimeout(async () => {
      if (cancelled) return;
      setSavingSession(true);
      setHistoryStatus("Auto-saving package to project…");
      try {
        const now = new Date().toISOString();
        const session = await saveWorkspaceSession({
          userId: auth.user!.id,
          name: `Package ${new Date(now).toLocaleString()}`,
          docs: snapshots,
          packageValidation,
          projectId: activeProjectId,
        });
        setHistory((current) =>
          [session, ...current.filter((i) => i.id !== session.id)].slice(0, 25),
        );
        setAutoSavedAt(Date.now());
        setHistoryStatus("Auto-saved to project.");
      } catch (error: unknown) {
        lastAutoSavedSigRef.current = null;
        setHistoryStatus(getErrorMessage(error));
      } finally {
        setSavingSession(false);
      }
    }, 1200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [activeProjectId, auth.user, docs, snapshots, packageValidation]);


  const sendWebhook = async () => {
    if (!webhookUrl.trim()) return;
    setWebhookStatus("Sending approved payloads...");
    try {
      const payload = {
        packageValidation,
        docs: snapshots.filter((doc) => doc.decision === "auto_approve"),
      };
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setWebhookStatus(
        `Webhook ${res.status} ${res.statusText || "completed"}`,
      );
    } catch (err: unknown) {
      setWebhookStatus(getErrorMessage(err));
    }
  };

  const exportJson = () =>
    downloadText(
      "ivdoc-package.json",
      JSON.stringify({ packageValidation, docs: snapshots }, null, 2),
      "application/json",
    );
  const exportCsv = () =>
    downloadText(
      "ivdoc-package.csv",
      toCsv(snapshots, packageValidation),
      "text/csv",
    );

  const summary = {
    total: docs.length,
    done: docs.filter((doc) => doc.status === "done").length,
    approved: docs.filter((doc) => doc.decision === "auto_approve").length,
    exception: exceptions.length,
    errored: docs.filter((doc) => doc.status === "error").length,
    running: docs.filter(
      (doc) =>
        doc.status !== "queued" &&
        doc.status !== "done" &&
        doc.status !== "error",
    ).length,
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 backdrop-blur-md bg-background/75 border-b hairline">
        <div className="mx-auto max-w-7xl px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <Logo />
            <span className="font-display font-semibold tracking-tight text-lg">
              IV Doc
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <AuthControls />
            <ProfileDropdown />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-12">
        {activeProjectId && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border hairline bg-[var(--color-mist)]/60 px-4 py-3 text-sm">
            <span className="text-muted-foreground inline-flex items-center gap-2">
              {savingSession ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Cloud className="h-3.5 w-3.5" />
              )}
              <span>
                Auto-saving to project{" "}
                <span className="font-medium text-foreground">
                  {activeProjectId.slice(0, 8)}…
                </span>
                {autoSavedAt && !savingSession && (
                  <span className="ml-1 text-xs text-muted-foreground">
                    · last saved {new Date(autoSavedAt).toLocaleTimeString()}
                  </span>
                )}
              </span>
            </span>
            <Link
              to="/projects/$projectId"
              params={{ projectId: activeProjectId }}
              className="inline-flex items-center gap-1.5 rounded-lg border hairline px-2.5 py-1.5 text-xs hover:bg-background"
            >
              Open project
            </Link>
          </div>
        )}

        {!auth.loading &&
          !auth.user &&
          docs.some((d) => d.decision) && (
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border hairline bg-[var(--color-elevated)] px-4 py-3 text-sm">
              <span className="text-muted-foreground">
                You're running in demo mode — nothing is saved.{" "}
                <span className="text-foreground font-medium">
                  Sign in to save your processing history.
                </span>
              </span>
              <Link
                to="/auth"
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-ink)] px-2.5 py-1.5 text-xs text-[var(--color-mist)] hover:opacity-90"
              >
                <LogIn className="h-3.5 w-3.5" /> Sign in
              </Link>
            </div>
          )}
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
          <div className="max-w-3xl">
            <div className="chip mb-4">
              <ScanLine className="h-3.5 w-3.5" /> Live STP workspace
            </div>
            <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">
              Process, validate, review, and export a document package.
            </h1>
            <p className="mt-4 text-muted-foreground max-w-xl">
              Drop banking documents into one package. The server streams
              extraction and validation, then the workspace handles Tier 3
              checks, exceptions, operator corrections, and downstream payloads.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!activeProjectId && (
              <button
                onClick={saveSession}
                disabled={docs.length === 0 || savingSession || !auth.user}
                className="inline-flex items-center gap-2 rounded-lg border hairline px-3 py-2 text-sm hover:bg-[var(--color-mist)] disabled:opacity-50"
              >
                {savingSession ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save package
              </button>
            )}

            <button
              onClick={exportCsv}
              disabled={docs.length === 0}
              className="inline-flex items-center gap-2 rounded-lg border hairline px-3 py-2 text-sm hover:bg-[var(--color-mist)] disabled:opacity-50"
            >
              <Table2 className="h-4 w-4" /> CSV
            </button>
            <button
              onClick={exportJson}
              disabled={docs.length === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-ink)] text-[var(--color-mist)] px-3 py-2 text-sm hover:opacity-90 disabled:opacity-50"
            >
              <FileJson className="h-4 w-4" /> JSON
            </button>
          </div>
        </div>

        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            if (event.dataTransfer.files?.length)
              addFiles(event.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className={
            "mt-10 bento p-8 cursor-pointer transition-colors " +
            (dragOver ? "ring-2 ring-[var(--color-accent)]/50" : "")
          }
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT_ATTR}
            className="hidden"
            onChange={(event) => {
              if (event.target.files) addFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-xl bg-[var(--color-mist)] grid place-items-center text-[var(--color-primary)] shrink-0">
              <Upload className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <div className="font-display text-xl">
                Drop documents here, or click to choose
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                PNG, JPG, WEBP, PDF, DOCX - up to 20 MB each - process up to{" "}
                {MAX_CONCURRENCY} in parallel
              </div>
            </div>
            <div className="hidden md:flex items-center gap-2">
              <span className="chip">
                <ShieldCheck className="h-3.5 w-3.5" /> Server validation
              </span>
            </div>
          </div>
        </div>

        <label
          className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none"
          title="Force OCR to use the Arabic language model from the first pass."
        >
          <input
            type="checkbox"
            checked={arabicMode}
            onChange={(e) => setArabicMode(e.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--color-accent)]"
          />
          <span>Arabic document (Enable for Arabic Docs)</span>
        </label>

        <SampleDocsRow onPick={addFiles} />


        {docs.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
            <span className="chip">{summary.total} total</span>
            {summary.running > 0 && (
              <span className="chip">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {summary.running} running
              </span>
            )}
            {summary.approved > 0 && (
              <span className="chip !bg-emerald-500/10 !text-emerald-700 !border-emerald-500/30">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {summary.approved} auto-approved
              </span>
            )}
            {summary.exception > 0 && (
              <span className="chip !bg-amber-500/10 !text-amber-700 !border-amber-500/30">
                <CircleAlert className="h-3.5 w-3.5" />
                {summary.exception} exceptions
              </span>
            )}
            {summary.errored > 0 && (
              <span className="chip !bg-destructive/10 !text-destructive !border-destructive/30">
                <CircleX className="h-3.5 w-3.5" />
                {summary.errored} errors
              </span>
            )}
            <div className="flex-1" />
            {(summary.done > 0 || summary.errored > 0) && (
              <button
                onClick={clearDone}
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              >
                <Trash2 className="h-3.5 w-3.5" /> Clear completed
              </button>
            )}
          </div>
        )}

        <div className="mt-6 grid xl:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start">
          <div className="space-y-4">
            {docs.length === 0 && (
              <div className="bento p-10 text-center">
                <div className="h-12 w-12 rounded-xl bg-[var(--color-mist)] grid place-items-center mx-auto text-[var(--color-primary)]">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="mt-4 font-display text-xl">
                  No documents yet
                </div>
                <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
                  Add one or more files to start the package. Progress,
                  validation, review, and export controls will appear here.
                </p>
              </div>
            )}
            {docs.map((doc) => (
              <DocCard
                key={doc.id}
                doc={doc}
                templateSuggestion={
                  templateSuggestions.find((item) => item.id === doc.id)
                    ?.suggestion
                }
                onToggle={() => dispatch({ type: "toggle", id: doc.id })}
                onRemove={() => remove(doc.id)}
                onValidate={() => validateDoc(doc.id)}
                onFieldChange={(key, value) =>
                  dispatch({ type: "editField", id: doc.id, key, value })
                }
              />
            ))}
          </div>

          <aside className="space-y-4 xl:sticky xl:top-20">
            <PackagePanel validation={packageValidation} docs={docs} />
            <Tier3Panel
              docs={docs}
              perDocException={docs.some(
                (d) => d.status === "done" && d.decision === "exception_queue",
              )}
            />
            <ExceptionQueue
              docs={exceptions}
              onApprove={(id, note) => {
                const doc = docs.find((d) => d.id === id);
                dispatch({
                  type: "review",
                  id,
                  status: "approved_override",
                  note,
                  decision: "auto_approve",
                });
                if (doc && auth.user) {
                  void recordDocumentOverride({
                    userId: auth.user.id,
                    doc,
                    beforeFields: doc.originalFields ?? doc.fields,
                    afterFields: doc.fields,
                    action: "approve_override",
                    note,
                    originalFile: filesRef.current.get(id) ?? null,
                  }).catch((err) =>
                    console.error("[override] approve failed", err),
                  );
                }
              }}
              onReject={(id, note) => {
                const doc = docs.find((d) => d.id === id);
                dispatch({
                  type: "review",
                  id,
                  status: "rejected",
                  note,
                  decision: "rejected",
                });
                if (doc && auth.user) {
                  void recordDocumentOverride({
                    userId: auth.user.id,
                    doc,
                    beforeFields: doc.originalFields ?? doc.fields,
                    afterFields: doc.fields,
                    action: "reject",
                    note,
                    originalFile: filesRef.current.get(id) ?? null,
                  }).catch((err) =>
                    console.error("[override] reject failed", err),
                  );
                }
              }}
              onRevalidate={validateDoc}
            />
            <WebhookPanel
              url={webhookUrl}
              status={webhookStatus}
              onUrlChange={setWebhookUrl}
              onSend={sendWebhook}
              disabled={
                docs.filter((doc) => doc.decision === "auto_approve").length ===
                0
              }
            />
            <HistoryPanel
              history={history}
              status={historyStatus}
              signedIn={!!auth.user}
            />
          </aside>
        </div>
      </main>

      <footer className="border-t hairline">
        <div className="mx-auto max-w-7xl px-6 py-8 text-sm text-muted-foreground">
          IV Doc - Document Processing & Management Engine
        </div>
      </footer>
    </div>
  );
}

function PackagePanel({
  validation,
  docs,
}: {
  validation: ReturnType<typeof runPackageValidation>;
  docs: DocState[];
}) {
  const done = docs.filter((doc) => doc.status === "done").length;
  return (
    <section className="bento p-5">
      <div className="flex items-center gap-2">
        <PackageCheck className="h-4 w-4 text-[var(--color-accent)]" />
        <h2 className="font-display text-lg">Package validation</h2>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Metric label="Docs" value={String(docs.length)} />
        <Metric label="Done" value={String(done)} />
        <Metric
          label="Tier 3"
          value={validation.decision === "auto_approve" ? "Pass" : "Review"}
        />
      </div>
      <div
        className={
          "mt-4 rounded-xl border p-3 text-sm " +
          (validation.decision === "auto_approve"
            ? "border-emerald-500/30 bg-emerald-500/5"
            : "border-amber-500/30 bg-amber-500/5")
        }
      >
        {validation.decisionReason}
      </div>
      <div className="mt-3 space-y-1">
        {validation.checks.map((check) => (
          <CheckRow key={check.id} check={check} />
        ))}
      </div>
    </section>
  );
}

function ExceptionQueue({
  docs,
  onApprove,
  onReject,
  onRevalidate,
}: {
  docs: DocState[];
  onApprove: (id: string, note?: string) => void;
  onReject: (id: string, note?: string) => void;
  onRevalidate: (id: string) => void;
}) {
  return (
    <section className="bento p-5">
      <div className="flex items-center gap-2">
        <CircleAlert className="h-4 w-4 text-amber-600" />
        <h2 className="font-display text-lg">Exception queue</h2>
      </div>
      {docs.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No open exceptions in this package.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {docs.map((doc) => (
            <div
              key={doc.id}
              className="rounded-xl border hairline p-3 bg-background"
            >
              <div className="text-sm font-medium truncate">{doc.fileName}</div>
              <div className="mt-1 text-xs text-muted-foreground line-clamp-2">
                {doc.error ??
                  doc.decisionReason ??
                  "Validation requires review"}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() =>
                    onApprove(doc.id, "Reviewed in exception queue")
                  }
                  className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-xs text-white hover:opacity-90"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Override
                </button>
                <button
                  onClick={() =>
                    onReject(doc.id, "Rejected in exception queue")
                  }
                  className="inline-flex items-center gap-1 rounded-md bg-destructive px-2 py-1 text-xs text-white hover:opacity-90"
                >
                  <CircleX className="h-3.5 w-3.5" /> Reject
                </button>
                <button
                  onClick={() => onRevalidate(doc.id)}
                  className="inline-flex items-center gap-1 rounded-md border hairline px-2 py-1 text-xs hover:bg-[var(--color-mist)]"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Re-check
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function WebhookPanel({
  url,
  status,
  disabled,
  onUrlChange,
  onSend,
}: {
  url: string;
  status: string;
  disabled: boolean;
  onUrlChange: (value: string) => void;
  onSend: () => void;
}) {
  return (
    <section className="bento p-5">
      <div className="flex items-center gap-2">
        <Send className="h-4 w-4 text-[var(--color-accent)]" />
        <h2 className="font-display text-lg">Webhook delivery</h2>
      </div>
      <input
        value={url}
        onChange={(event) => onUrlChange(event.target.value)}
        placeholder="https://endpoint.example/ivdoc"
        className="mt-3 w-full rounded-lg border hairline bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30"
      />
      <button
        onClick={onSend}
        disabled={disabled || !url.trim()}
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-ink)] text-[var(--color-mist)] px-3 py-2 text-sm hover:opacity-90 disabled:opacity-50"
      >
        <Download className="h-4 w-4" /> Send approved JSON
      </button>
      {status && (
        <div className="mt-2 text-xs text-muted-foreground">{status}</div>
      )}
    </section>
  );
}

function HistoryPanel({
  history,
  status,
  signedIn,
}: {
  history: StoredSession[];
  status: string;
  signedIn: boolean;
}) {
  const [filter, setFilter] = useState<"all" | "auto_approve" | "exception_queue">(
    "all",
  );
  const filtered =
    filter === "all"
      ? history
      : history.filter((s) => s.packageValidation.decision === filter);
  const counts = {
    all: history.length,
    auto_approve: history.filter(
      (s) => s.packageValidation.decision === "auto_approve",
    ).length,
    exception_queue: history.filter(
      (s) => s.packageValidation.decision === "exception_queue",
    ).length,
  };
  const tabClass = (key: typeof filter) =>
    `px-2 py-1 rounded-md text-[10px] uppercase tracking-widest border hairline ${
      filter === key
        ? "bg-foreground text-background"
        : "text-muted-foreground hover:text-foreground"
    }`;
  return (
    <section className="bento p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-[var(--color-accent)]" />
          <h2 className="font-display text-lg">Cloud history</h2>
        </div>
        {signedIn && (
          <span className="inline-flex items-center gap-1 rounded-md border hairline px-2 py-1 text-[10px] uppercase tracking-widest text-muted-foreground">
            <Cloud className="h-3 w-3" /> DB
          </span>
        )}
      </div>
      {history.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <button onClick={() => setFilter("all")} className={tabClass("all")}>
            All ({counts.all})
          </button>
          <button
            onClick={() => setFilter("auto_approve")}
            className={tabClass("auto_approve")}
          >
            STP ({counts.auto_approve})
          </button>
          <button
            onClick={() => setFilter("exception_queue")}
            className={tabClass("exception_queue")}
          >
            Exception queue ({counts.exception_queue})
          </button>
        </div>
      )}
      {history.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{status}</p>
      ) : (
        <>
          <p className="mt-3 text-xs text-muted-foreground">{status}</p>
          <div className="mt-3 space-y-2 max-h-56 overflow-auto">
            {filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No sessions in this view.
              </p>
            ) : (
              filtered.map((session) => (
                <div
                  key={session.id}
                  className="rounded-lg border hairline p-3 bg-background"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium truncate">
                      {session.name}
                    </div>
                    <span
                      className={`text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded border hairline shrink-0 ${
                        session.packageValidation.decision === "auto_approve"
                          ? "text-emerald-600"
                          : "text-amber-600"
                      }`}
                    >
                      {session.packageValidation.decision === "auto_approve"
                        ? "STP"
                        : "Review"}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <div className="text-xs text-muted-foreground">
                      {session.docs.length} docs
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          downloadText(
                            `session-${session.id}.json`,
                            sessionToJson(session),
                            "application/json",
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-md border hairline px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
                        title="Export full session JSON"
                      >
                        <FileJson className="h-3 w-3" /> JSON
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          downloadText(
                            `session-${session.id}-fields.csv`,
                            sessionToFieldRowsCsv(session),
                            "text/csv",
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-md border hairline px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
                        title="Export fields as CSV (one row per field)"
                      >
                        <Table2 className="h-3 w-3" /> CSV
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </section>
  );
}

function DocCard({
  doc,
  templateSuggestion,
  onToggle,
  onRemove,
  onValidate,
  onFieldChange,
}: {
  doc: DocState;
  templateSuggestion?: string;
  onToggle: () => void;
  onRemove: () => void;
  onValidate: () => void;
  onFieldChange: (key: string, value: string) => void;
}) {
  const hasFields = Object.keys(doc.fields).length > 0;
  const hasValidation = doc.validation.length > 0;
  const approved = doc.decision === "auto_approve";
  const isError = doc.status === "error";
  const isDone = doc.status === "done";
  const elapsed =
    doc.startedAt && doc.finishedAt
      ? ((doc.finishedAt - doc.startedAt) / 1000).toFixed(1)
      : null;

  return (
    <div
      className={
        "bento p-0 overflow-hidden " +
        (isError
          ? "border-destructive/40 "
          : isDone && !approved
            ? "border-amber-400/60 "
            : "")
      }
    >
      <div className="flex items-stretch gap-4 p-4">
        {doc.file.type.startsWith("image/") ? (
          <img
            src={doc.previewUrl}
            alt={doc.file.name}
            className="h-20 w-16 rounded-lg object-cover border hairline bg-[var(--color-elevated)] shrink-0"
          />
        ) : (
          <div className="h-20 w-16 rounded-lg border hairline bg-[var(--color-mist)] grid place-items-center shrink-0 text-[var(--color-accent)]">
            <FileText className="h-6 w-6" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-[var(--color-accent)] shrink-0" />
                <span className="font-medium truncate">{doc.fileName}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {Math.round((doc.fileSize ?? 0) / 1024)} KB
                </span>
              </div>
              <div className="mt-1 text-sm text-muted-foreground truncate">
                {doc.message}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {isDone && (
                <DecisionChip decision={doc.decision} approved={approved} />
              )}
              {isError && (
                <span className="chip !bg-destructive/10 !text-destructive !border-destructive/30">
                  <CircleX className="h-3.5 w-3.5" /> Failed
                </span>
              )}
              {elapsed && (
                <span className="text-xs text-muted-foreground ml-1">
                  {elapsed}s
                </span>
              )}
              <button
                onClick={onToggle}
                className="p-1.5 rounded-md hover:bg-[var(--color-mist)] text-muted-foreground"
                aria-label="Toggle details"
              >
                {doc.expanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
              <button
                onClick={onRemove}
                className="p-1.5 rounded-md hover:bg-[var(--color-mist)] text-muted-foreground"
                aria-label="Remove"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <Stepper status={doc.status} />
        </div>
      </div>

      {doc.expanded && (isDone || doc.status !== "queued") && (
        <div className="border-t hairline p-5 space-y-4 bg-[var(--color-mist)]/30">
          <RunSummary doc={doc} />
          {templateSuggestion && (
            <div className="rounded-xl border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5 p-3 text-sm">
              {templateSuggestion}
            </div>
          )}
          {doc.decision && <DecisionPanel doc={doc} />}
          {doc.documentType && <ClassificationPanel doc={doc} />}
          {hasFields && (
            <FieldEditor
              doc={doc}
              hasValidation={hasValidation}
              onValidate={onValidate}
              onFieldChange={onFieldChange}
            />
          )}
          {doc.validation.length > 0 && (
            <ValidationPanel checks={doc.validation} />
          )}
          {isDone && <OverrideHistoryPanel documentId={doc.id} />}
          {isError && doc.error && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {doc.error}
            </div>
          )}
          {doc.rawText && (
            <details className="rounded-xl border hairline p-3 bg-background">
              <summary className="cursor-pointer text-xs uppercase tracking-widest text-muted-foreground">
                Raw OCR text
              </summary>
              <pre className="mt-3 whitespace-pre-wrap text-xs leading-relaxed text-foreground/80 max-h-64 overflow-auto">
                {doc.rawText}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function DecisionChip({
  decision,
  approved,
}: {
  decision?: Decision;
  approved: boolean;
}) {
  if (decision === "rejected") {
    return (
      <span className="chip !bg-destructive/10 !text-destructive !border-destructive/30">
        <CircleX className="h-3.5 w-3.5" /> Rejected
      </span>
    );
  }
  return (
    <span
      className={
        "chip " +
        (approved
          ? "!bg-emerald-500/10 !text-emerald-700 !border-emerald-500/30"
          : "!bg-amber-500/10 !text-amber-700 !border-amber-500/30")
      }
    >
      {approved ? (
        <CheckCircle2 className="h-3.5 w-3.5" />
      ) : (
        <CircleAlert className="h-3.5 w-3.5" />
      )}
      {approved ? "Auto-approved" : "Exception"}
    </span>
  );
}

function DecisionPanel({ doc }: { doc: DocState }) {
  const approved = doc.decision === "auto_approve";
  return (
    <div
      className={
        "rounded-xl border p-4 " +
        (approved
          ? "border-emerald-500/30 bg-emerald-500/5"
          : doc.decision === "rejected"
            ? "border-destructive/30 bg-destructive/5"
            : "border-amber-500/30 bg-amber-500/5")
      }
    >
      <div className="flex items-center gap-2">
        {approved ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        ) : doc.decision === "rejected" ? (
          <CircleX className="h-4 w-4 text-destructive" />
        ) : (
          <CircleAlert className="h-4 w-4 text-amber-600" />
        )}
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Decision
        </div>
        <div className="text-sm font-medium">
          {approved
            ? "Auto-approved"
            : doc.decision === "rejected"
              ? "Rejected"
              : "Exception queue"}
        </div>
      </div>
      {doc.decisionReason && (
        <div className="mt-1.5 text-sm text-foreground/80">
          {doc.decisionReason}
        </div>
      )}
    </div>
  );
}

function ClassificationPanel({ doc }: { doc: DocState }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Classified
        </div>
        <div className="font-display text-lg">{doc.documentType}</div>
      </div>
      {doc.classificationConfidence !== undefined && (
        <div className="text-xs text-muted-foreground">
          Confidence {(doc.classificationConfidence * 100).toFixed(0)}%
          {doc.language ? ` - ${doc.language}` : ""}
        </div>
      )}
    </div>
  );
}

function FieldEditor({
  doc,
  hasValidation,
  onValidate,
  onFieldChange,
}: {
  doc: DocState;
  hasValidation: boolean;
  onValidate: () => void;
  onFieldChange: (key: string, value: string) => void;
}) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>("");

  const startEdit = (key: string, value: unknown) => {
    setEditingKey(key);
    setDraft(value == null ? "" : String(value));
  };
  const commit = () => {
    if (editingKey != null) {
      onFieldChange(editingKey, draft);
    }
    setEditingKey(null);
  };
  const cancel = () => setEditingKey(null);

  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-3">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Extracted fields{" "}
          {doc.totalExpectedFields
            ? `- ${Object.keys(doc.fields).length}/${doc.totalExpectedFields}`
            : `- ${Object.keys(doc.fields).length}`}
        </div>
        <button
          onClick={onValidate}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border hairline text-xs text-muted-foreground hover:text-foreground"
        >
          {hasValidation ? (
            <RotateCcw className="h-3.5 w-3.5" />
          ) : (
            <ShieldCheck className="h-3.5 w-3.5" />
          )}
          {hasValidation ? "Re-validate" : "Validate"}
        </button>
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        {Object.entries(doc.fields).map(([key, value]) => {
          const confidence = doc.fieldConfidence[key];
          const isEditing = editingKey === key;
          const original = doc.originalFields?.[key];
          const wasEdited =
            original !== undefined &&
            String(original ?? "") !== String(value ?? "");
          return (
            <div
              key={key}
              className={
                "rounded-xl border hairline p-3 bg-background block " +
                (wasEdited ? "ring-1 ring-[var(--color-accent)]/40" : "")
              }
            >
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center justify-between gap-3">
                <span className="truncate">{key}</span>
                <span className="inline-flex items-center gap-1 shrink-0">
                  {wasEdited && (
                    <span className="text-[var(--color-accent)]">edited</span>
                  )}
                  {typeof confidence === "number" && (
                    <span
                      className={
                        confidence >= 0.8
                          ? "text-emerald-600"
                          : confidence >= 0.6
                            ? "text-amber-600"
                            : "text-destructive"
                      }
                    >
                      {(confidence * 100).toFixed(0)}%
                    </span>
                  )}
                  {!isEditing && (
                    <button
                      onClick={() => startEdit(key, value)}
                      disabled={editingKey !== null && editingKey !== key}
                      aria-label={`Edit ${key}`}
                      className="p-1 rounded hover:bg-[var(--color-mist)] text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                </span>
              </div>
              {isEditing ? (
                <div className="mt-1 flex items-center gap-1">
                  <input
                    autoFocus
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") commit();
                      else if (event.key === "Escape") cancel();
                    }}
                    className="flex-1 rounded-md border hairline bg-background px-2 py-1 text-sm font-medium outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30"
                  />
                  <button
                    onClick={commit}
                    aria-label="Save"
                    className="p-1 rounded text-emerald-700 hover:bg-emerald-500/10"
                  >
                    <Save className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={cancel}
                    aria-label="Cancel"
                    className="p-1 rounded text-muted-foreground hover:bg-[var(--color-mist)]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <div className="mt-1 text-sm font-medium break-words min-h-[1.25rem]">
                  {value == null || value === "" ? (
                    <span className="text-muted-foreground italic">empty</span>
                  ) : (
                    String(value)
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {doc.fieldDetails && (() => {
        const flatKeys = new Set(Object.keys(doc.fields));
        const entries = Object.entries(doc.fieldDetails).filter(
          ([k, d]) =>
            d && d.status !== "value" && !flatKeys.has(k),
        );
        if (entries.length === 0) return null;
        return (
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
              Field state — redacted / not present
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              {entries.map(([key, d]) => {
                const isRedacted = d.status === "redacted";
                return (
                  <div
                    key={`fd-${key}`}
                    className={
                      "rounded-xl border hairline p-3 bg-background block " +
                      (isRedacted
                        ? "border-amber-300/60 bg-amber-50/30 dark:bg-amber-500/5"
                        : "opacity-70")
                    }
                  >
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center justify-between gap-3">
                      <span className="truncate">{key}</span>
                      <span
                        className={
                          "shrink-0 " +
                          (isRedacted ? "text-amber-700" : "text-muted-foreground")
                        }
                      >
                        {isRedacted ? "redacted" : "not present"}
                      </span>
                    </div>
                    <div className="mt-1 text-sm font-medium break-words min-h-[1.25rem] italic text-muted-foreground">
                      {isRedacted ? "Redacted in source" : "Not present in document"}
                      {d.page ? ` · page ${d.page}` : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function ValidationPanel({ checks }: { checks: ValidationCheck[] }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
        Validation shield
      </div>
      <div className="space-y-1">
        {[1, 2, 3].map((tier) => {
          const items = checks.filter((check) => check.tier === tier);
          if (items.length === 0) return null;
          return (
            <div key={tier} className="pt-2 first:pt-0">
              <div className="text-[10px] uppercase tracking-widest text-[var(--color-accent)] mb-1">
                Tier 0{tier}
              </div>
              {items.map((check) => (
                <CheckRow key={check.id} check={check} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stepper({ status }: { status: Phase }) {
  const activeIdx = phaseIndex(status === "queued" ? "received" : status);
  const isQueued = status === "queued";
  const isError = status === "error";
  return (
    <div className="mt-3 flex items-center gap-1.5">
      {PHASE_STEPS.map((step, index) => {
        const done = !isQueued && !isError && index < activeIdx;
        const active =
          !isQueued && !isError && index === activeIdx && status !== "done";
        const complete = status === "done" && index <= activeIdx;
        return (
          <div
            key={step.key}
            className="flex items-center gap-1.5 flex-1 min-w-0"
          >
            <div
              className={
                "h-1.5 flex-1 rounded-full transition-colors " +
                (isError
                  ? "bg-destructive/30"
                  : complete || done
                    ? "bg-[var(--color-accent)]"
                    : active
                      ? "bg-[var(--color-accent)]/40 animate-pulse"
                      : "bg-[var(--color-mist)]")
              }
            />
            <span
              className={
                "text-[10px] uppercase tracking-widest hidden sm:inline " +
                (complete || done
                  ? "text-foreground"
                  : active
                    ? "text-[var(--color-accent)]"
                    : "text-muted-foreground")
              }
            >
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function RunSummary({ doc }: { doc: DocState }) {
  const elapsed =
    doc.startedAt && doc.finishedAt
      ? ((doc.finishedAt - doc.startedAt) / 1000).toFixed(1)
      : null;
  const fieldCount = Object.keys(doc.fields).length;
  const confValues = Object.values(doc.fieldConfidence);
  const avgConf =
    confValues.length > 0
      ? confValues.reduce((sum, value) => sum + value, 0) / confValues.length
      : null;
  const pass = doc.validation.filter((check) => check.status === "pass").length;
  const fail = doc.validation.filter((check) => check.status === "fail").length;
  const warn = doc.validation.filter((check) => check.status === "warn").length;
  const skipped = doc.validation.filter(
    (check) => check.status === "skipped",
  ).length;

  const items: { label: string; value: string }[] = [
    {
      label: "File size",
      value: `${Math.round((doc.fileSize ?? 0) / 1024)} KB`,
    },
    { label: "Type", value: doc.mimeType || "-" },
    { label: "Elapsed", value: elapsed ? `${elapsed}s` : "-" },
    {
      label: "OCR chars",
      value: doc.rawText ? String(doc.rawText.length) : "-",
    },
    { label: "Fields", value: String(fieldCount) },
    {
      label: "Avg confidence",
      value: avgConf != null ? `${(avgConf * 100).toFixed(0)}%` : "-",
    },
    {
      label: "Checks",
      value:
        doc.validation.length === 0
          ? "Not run"
          : `${pass} pass / ${fail} fail / ${warn} warn${skipped ? ` / ${skipped} skipped` : ""}`,
    },
  ];

  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
        Run summary
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {items.map((item) => (
          <Metric key={item.label} label={item.label} value={item.value} />
        ))}
      </div>
      <PageBreakdown doc={doc} />
      {doc.segments && doc.segments.length > 0 && (
        <SegmentationPanel
          segments={doc.segments}
          totalPages={doc.pages?.length}
        />
      )}

    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border hairline p-3 bg-background">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="text-sm font-medium mt-1 break-words">{value}</div>
    </div>
  );
}

function CheckRow({ check }: { check: ValidationCheck }) {
  const icon =
    check.status === "pass" ? (
      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
    ) : check.status === "fail" ? (
      <CircleX className="h-4 w-4 text-destructive" />
    ) : check.status === "warn" ? (
      <CircleAlert className="h-4 w-4 text-amber-600" />
    ) : (
      <CircleDashed className="h-4 w-4 text-muted-foreground" />
    );
  return (
    <div className="flex items-start gap-3 py-1 text-sm">
      <span className="mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="font-medium">{check.label}</div>
        {check.detail && (
          <div className="text-xs text-muted-foreground mt-0.5 break-words">
            {check.detail}
          </div>
        )}
      </div>
    </div>
  );
}
