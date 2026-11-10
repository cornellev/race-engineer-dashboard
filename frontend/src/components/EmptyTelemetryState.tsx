export default function EmptyTelemetryState({
  compact = false,
}: {
  compact?: boolean;
}) {
  return (
    <div
      className={`flex h-full items-center justify-center rounded-2xl border border-dashed border-white/12 bg-black/14 px-4 text-center text-sm text-white/52 ${compact ? "min-h-35" : "min-h-55"}`}
      data-testid="no-telemetry"
    >
      Waiting for live ROS telemetry from the backend websocket.
    </div>
  );
}
