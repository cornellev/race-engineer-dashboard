import { useEffect, useState } from "react";
import socket from "../utils/Socket";

const STALE_AFTER_MS = 5000;

/** When live data stops (car off, link down, discovery lost), the dashboard keeps showing the
 * last values; this says so, so nobody reads a frozen speed as live. Hidden before the first
 * message (the empty-state cards cover that) and while data is flowing. */
export default function StaleTelemetryBanner() {
  const [ageMs, setAgeMs] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => {
      const last = socket.getLastMessageAt();
      setAgeMs(last === null ? null : Date.now() - last);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  if (ageMs === null || ageMs < STALE_AFTER_MS) return null;
  return (
    <div
      data-testid="telemetry-stale"
      className="mx-3 mt-2 rounded-xl border border-amber-400/40 bg-amber-500/15 px-4 py-2 text-sm text-amber-100 sm:mx-4 lg:mx-5"
    >
      No live data for {Math.round(ageMs / 1000)} s: showing the last values received.
    </div>
  );
}
