import { useEffect, useState } from "react";
import PauseRoundedIcon from "@mui/icons-material/PauseRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import { LineChart } from "@mui/x-charts";
import { roundTo, TIMESTAMP_UNITS_PER_SECOND } from "../utils/telemetry";

const chartSx = {
  ".MuiChartsAxis-root .MuiChartsAxis-line": {
    stroke: "rgba(255,255,255,0.2)",
  },
  ".MuiChartsAxis-root text": {
    fill: "rgba(255,255,255,0.78)",
  },
  ".MuiChartsAxis-tickLabel": {
    fill: "rgba(255,255,255,0.72)",
    fontSize: 11,
  },
  ".MuiChartsAxis-label": {
    fill: "rgba(255,255,255,0.82)",
  },
  ".MuiChartsGrid-line": {
    stroke: "rgba(255,255,255,0.08)",
  },
};

type SecondarySeries = {
  data: number[];
  currentValue: string;
  unit: string;
  accentColor: string;
  yMax?: number;
};

export default function CompactChart({
  data,
  rawTimestamps,
  labels,
  timestamps,
  currentValue,
  unit,
  accentColor,
  yMax,
  secondarySeries,
  isPaused,
  onTogglePause,
  testId,
}: {
  data: number[];
  rawTimestamps: number[];
  labels: string[];
  timestamps: string[];
  currentValue: string;
  unit: string;
  accentColor: string;
  yMax?: number;
  secondarySeries?: SecondarySeries;
  isPaused: boolean;
  onTogglePause: () => void;
  /** data-testid for Playwright: `${testId}-value` and `${testId}-secondary-value`. */
  testId?: string;
}) {
  const latestPointOnly = data.map((value, index) =>
    index === data.length - 1 ? value : null,
  );
  const secondaryLatestPointOnly = secondarySeries?.data.map((value, index) =>
    index === secondarySeries.data.length - 1 ? value : null,
  );

  const [selectedTimestamps, setSelectedTimestamps] = useState<number[]>([]);

  const sparseTickValues = getSparseTickValues(labels);
  const pauseButtonLabel = isPaused ? "Resume" : "Pause";
  const PauseButtonIcon = isPaused ? PlayArrowRoundedIcon : PauseRoundedIcon;

  const formatTimestampLabel = (value: string) => {
    const index = Number.parseInt(value, 10);
    return Number.isNaN(index) ? value : (timestamps[index] ?? "");
  };

  const orderedSelectedIndexes = getOrderedSelectedIndexes(
    selectedTimestamps,
    rawTimestamps,
  );

  const selectedPointSeries = data.map((value, index) =>
    orderedSelectedIndexes.includes(index) ? value : null,
  );

  const selectedSlopeSeries =
    orderedSelectedIndexes.length === 2
      ? data.map((value, index) =>
          orderedSelectedIndexes.includes(index) ? value : null,
        )
      : [];

  const secondarySelectedSlopeSeries =
    orderedSelectedIndexes.length === 2 && secondarySeries
      ? secondarySeries.data.map((value, index) =>
          orderedSelectedIndexes.includes(index) ? value : null,
        )
      : [];

  const secondarySelectedPointSeries = secondarySeries
    ? secondarySeries.data.map((value, index) =>
        orderedSelectedIndexes.includes(index) ? value : null,
      )
    : [];

  const primarySlopeMeasurement =
    orderedSelectedIndexes.length === 2
      ? calculateSlopeMeasurement(
          orderedSelectedIndexes[0],
          orderedSelectedIndexes[1],
          data,
          rawTimestamps,
          unit,
        )
      : null;

  const secondarySlopeMeasurement =
    orderedSelectedIndexes.length === 2 && secondarySeries
      ? calculateSlopeMeasurement(
          orderedSelectedIndexes[0],
          orderedSelectedIndexes[1],
          secondarySeries.data,
          rawTimestamps,
          secondarySeries.unit,
        )
      : null;

  useEffect(() => {
    setSelectedTimestamps((previous) => {
      if (previous.length === 0) {
        return previous;
      }

      if (rawTimestamps.length === 0) {
        return [];
      }

      const minTimestamp = rawTimestamps[0];
      const maxTimestamp = rawTimestamps[rawTimestamps.length - 1];
      const availableTimestamps = new Set(rawTimestamps);
      const next = previous.filter(
        (timestamp) =>
          Number.isFinite(timestamp) &&
          timestamp >= minTimestamp &&
          timestamp <= maxTimestamp &&
          availableTimestamps.has(timestamp),
      );

      return next.length === previous.length ? previous : next;
    });
  }, [rawTimestamps]);

  useEffect(() => {
    if (!isPaused) {
      setSelectedTimestamps([]);
    }
  }, [isPaused, unit]);

  const handleAxisClick = (
    _event: MouseEvent,
    axisData: { dataIndex: number } | null,
  ) => {
    if (!axisData || !Number.isInteger(axisData.dataIndex)) {
      return;
    }

    const clickedIndex = axisData.dataIndex;

    if (clickedIndex < 0 || clickedIndex >= data.length) {
      return;
    }

    const clickedTimestamp = rawTimestamps[clickedIndex];

    if (!Number.isFinite(clickedTimestamp)) {
      return;
    }

    setSelectedTimestamps((previous) => {
      if (previous.length === 2) {
        return [];
      }

      if (previous.includes(clickedTimestamp)) {
        return [];
      }

      return [...previous, clickedTimestamp];
    });
  };

  return (
    <div className="relative flex h-full min-h-0 flex-1">
      <div className="pointer-events-none absolute inset-x-3 top-1 z-10 flex flex-wrap items-center justify-between gap-2 *:pointer-events-auto">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div
            className={`rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-xs ${primarySlopeMeasurement ? "opacity-100" : "opacity-0 pointer-events-none"} font-medium text-white/88`}
          >
            {primarySlopeMeasurement?.label ?? "+0.00 mph/s"}
          </div>
          <div
            className={`rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-xs ${secondarySlopeMeasurement ? "opacity-100" : "opacity-0 pointer-events-none"} font-medium text-white/88`}
          >
            {secondarySlopeMeasurement?.label ?? "+0.00 kW/s"}
          </div>
        </div>

        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          <div
            className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-xs font-medium text-white/88"
            data-testid={testId && `${testId}-value`}
          >
            {currentValue}
          </div>

          {secondarySeries && (
            <div
              className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-xs font-medium text-white/88"
              data-testid={testId && `${testId}-secondary-value`}
            >
              {secondarySeries.currentValue}
            </div>
          )}
          <button
            type="button"
            aria-label={pauseButtonLabel}
            title={pauseButtonLabel}
            className="play-button rounded-fullp-0 text-xs font-medium text-white focus:outline-none hover:outline-none hover:border-0"
            onClick={onTogglePause}
          >
            <PauseButtonIcon sx={{ fontSize: 18 }} />
          </button>
        </div>
      </div>

      <LineChart
        margin={{
          top: 40,
          right: secondarySeries ? 20 : 8,
          bottom: 10,
          left: 10,
        }}
        height={220}
        grid={{ horizontal: true }}
        xAxis={[
          {
            scaleType: "point",
            data: labels,
            height: 28,
            valueFormatter: (value) => formatTimestampLabel(value),
            tickInterval: sparseTickValues,
            disableLine: true,
            disableTicks: true,
          },
        ]}
        yAxis={[
          {
            id: "primary",
            min: 0,
            max: yMax,
            width: 36,
            disableTicks: true,
            valueFormatter: (value: number) => (value === 0 ? "" : `${value}`),
          },
          ...(secondarySeries
            ? [
                {
                  id: "secondary",
                  min: 0,
                  max: secondarySeries.yMax,
                  position: "right" as const,
                  width: 36,
                  disableTicks: true,
                  valueFormatter: (value: number) =>
                    value === 0 ? "" : `${value}`,
                },
              ]
            : []),
        ]}
        series={[
          {
            id: "primary-series",
            data,
            color: accentColor,
            showMark: false,
            area: true,
            yAxisId: "primary",
            valueFormatter: (value) =>
              value === null ? null : `${value} ${unit}`,
          },
          {
            id: "primary-latest",
            data: latestPointOnly,
            color: accentColor,
            showMark: true,
            curve: "linear",
            yAxisId: "primary",
            valueFormatter: () => null,
          },
          ...(orderedSelectedIndexes.length === 2
            ? [
                {
                  id: "primary-slope-line",
                  data: selectedSlopeSeries,
                  color: accentColor + "99",
                  showMark: false,
                  curve: "linear" as const,
                  connectNulls: true,
                  yAxisId: "primary",
                  valueFormatter: () => null,
                },
              ]
            : []),
          ...(orderedSelectedIndexes.length > 0
            ? [
                {
                  id: "primary-selection-points",
                  data: selectedPointSeries,
                  color: accentColor + "99",
                  showMark: true,
                  curve: "linear" as const,
                  yAxisId: "primary",
                  valueFormatter: () => null,
                },
              ]
            : []),
          ...(secondarySeries
            ? [
                {
                  id: "secondary-series",
                  data: secondarySeries.data,
                  color: secondarySeries.accentColor,
                  showMark: false,
                  curve: "linear" as const,
                  yAxisId: "secondary",
                  valueFormatter: (value: number | null) =>
                    value === null ? null : `${value} ${secondarySeries.unit}`,
                },
                {
                  id: "secondary-latest",
                  data: secondaryLatestPointOnly ?? [],
                  color: secondarySeries.accentColor,
                  showMark: true,
                  curve: "linear" as const,
                  yAxisId: "secondary",
                  valueFormatter: () => null,
                },
                ...(orderedSelectedIndexes.length === 2
                  ? [
                      {
                        id: "secondary-slope-line",
                        data: secondarySelectedSlopeSeries,
                        color: secondarySeries.accentColor,
                        showMark: false,
                        curve: "linear" as const,
                        connectNulls: true,
                        yAxisId: "secondary",
                        valueFormatter: () => null,
                      },
                    ]
                  : []),
                ...(orderedSelectedIndexes.length > 0
                  ? [
                      {
                        id: "secondary-selection-points",
                        data: secondarySelectedPointSeries,
                        color: secondarySeries.accentColor,
                        showMark: true,
                        curve: "linear" as const,
                        yAxisId: "secondary",
                        valueFormatter: () => null,
                      },
                    ]
                  : []),
              ]
            : []),
        ]}
        sx={{
          ...chartSx,
          "& .MuiLineElement-series-secondary-series": {
            strokeDasharray: "6 4",
          },
          "& .MuiLineElement-series-primary-slope-line": {
            strokeWidth: 2.5,
            opacity: 0.95,
          },
          "& .MuiLineElement-series-secondary-slope-line": {
            strokeWidth: 2.5,
            opacity: 0.95,
          },
          "& .MuiMarkElement-root": {
            strokeWidth: 2,
            r: 4,
          },
          "& .MuiMarkElement-series-primary-latest": {
            fill: "#ffffff",
            stroke: accentColor,
          },
          "& .MuiMarkElement-series-primary-selection-points": {
            fill: accentColor,
            stroke: accentColor,
            strokeWidth: 0,
            r: 5,
          },
          ...(secondarySeries
            ? {
                "& .MuiMarkElement-series-secondary-latest": {
                  fill: "#ffffff",
                  stroke: secondarySeries.accentColor,
                },
                "& .MuiMarkElement-series-secondary-selection-points": {
                  fill: secondarySeries.accentColor,
                  stroke: secondarySeries.accentColor,
                  strokeWidth: 0,
                  r: 5,
                },
              }
            : {}),
          "& .MuiAreaElement-root": {
            fillOpacity: 0.2,
          },
        }}
        slotProps={{
          tooltip: {
            sx: {
              "& .MuiChartsTooltip-table": {
                backgroundColor: "#1e1e1e",
              },
            },
          },
        }}
        onAxisClick={handleAxisClick}
        skipAnimation
      />
    </div>
  );
}

function getOrderedSelectedIndexes(
  selectedTimestamps: number[],
  rawTimestamps: number[],
) {
  if (selectedTimestamps.length === 0 || rawTimestamps.length === 0) {
    return [];
  }

  const timestampToIndex = new Map<number, number>();

  rawTimestamps.forEach((timestamp, index) => {
    if (Number.isFinite(timestamp) && !timestampToIndex.has(timestamp)) {
      timestampToIndex.set(timestamp, index);
    }
  });

  const selectedIndexes = selectedTimestamps
    .map((timestamp) => timestampToIndex.get(timestamp))
    .filter((index): index is number => index !== undefined);

  return selectedIndexes.length === 2
    ? selectedIndexes.sort((left, right) => left - right)
    : selectedIndexes;
}

function getSparseTickValues(labels: string[], maxTicks = 5) {
  if (labels.length <= maxTicks) {
    return labels;
  }

  const step = Math.ceil((labels.length - 1) / (maxTicks - 1));
  const selectedIndexes = new Set<number>([0, labels.length - 1]);

  for (let index = step; index < labels.length - 1; index += step) {
    selectedIndexes.add(index);
  }

  return labels.filter((_, index) => selectedIndexes.has(index));
}

function calculateSlopeMeasurement(
  startIndex: number,
  endIndex: number,
  data: number[],
  rawTimestamps: number[],
  unit: string,
) {
  const startValue = data[startIndex];
  const endValue = data[endIndex];
  const startTimestamp = rawTimestamps[startIndex];
  const endTimestamp = rawTimestamps[endIndex];
  const elapsedSeconds =
    (endTimestamp - startTimestamp) / TIMESTAMP_UNITS_PER_SECOND;

  if (
    !Number.isFinite(startValue) ||
    !Number.isFinite(endValue) ||
    !Number.isFinite(startTimestamp) ||
    !Number.isFinite(endTimestamp) ||
    elapsedSeconds <= 0
  ) {
    return null;
  }

  const slope = (endValue - startValue) / elapsedSeconds;

  if (!Number.isFinite(slope)) {
    return null;
  }

  return {
    value: slope,
    label: `${slope >= 0 ? "+" : ""}${roundTo(slope, 2)} ${unit}/s`,
  };
}
