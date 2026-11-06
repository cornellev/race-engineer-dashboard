import { BACKEND_URL } from "./backend";

/** One line of RED's /tern/stream (Tern's /ask/stream, passed through). */
export type TernEvent =
  | { type: "queued"; position: number }
  | { type: "started"; queue_wait_ms?: number }
  | { type: "thinking"; turn: number }
  | { type: "tool"; name: string; args?: Record<string, unknown> }
  | { type: "tool_done"; name: string; ok: boolean; summary?: string }
  | { type: "answer"; text: string; outcome?: string; trace_id?: string | null }
  | { type: "error"; status?: number; detail: string };

/** Ask Tern and call onEvent for every progress event as it arrives. Resolves when the
 * stream ends; a failed request becomes one error event (never throws). */
export async function askTern(
  question: string,
  onEvent: (event: TernEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${BACKEND_URL}/tern/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
      signal,
    });
  } catch {
    if (!signal?.aborted) onEvent({ type: "error", detail: "Can't reach RED's backend" });
    return;
  }
  if (!response.ok || !response.body) {
    const detail =
      response.status === 409
        ? "Tern is still answering the last question"
        : `Tern request failed (HTTP ${response.status})`;
    onEvent({ type: "error", status: response.status, detail });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const emit = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const event = JSON.parse(trimmed) as TernEvent;
      if (event && typeof event === "object" && "type" in event) onEvent(event);
    } catch {
      /* a partial or foreign line: skip */
    }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        emit(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    }
    emit(buffer);
  } catch {
    if (!signal?.aborted) onEvent({ type: "error", detail: "Lost the connection to Tern" });
  }
}

const STEP_LABELS: Record<string, string> = {
  list_runs: "Finding runs",
  list_laps: "Reading lap times",
  compare_laps: "Comparing laps",
  list_turns: "Reading turns",
  get_turn: "Reading a turn",
  compare_turn_instances: "Comparing turns",
  list_straights: "Reading straights",
  get_straight: "Reading a straight",
  list_track_segments: "Reading the track map",
  get_live_status: "Checking the live feed",
  get_live_window: "Reading recent telemetry",
  list_recordings: "Looking through recordings",
  describe_recording: "Reading a recording",
  read_only_sql: "Querying the data",
  find_nas_files: "Searching the NAS",
};

/** "list_laps" -> "Reading lap times": what a step means, not how it is called. */
export function stepLabel(tool: string): string {
  return STEP_LABELS[tool] ?? tool.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** A short hint from the arguments that matter to a person ("lap 3", "live-uc26-...-0412"). */
export function stepHint(args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  const parts: string[] = [];
  if (typeof args.lap_number === "number") parts.push(`lap ${args.lap_number}`);
  if (Array.isArray(args.lap_numbers)) parts.push(`laps ${args.lap_numbers.join(", ")}`);
  if (typeof args.turn_number === "number") parts.push(`turn ${args.turn_number}`);
  if (typeof args.run_id === "string") parts.push(args.run_id);
  return parts.join(" · ");
}
