const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export interface ProcessingInput {
  kind: string;
  fileName: string;
  mimeType?: string;
  base64?: string;
  images?: unknown[];
  text?: string;
  forceArabic?: boolean;
  pageCount?: number;
}

export interface JobAcceptedResponse {
  jobId: string;
  sessionId: string;
  status: string;
  eventsUrl: string;
  resultUrl: string;
}

export async function createJob(
  input: ProcessingInput,
): Promise<JobAcceptedResponse> {
  const res = await fetch(`${API_BASE}/v1/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",

      // Temporary for local development.
      // Later replace with Supabase JWT.
      Authorization: "Bearer dev",
    },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  return res.json();
}

export async function getJobStatus(jobId: string) {
  const res = await fetch(`${API_BASE}/v1/jobs/${jobId}`, {
    headers: {
      Authorization: "Bearer dev",
    },
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  return res.json();
}

export async function getJobResult(jobId: string) {
  const res = await fetch(`${API_BASE}/v1/jobs/${jobId}/result`, {
    headers: {
      Authorization: "Bearer dev",
    },
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  return res.json();
}

export async function* streamJobEvents(
  jobId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): AsyncGenerator<any, void, unknown> {
  const res = await fetch(`${API_BASE}/v1/jobs/${jobId}/events`, {
    headers: {
      Authorization: "Bearer dev",
    },
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  if (!res.body) {
    throw new Error("Response body is null");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let currentEventData = "";
  let hasData = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      let lineEnd;
      while ((lineEnd = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 1);
        if (line.endsWith("\r")) {
          line = line.slice(0, -1);
        }

        if (line === "") {
          if (hasData) {
            const parsed = JSON.parse(currentEventData);
            console.log("[SSE RAW EVENT]", parsed);
            yield parsed;
            currentEventData = "";
            hasData = false;
          }
        } else if (line.startsWith("data:")) {
          let dataVal = line.slice(5);
          if (dataVal.startsWith(" ")) {
            dataVal = dataVal.slice(1);
          }
          if (hasData) {
            currentEventData += "\n" + dataVal;
          } else {
            currentEventData = dataVal;
            hasData = true;
          }
        }
      }
    }

    // Flush the final chunk from decoder
    buffer += decoder.decode();
    if (buffer) {
      let lineEnd;
      while ((lineEnd = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 1);
        if (line.endsWith("\r")) {
          line = line.slice(0, -1);
        }
        if (line === "") {
          if (hasData) {
            const parsed = JSON.parse(currentEventData);
            console.log("[SSE RAW EVENT]", parsed);
            yield parsed;
            currentEventData = "";
            hasData = false;
          }
        } else if (line.startsWith("data:")) {
          let dataVal = line.slice(5);
          if (dataVal.startsWith(" ")) {
            dataVal = dataVal.slice(1);
          }
          if (hasData) {
            currentEventData += "\n" + dataVal;
          } else {
            currentEventData = dataVal;
            hasData = true;
          }
        }
      }
      // If there is still content in the buffer (no ending newline)
      if (buffer) {
        let line = buffer;
        if (line.endsWith("\r")) {
          line = line.slice(0, -1);
        }
        if (line.startsWith("data:")) {
          let dataVal = line.slice(5);
          if (dataVal.startsWith(" ")) {
            dataVal = dataVal.slice(1);
          }
          if (hasData) {
            currentEventData += "\n" + dataVal;
          } else {
            currentEventData = dataVal;
            hasData = true;
          }
        }
      }
    }

    // If stream ended but we have data, flush it
    if (hasData) {
      const parsed = JSON.parse(currentEventData);
      console.log("[SSE RAW EVENT]", parsed);
      yield parsed;
    }
  } finally {
    reader.releaseLock();
  }
}
