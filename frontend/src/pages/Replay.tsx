import { BACKEND_URL } from "../utils/backend";
import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import InteractiveGrid from "../layouts/InteractiveGrid";
import type { SocketData } from "../utils/Socket";

const DEFAULT_LATITUDE = 42.44666485723302;
const DEFAULT_LONGITUDE = -76.4608710371343;
const PLAYBACK_SPEEDS = [0.5, 1, 2, 4, 10, 20, 50, 100];
const BASE_PLAYBACK_INTERVAL_MS = 100;
const MPH_PER_MPS = 2.23694;

type ParsedReplayResult = {
  rows: SocketData[];
  warnings: string[];
};

type CsvRow = Record<string, string>;

type RosbagReplayResponse = {
  rows?: Record<string, unknown>[];
  warnings?: string[];
};

export default function Replay() {
  const [replayData, setReplayData] = useState<SocketData[]>([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [fileName, setFileName] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState(
    "Upload a CSV telemetry export or rosbag2 SQLite `.db3` file to replay it on the dashboard.",
  );

  const visibleData = useMemo(
    () => replayData.slice(0, frameIndex + 1),
    [frameIndex, replayData],
  );

  useEffect(() => {
    if (!isPlaying || replayData.length <= 1) {
      return;
    }

    if (frameIndex >= replayData.length - 1) {
      return;
    }

    const timeoutId = window.setTimeout(
      () => {
        setFrameIndex((previous) => {
          const nextFrame = Math.min(
            previous +
              (playbackSpeed < 10
                ? 1
                : playbackSpeed <= 20
                  ? 2
                  : playbackSpeed <= 50
                    ? 5
                    : 10),
            replayData.length - 1,
          );

          if (nextFrame >= replayData.length - 1) {
            setIsPlaying(false);
          }

          return nextFrame;
        });
      },
      Math.max(1, BASE_PLAYBACK_INTERVAL_MS / playbackSpeed),
    );

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [frameIndex, isPlaying, playbackSpeed, replayData.length]);

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setIsPlaying(false);

    if (file.name.toLowerCase().endsWith(".csv")) {
      try {
        const text = await file.text();
        const parsed = parseReplayCsv(text);

        if (parsed.rows.length === 0) {
          setReplayData([]);
          setFrameIndex(0);
          setFileName(file.name);
          setStatusMessage("No replayable rows were found in that CSV file.");
          return;
        }

        setReplayData(parsed.rows);
        setFrameIndex(0);
        setFileName(file.name);
        setStatusMessage(
          parsed.warnings.length > 0
            ? `Loaded ${parsed.rows.length} samples from ${file.name}. ${parsed.warnings[0]}`
            : `Loaded ${parsed.rows.length} samples from ${file.name}.`,
        );
        return;
      } catch (error) {
        console.error("Failed to parse replay CSV:", error);
        setReplayData([]);
        setFrameIndex(0);
        setFileName(file.name);
        setStatusMessage(
          "That CSV could not be parsed. Check the column names and file format.",
        );
        return;
      }
    }

    if (file.name.toLowerCase().endsWith(".db3")) {
      try {
        const parsed = await parseReplayRosbag(file);

        if (parsed.rows.length === 0) {
          setReplayData([]);
          setFrameIndex(0);
          setFileName(file.name);
          setStatusMessage("No replayable telemetry messages were found in that ROS bag.");
          return;
        }

        setReplayData(parsed.rows);
        setFrameIndex(0);
        setFileName(file.name);
        setStatusMessage(
          parsed.warnings.length > 0
            ? `Loaded ${parsed.rows.length} samples from ${file.name}. ${parsed.warnings[0]}`
            : `Loaded ${parsed.rows.length} samples from ${file.name}.`,
        );
        return;
      } catch (error) {
        console.error("Failed to parse replay ROS bag:", error);
        setReplayData([]);
        setFrameIndex(0);
        setFileName(file.name);
        setStatusMessage(
          "That ROS bag could not be parsed. Upload a rosbag2 SQLite `.db3` file with JSON telemetry messages.",
        );
        return;
      }
    }

    setReplayData([]);
    setFrameIndex(0);
    setFileName(file.name);
    setStatusMessage(
      "Replay currently supports CSV files and rosbag2 SQLite `.db3` files.",
    );
  };

  const hasReplay = replayData.length > 0;

  return (
    <section className="h-[min(92.5vh,calc(100vh-67px))] w-full overflow-y-scroll [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
      <div className="flex min-h-full flex-col gap-4 px-3 pt-3 pb-4 sm:px-4 lg:px-5">
        <section className="rounded-[1.25rem] border border-white/8 bg-[linear-gradient(180deg,#242424,#252525)] p-4 text-white shadow-[0_18px_40px_rgba(0,0,0,0.24)]">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.26em] text-white/55">
                Replay Session
              </p>
              <h1 className="mt-1 text-2xl font-semibold text-white">
                Upload telemetry and replay it on the dashboard
              </h1>
              <p className="mt-2 text-sm text-white/65">{statusMessage}</p>
              {fileName ? (
                <p className="mt-2 text-xs uppercase tracking-[0.22em] text-white/45">
                  File: {fileName}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              <label className="flex cursor-pointer items-center justify-center rounded-full border border-white/10 bg-white/6 px-4 py-2 text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:border-(--primary-accent) hover:bg-white/10">
                Upload CSV / ROSBag
                <input
                  type="file"
                  accept=".csv,.db3,text/csv"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </label>

              <button
                type="button"
                className="rounded-full border border-white/10 bg-white/6 px-4 py-2 text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => {
                  if (!hasReplay) {
                    return;
                  }

                  if (!isPlaying && frameIndex >= replayData.length - 1) {
                    setFrameIndex(0);
                  }

                  setIsPlaying((previous) => !previous);
                }}
                disabled={!hasReplay}
              >
                {isPlaying ? "Pause" : "Play"}
              </button>

              <button
                type="button"
                className="rounded-full border border-white/10 bg-white/6 px-4 py-2 text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => {
                  setIsPlaying(false);
                  setFrameIndex(0);
                }}
                disabled={!hasReplay}
              >
                Reset
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-center">
            <div>
              <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-[0.2em] text-white/45">
                <span>Frame</span>
                <span>
                  {hasReplay ? frameIndex + 1 : 0} / {replayData.length}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(replayData.length - 1, 0)}
                value={Math.min(frameIndex, Math.max(replayData.length - 1, 0))}
                onChange={(event) => {
                  setIsPlaying(false);
                  setFrameIndex(Number(event.target.value));
                }}
                disabled={!hasReplay}
                className="range range-sm w-full"
              />
            </div>

            <label className="flex items-center gap-3 text-sm text-white/75">
              <span className="uppercase tracking-[0.18em] text-white/45">
                Speed
              </span>
              <select
                value={playbackSpeed}
                onChange={(event) => {
                  setPlaybackSpeed(Number(event.target.value));
                }}
                className="rounded-full border border-white/10 bg-[#1f1f1f] px-3 py-2 text-sm text-white outline-none"
              >
                {PLAYBACK_SPEEDS.map((speed) => (
                  <option key={speed} value={speed}>
                    {speed}x
                  </option>
                ))}
              </select>
            </label>

            <div className="text-sm text-white/55">
              {hasReplay
                ? `Showing sample ${frameIndex + 1} as the current dashboard state.`
                : "CSV columns can be flat or dotted, and rosbag2 `.db3` uploads can replay JSON telemetry from `std_msgs/String` topics."}
            </div>
          </div>
        </section>
        <InteractiveGrid data={visibleData} mode="replay" />
      </div>
    </section>
  );
}

function parseReplayCsv(source: string): ParsedReplayResult {
  const rows = parseCsv(source);

  if (rows.length === 0) {
    return { rows: [], warnings: [] };
  }

  const normalizedRows = rows
    .map((row, index) => mapCsvRowToSocketData(row, index))
    .filter((row) => Number.isFinite(row.global_ts))
    .sort((left, right) => left.global_ts - right.global_ts)
    .map((row, index) => ({ ...row, seq: index + 1 }));

  const warnings: string[] = [];

  if (normalizedRows.some((row) => row.gps.lat === DEFAULT_LATITUDE)) {
    warnings.push(
      "Some GPS fields were missing, so default coordinates were used.",
    );
  }

  return {
    rows: normalizedRows,
    warnings,
  };
}

async function parseReplayRosbag(file: File): Promise<ParsedReplayResult> {
  const fileBytes = await file.arrayBuffer();

  const response = await fetch(`${BACKEND_URL}/replay/rosbag`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-File-Name": file.name,
    },
    body: fileBytes,
  });

  const payload = (await response.json()) as RosbagReplayResponse & {
    detail?: string;
  };

  if (!response.ok) {
    throw new Error(payload.detail ?? "ROS bag replay request failed.");
  }

  const rows = (payload.rows ?? [])
    .map((row, index) => mapRosbagRowToSocketData(row, index))
    .filter((row) => Number.isFinite(row.global_ts))
    .sort((left, right) => left.global_ts - right.global_ts)
    .map((row, index) => ({ ...row, seq: index + 1 }));

  const warnings = [...(payload.warnings ?? [])];

  if (rows.some((row) => row.gps.lat === DEFAULT_LATITUDE)) {
    warnings.push(
      "Some GPS fields were missing, so default coordinates were used.",
    );
  }

  return {
    rows,
    warnings,
  };
}

function parseCsv(source: string): CsvRow[] {
  const rows: string[][] = [];
  let currentCell = "";
  let currentRow: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];

    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        currentCell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }

      continue;
    }

    if (character === "," && !inQuotes) {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !inQuotes) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }

      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = "";
      continue;
    }

    currentCell += character;
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  if (rows.length === 0) {
    return [];
  }

  const [headerRow, ...valueRows] = rows;
  const headers = headerRow.map((header) => header.trim());

  return valueRows
    .filter((row) => row.some((value) => value.trim().length > 0))
    .map((row) =>
      headers.reduce<CsvRow>((record, header, index) => {
        record[header] = row[index]?.trim() ?? "";
        return record;
      }, {}),
    );
}

function mapCsvRowToSocketData(row: CsvRow, index: number): SocketData {
  const normalizedRow = Object.entries(row).reduce<Record<string, string>>(
    (record, [key, value]) => {
      record[normalizeHeader(key)] = value;
      return record;
    },
    {},
  );

  const globalTs = getTimestamp(normalizedRow, index);
  const gpsSpeed = getSpeedMetersPerSecond(normalizedRow, [
    "gpsspeedmps",
    "gpsspeed",
    "speedmps",
    "speed",
    "velocity",
  ]);
  const filteredSpeed = getSpeedMetersPerSecond(
    normalizedRow,
    ["filteredspeedmps", "filteredspeed", "speedfilteredmps", "speedfiltered"],
    gpsSpeed,
  );

  return {
    seq: getNumber(normalizedRow, ["seq", "index", "row"], index + 1),
    global_ts: globalTs,
    power: {
      ts: getTimestamp(normalizedRow, index, ["powerts"], globalTs),
      current: getNumber(normalizedRow, [
        "powercurrent",
        "current",
        "batterycurrent",
        "packcurrent",
      ]),
      voltage: getNumber(normalizedRow, [
        "powervoltage",
        "voltage",
        "batteryvoltage",
        "packvoltage",
      ]),
    },
    steering: {
      ts: getTimestamp(normalizedRow, index, ["steeringts"], globalTs),
      brake_pressure: getNumber(normalizedRow, [
        "steeringbrakepressure",
        "brakepressure",
        "brake",
      ]),
      turn_angle: getNumber(normalizedRow, [
        "steeringturnangle",
        "turnangle",
        "steeringangle",
        "angle",
      ]),
    },
    rpm_front: {
      ts: getTimestamp(normalizedRow, index, ["rpmfrontts"], globalTs),
      rpm_left: getNumber(normalizedRow, [
        "rpmfrontrpmleft",
        "rpmfrontleft",
        "frontleftrpm",
      ]),
      rpm_right: getNumber(normalizedRow, [
        "rpmfrontrpmright",
        "rpmfrontright",
        "frontrightrpm",
      ]),
    },
    rpm_back: {
      ts: getTimestamp(normalizedRow, index, ["rpmbackts"], globalTs),
      rpm_left: getNumber(normalizedRow, [
        "rpmbackrpmleft",
        "rpmbackleft",
        "rearleftrpm",
        "backleftrpm",
      ]),
      rpm_right: getNumber(normalizedRow, [
        "rpmbackrpmright",
        "rpmbackright",
        "rearrightrpm",
        "backrightrpm",
      ]),
    },
    gps: {
      ts: getTimestamp(normalizedRow, index, ["gpsts", "locationts"], globalTs),
      lat: getNumber(
        normalizedRow,
        ["gpslat", "lat", "latitude"],
        DEFAULT_LATITUDE,
      ),
      long: getNumber(
        normalizedRow,
        ["gpslong", "long", "lng", "lon", "longitude"],
        DEFAULT_LONGITUDE,
      ),
      heading: getNumber(normalizedRow, ["gpsheading", "heading"]),
      speed: gpsSpeed,
    },
    motor: {
      ts: getTimestamp(normalizedRow, index, ["motorts"], globalTs),
      rpm: getNumber(normalizedRow, ["motorrpm", "rpm"]),
      duty_cycle: getNumber(normalizedRow, [
        "motordutycycle",
        "motorthrottle",
        "dutycycle",
        "duty",
      ]),
    },
    filtered: {
      speed: filteredSpeed,
    },
    latency_ms: getNullableNumber(normalizedRow, ["latencyms", "latency"]),
  };
}

function mapRosbagRowToSocketData(
  row: Record<string, unknown>,
  index: number,
): SocketData {
  const csvLikeRow = Object.entries(row).reduce<CsvRow>((record, [key, value]) => {
    record[key] = value == null ? "" : String(value);
    return record;
  }, {});

  return mapCsvRowToSocketData(csvLikeRow, index);
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getNumber(
  row: Record<string, string>,
  aliases: string[],
  fallback = 0,
): number {
  for (const alias of aliases) {
    const value = row[alias];

    if (value == null || value.length === 0) {
      continue;
    }

    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function getNullableNumber(
  row: Record<string, string>,
  aliases: string[],
): number | null {
  for (const alias of aliases) {
    const value = row[alias];

    if (value == null || value.length === 0) {
      continue;
    }

    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function getSpeedMetersPerSecond(
  row: Record<string, string>,
  aliases: string[],
  fallback = 0,
): number {
  for (const alias of aliases) {
    const value = row[alias];

    if (value == null || value.length === 0) {
      continue;
    }

    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
      continue;
    }

    if (alias.includes("mph")) {
      return parsed / MPH_PER_MPS;
    }

    return parsed;
  }

  return fallback;
}

function getTimestamp(
  row: Record<string, string>,
  index: number,
  aliases = [
    "globalts",
    "timestamp",
    "ts",
    "time",
    "stamp",
    "stampns",
    "stampus",
    "timems",
    "timeus",
  ],
  fallback?: number,
): number {
  for (const alias of aliases) {
    const value = row[alias];

    if (value == null || value.length === 0) {
      continue;
    }

    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
      continue;
    }

    return parsed;
  }

  return fallback ?? (index + 1) * 100000;
}
