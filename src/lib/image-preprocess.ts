// Client-side image preprocessing for OCR. Runs entirely in-browser via
// <canvas> + ImageData. Designed to be called per rasterized PDF page
// (150dpi) or per uploaded image before it is sent to GPT-4o.
//
// Pipeline (in order):
//   1. Deskew correction (projection-variance approximation of Hough lines)
//      - tilt > 0.5°  → rotate by the median tilt
//      - tilt > 45°   → snap to nearest 90°
//   2. Greyscale
//   3. Normalise (auto-levels on luma)
//   4. Sharpen (3x3 unsharp mask, sigma ≈ 1.5)
//   5. Linear contrast stretch (out = in * 1.2 - 10)
//   6. Upscale to 1200px width if narrower (aspect preserved)

export type PreprocessResult = {
  base64: string;             // PNG, no data: prefix
  mimeType: "image/png";
  width: number;
  height: number;
  skewAngleDetected: number;  // degrees, signed
  rotationApplied: number;    // degrees, signed (combined OSD + deskew)
  osdRotationApplied: 0 | 90 | 180 | 270; // gross orientation correction from Tesseract OSD
  osdConfidence: number;      // Tesseract OSD orientation confidence (>=2 = reliable)
};

const TARGET_WIDTH = 1200;
const DESKEW_THRESHOLD_DEG = 0.5;
const SNAP_THRESHOLD_DEG = 45;
// Tesseract's own internal threshold for "reliable" OSD orientation
// confidence. Values below this are routinely produced for blank /
// figure-heavy / very-low-text pages and should not trigger rotation.
const OSD_CONFIDENCE_THRESHOLD = 2;

// Lazy singleton OSD worker. Tesseract's worker bootstrap loads ~2-4MB of
// WASM + osd.traineddata; we pay that once per session.
type OsdWorker = {
  detect: (image: HTMLCanvasElement | string) => Promise<{
    data: {
      orientation_degrees?: number;
      orientation_confidence?: number;
    };
  }>;
};
let osdWorkerPromise: Promise<OsdWorker> | null = null;
async function getOsdWorker(): Promise<OsdWorker> {
  if (!osdWorkerPromise) {
    osdWorkerPromise = (async () => {
      const { createWorker, OEM } = await import("tesseract.js");
      // 'osd' loads only orientation/script detection data — no language data.
      // worker.detect() requires the Legacy engine (OEM 0); the default LSTM_ONLY
      // engine in tesseract.js v5+ throws "requires Legacy model, which was not loaded".
      const worker = (await createWorker("osd", OEM.TESSERACT_ONLY)) as unknown as OsdWorker;
      return worker;
    })().catch((err) => {
      osdWorkerPromise = null; // allow retry on next page
      throw err;
    });
  }
  return osdWorkerPromise;
}

// Returns the clockwise rotation in degrees needed to bring the page upright,
// or null if OSD failed or confidence was too low.
async function detectOsdRotation(
  canvas: HTMLCanvasElement,
): Promise<{ rotation: 0 | 90 | 180 | 270; confidence: number } | null> {
  try {
    const worker = await getOsdWorker();
    const result = await worker.detect(canvas);
    const deg = result.data.orientation_degrees ?? 0;
    const conf = result.data.orientation_confidence ?? 0;
    if (conf < OSD_CONFIDENCE_THRESHOLD) return { rotation: 0, confidence: conf };
    // Tesseract reports the rotation (clockwise) needed to make text upright.
    const normalized = (((Math.round(deg / 90) * 90) % 360) + 360) % 360;
    const rotation = (normalized === 0 || normalized === 90 || normalized === 180 || normalized === 270
      ? normalized
      : 0) as 0 | 90 | 180 | 270;
    return { rotation, confidence: conf };
  } catch (err) {
    console.warn("[image-preprocess] Tesseract OSD failed, skipping rotation:", err);
    return null;
  }
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image decode failed"));
    img.src = src;
  });
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

function ctxOf(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  return ctx;
}

// Estimate skew by projecting horizontal-edge intensity at multiple angles
// and picking the angle whose projection has the highest variance — the
// classic Hough-line approximation. Sub-sampled for speed.
function detectSkewAngle(img: ImageData): number {
  const { width: w, height: h, data } = img;
  // Downsample to ~400px wide for the search.
  const scale = Math.max(1, Math.floor(w / 400));
  const sw = Math.floor(w / scale);
  const sh = Math.floor(h / scale);
  const grey = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const sx = x * scale;
      const sy = y * scale;
      const i = (sy * w + sx) * 4;
      grey[y * sw + x] =
        (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    }
  }
  // Binarise via simple threshold relative to mean.
  let sum = 0;
  for (let i = 0; i < grey.length; i++) sum += grey[i];
  const mean = sum / grey.length;
  const bin = new Uint8Array(grey.length);
  for (let i = 0; i < grey.length; i++) bin[i] = grey[i] < mean - 10 ? 1 : 0;

  let bestAngle = 0;
  let bestScore = -1;
  for (let deg = -10; deg <= 10; deg += 0.5) {
    const rad = (deg * Math.PI) / 180;
    const tan = Math.tan(rad);
    const proj = new Float32Array(sh + Math.ceil(Math.abs(tan) * sw) + 1);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        if (!bin[y * sw + x]) continue;
        const py = Math.round(y - x * tan + Math.ceil(Math.abs(tan) * sw) / 2);
        if (py >= 0 && py < proj.length) proj[py]++;
      }
    }
    let m = 0;
    for (let i = 0; i < proj.length; i++) m += proj[i];
    m /= proj.length;
    let v = 0;
    for (let i = 0; i < proj.length; i++) {
      const d = proj[i] - m;
      v += d * d;
    }
    if (v > bestScore) {
      bestScore = v;
      bestAngle = deg;
    }
  }
  return bestAngle;
}

function rotateCanvas(
  src: HTMLCanvasElement,
  degrees: number,
): HTMLCanvasElement {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const w = src.width * cos + src.height * sin;
  const h = src.width * sin + src.height * cos;
  const out = makeCanvas(w, h);
  const ctx = ctxOf(out);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate(rad);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return out;
}

function applyEnhancements(c: HTMLCanvasElement): void {
  const ctx = ctxOf(c);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;

  // Greyscale + collect min/max for auto-levels
  let lo = 255;
  let hi = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    d[i] = d[i + 1] = d[i + 2] = g;
    if (g < lo) lo = g;
    if (g > hi) hi = g;
  }
  const range = Math.max(1, hi - lo);

  // Normalise + linear contrast stretch (out = in * 1.2 - 10) in one pass
  for (let i = 0; i < d.length; i += 4) {
    const n = ((d[i] - lo) * 255) / range;
    let v = n * 1.2 - 10;
    if (v < 0) v = 0;
    else if (v > 255) v = 255;
    d[i] = d[i + 1] = d[i + 2] = v;
  }

  // 3x3 unsharp mask (sigma ≈ 1.5): out = px + amount*(px - blur)
  const w = c.width;
  const h = c.height;
  const src = new Uint8ClampedArray(d);
  const amount = 0.8;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      let sum = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          sum += src[((y + ky) * w + (x + kx)) * 4];
        }
      }
      const blur = sum / 9;
      let v = src[i] + amount * (src[i] - blur);
      if (v < 0) v = 0;
      else if (v > 255) v = 255;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function resizeToWidth(
  src: HTMLCanvasElement,
  targetW: number,
): HTMLCanvasElement {
  if (src.width >= targetW) return src;
  const scale = targetW / src.width;
  const out = makeCanvas(targetW, src.height * scale);
  const ctx = ctxOf(out);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

function canvasToBase64Png(c: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    c.toBlob(async (blob) => {
      if (!blob) return reject(new Error("toBlob failed"));
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      const chunk = 0x8000;
      for (let i = 0; i < buf.length; i += chunk) {
        bin += String.fromCharCode.apply(
          null,
          buf.subarray(i, i + chunk) as unknown as number[],
        );
      }
      resolve(btoa(bin));
    }, "image/png");
  });
}

export async function preprocessImageBase64(
  base64: string,
  mimeType: string,
): Promise<PreprocessResult> {
  const img = await loadImage(`data:${mimeType};base64,${base64}`);
  let canvas = makeCanvas(img.naturalWidth, img.naturalHeight);
  ctxOf(canvas).drawImage(img, 0, 0);

  // 0. Gross orientation correction via Tesseract OSD (90/180/270).
  //    Runs before deskew so the projection-variance estimator sees
  //    horizontally-oriented text lines. Failures are swallowed and
  //    the existing pipeline proceeds on the original orientation.
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const osd = await detectOsdRotation(canvas);
  const osdRotationApplied: 0 | 90 | 180 | 270 = osd ? osd.rotation : 0;
  const osdConfidence = osd ? osd.confidence : 0;
  if (osdRotationApplied !== 0) {
    canvas = rotateCanvas(canvas, osdRotationApplied);
  }
  if (typeof console !== "undefined") {
    const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
    console.log(
      `[image-preprocess] OSD: rotation=${osdRotationApplied}° conf=${osdConfidence.toFixed(2)} took=${Math.round(t1 - t0)}ms`,
    );
  }

  // 1. Deskew (fine-grained, ±10°)
  const sample = ctxOf(canvas).getImageData(0, 0, canvas.width, canvas.height);
  const skew = detectSkewAngle(sample);
  let rotation = 0;
  if (Math.abs(skew) > SNAP_THRESHOLD_DEG) {
    rotation = Math.round(skew / 90) * 90;
  } else if (Math.abs(skew) > DESKEW_THRESHOLD_DEG) {
    rotation = -skew; // rotate opposite to correct
  }
  if (rotation !== 0) canvas = rotateCanvas(canvas, rotation);

  // 2-5. Greyscale → normalise → contrast → sharpen
  applyEnhancements(canvas);

  // 6. Upscale to 1200px if narrower
  canvas = resizeToWidth(canvas, TARGET_WIDTH);

  const out = await canvasToBase64Png(canvas);
  return {
    base64: out,
    mimeType: "image/png",
    width: canvas.width,
    height: canvas.height,
    skewAngleDetected: skew,
    rotationApplied: osdRotationApplied + rotation,
    osdRotationApplied,
    osdConfidence,
  };
}

/** Optional: round-trip through the server route. */
export async function preprocessImageViaServer(
  base64: string,
  mimeType: string,
): Promise<PreprocessResult> {
  const res = await fetch("/api/preprocess-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_base64: base64, mime_type: mimeType }),
  });
  if (!res.ok) throw new Error(`preprocess-image ${res.status}`);
  const j = (await res.json()) as {
    processed_base64: string;
    skew_angle_detected: number;
    rotation_applied: number;
    width: number;
    height: number;
  };
  return {
    base64: j.processed_base64,
    mimeType: "image/png",
    width: j.width,
    height: j.height,
    skewAngleDetected: j.skew_angle_detected,
    rotationApplied: j.rotation_applied,
    osdRotationApplied: 0,
    osdConfidence: 0,
  };
}
