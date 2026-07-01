export const PROCESS_STREAM_ENDPOINT = "/api/process-stream";

export async function processDocument(): Promise<never> {
  throw new Error(
    "processDocument has been retired. Use the canonical /api/process-stream endpoint so callers receive the streamed extraction, validation, and decision contract.",
  );
}
