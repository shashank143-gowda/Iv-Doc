// POST /api/preprocess-image
//
// Contract:
//   Request : { image_base64: string, mime_type: string }
//   Response: { processed_base64, skew_angle_detected, rotation_applied,
//               width, height }
//
// NOTE on runtime: this app runs server functions on a serverless edge
// runtime (Cloudflare workerd) which does not support `sharp` (native Node
// bindings, libvips). The real preprocessing pipeline (deskew, greyscale,
// normalise, sharpen, contrast stretch, resize-to-1200) runs client-side in
// `src/lib/image-preprocess.ts` using <canvas> + ImageData, which is faster
// (no upload roundtrip) and works in every browser.
//
// This route exists so non-browser callers (or future server-only flows) can
// hit the same contract. It validates input, returns the image unchanged,
// and reports the original dimensions with zero rotation. If you later move
// to a runtime with sharp/libvips available, swap the body for the real
// pipeline without changing the contract.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Body = z.object({
  image_base64: z.string().min(1),
  mime_type: z.string().min(1),
});

function decodePngDimensions(b64: string): { width: number; height: number } {
  // PNG: 8-byte signature, then IHDR chunk (4 length + 4 "IHDR" + 4 W + 4 H).
  // For non-PNG, return 0/0 — callers should rely on client-side metadata.
  try {
    const bin = atob(b64);
    if (bin.length < 24) return { width: 0, height: 0 };
    const isPng =
      bin.charCodeAt(0) === 0x89 &&
      bin.charCodeAt(1) === 0x50 &&
      bin.charCodeAt(2) === 0x4e &&
      bin.charCodeAt(3) === 0x47;
    if (!isPng) return { width: 0, height: 0 };
    const u = (i: number) =>
      (bin.charCodeAt(i) << 24) |
      (bin.charCodeAt(i + 1) << 16) |
      (bin.charCodeAt(i + 2) << 8) |
      bin.charCodeAt(i + 3);
    return { width: u(16) >>> 0, height: u(20) >>> 0 };
  } catch {
    return { width: 0, height: 0 };
  }
}

export const Route = createFileRoute("/api/preprocess-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: z.infer<typeof Body>;
        try {
          body = Body.parse(await request.json());
        } catch (err) {
          return Response.json(
            { error: "Invalid body", detail: String(err) },
            { status: 400 },
          );
        }
        const { width, height } = decodePngDimensions(body.image_base64);
        return Response.json({
          processed_base64: body.image_base64,
          skew_angle_detected: 0,
          rotation_applied: 0,
          width,
          height,
          note:
            "Server-side sharp pipeline unavailable on this runtime; " +
            "preprocessing is performed client-side before upload.",
        });
      },
    },
  },
});
