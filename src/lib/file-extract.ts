// Client-side extraction of PDF and DOCX files into shapes the AI gateway can use.
// PDF -> array of base64 PNG page images (first N pages), preprocessed for OCR.
// DOCX -> plain text.

import { preprocessImageBase64 } from "./image-preprocess";

// Render up to 100 pages so multi-page contracts (e.g. 40+ page loan
// contracts) get full coverage. Vision-call batching downstream
// splits these into smaller per-call groups; see VISION_API_BATCH_SIZE
// in process-stream.ts.
const PDF_MAX_PAGES = 100;
// 150 DPI / 72 PDF user-units-per-inch ≈ 2.083 — matches the spec.
const PDF_RENDER_SCALE = 150 / 72;

export type PageInfo = {
  page: number;
  width?: number;
  height?: number;
  skewAngleDetected?: number;
  rotationApplied?: number;
  osdRotationApplied?: number;
};

export type ExtractedInput =
  | {
      kind: "image";
      mimeType: string;
      base64: string;
      fileName: string;
      pageCount?: number;
      pageInfo?: PageInfo[];
    }
  | {
      kind: "images";
      images: { mimeType: string; base64: string }[];
      fileName: string;
      pageCount: number;
      pageInfo?: PageInfo[];
    }
  | {
      kind: "pdf";
      mimeType: "application/pdf";
      base64: string;
      images: { mimeType: string; base64: string }[];
      fileName: string;
      pageCount: number;
      pageInfo?: PageInfo[];
    }
  | { kind: "text"; text: string; fileName: string; pageCount?: number };

export const SUPPORTED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export const ACCEPT_ATTR = [
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".pdf",
  ".docx",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
].join(",");

type PdfPage = {
  getTextContent: () => Promise<{
    items: { str?: string }[];
  }>;
  getViewport: (options: { scale: number }) => {
    width: number;
    height: number;
  };
  render: (options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
    canvas: HTMLCanvasElement;
  }) => { promise: Promise<void> };
};

type PdfDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPage>;
};

type PdfJs = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (options: { data: Uint8Array }) => {
    promise: Promise<PdfDocument>;
  };
};

type MammothBrowser = {
  extractRawText: (options: {
    arrayBuffer: ArrayBuffer;
  }) => Promise<{ value?: string }>;
};

export function isSupported(file: File): boolean {
  if (SUPPORTED_MIME.has(file.type)) return true;
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".pdf") ||
    name.endsWith(".docx") ||
    name.endsWith(".png") ||
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg") ||
    name.endsWith(".webp")
  );
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunk) as unknown as number[],
    );
  }
  return btoa(bin);
}

async function extractPdf(file: File): Promise<ExtractedInput> {
  const pdfjs = (await import("pdfjs-dist")) as unknown as PdfJs;
  // Use bundled worker via Vite ?url
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url"))
    .default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const arrayBuffer = await file.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);
  const pdfBase64 = await blobToBase64(new Blob([arrayBuffer], { type: "application/pdf" }));
  const loadingTask = pdfjs.getDocument({ data });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages as number;
  const pageCount = Math.min(totalPages, PDF_MAX_PAGES);
  const images: { mimeType: string; base64: string }[] = [];
  const pageInfo: PageInfo[] = [];

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
        "image/png",
      ),
    );
    const base64 = await blobToBase64(blob);
    // Deskew + greyscale + normalise + sharpen + contrast + resize-to-1200.
    try {
      const cleaned = await preprocessImageBase64(base64, "image/png");
      images.push({ mimeType: cleaned.mimeType, base64: cleaned.base64 });
      pageInfo.push({
        page: i,
        width: cleaned.width,
        height: cleaned.height,
        skewAngleDetected: cleaned.skewAngleDetected,
        rotationApplied: cleaned.rotationApplied,
        osdRotationApplied: cleaned.osdRotationApplied,
      });
    } catch {
      images.push({ mimeType: "image/png", base64 });
      pageInfo.push({ page: i });
    }
  }

  return {
    kind: "pdf",
    mimeType: "application/pdf",
    base64: pdfBase64,
    images,
    fileName: file.name,
    pageCount: totalPages,
    pageInfo,
  };
}

async function extractDocx(file: File): Promise<ExtractedInput> {
  const mammoth =
    (await import("mammoth/mammoth.browser")) as unknown as MammothBrowser;
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return { kind: "text", text: result.value ?? "", fileName: file.name };
}

async function extractImage(file: File): Promise<ExtractedInput> {
  const base64 = await blobToBase64(file);
  const mimeType = file.type || "image/png";
  try {
    const cleaned = await preprocessImageBase64(base64, mimeType);
    return {
      kind: "image",
      mimeType: cleaned.mimeType,
      base64: cleaned.base64,
      fileName: file.name,
      pageInfo: [
        {
          page: 1,
          width: cleaned.width,
          height: cleaned.height,
          skewAngleDetected: cleaned.skewAngleDetected,
          rotationApplied: cleaned.rotationApplied,
          osdRotationApplied: cleaned.osdRotationApplied,
        },
      ],
    };
  } catch {
    return { kind: "image", mimeType, base64, fileName: file.name };
  }
}

async function extractPdfText(
  file: File,
): Promise<{ text: string; pageCount: number }> {
  const pdfjs = (await import("pdfjs-dist")) as unknown as PdfJs;
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url"))
    .default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pageCount = pdf.numPages;
  const pages: string[] = [];
  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => item.str ?? "")
      .filter(Boolean)
      .join("\n");
    if (text.trim()) pages.push(text);
  }
  return { text: pages.join("\n\n"), pageCount };
}

export async function extractFile(file: File): Promise<ExtractedInput> {
  const lower = file.name.toLowerCase();
  if (file.type === "application/pdf" || lower.endsWith(".pdf")) {
    try {
      const { text, pageCount } = await extractPdfText(file);
      if (text.trim().length >= 20) {
        return { kind: "text", text, fileName: file.name, pageCount };
      }
    } catch {
      /* Fall through to rendered PDF OCR fallback. */
    }
    return extractPdf(file);
  }
  if (
    file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lower.endsWith(".docx")
  )
    return extractDocx(file);
  return extractImage(file);
}
