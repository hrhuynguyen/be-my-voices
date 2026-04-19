import { useEffect, useRef, useState } from "react";

import type { EEGTelemetry } from "../types/eeg";

interface MuseDashboardProps {
  telemetry: EEGTelemetry | null;
}

const CHANNEL_ORDER = ["TP9", "AF7", "AF8", "TP10"] as const;
type ChannelName = (typeof CHANNEL_ORDER)[number];

const CHANNEL_COLORS: Record<ChannelName, string> = {
  TP9: "#c17b5c",
  AF7: "#2f4f4f",
  AF8: "#d4a24c",
  TP10: "#6b8e76",
};
const HISTORY_LENGTH = 90;
const CHART_WIDTH = 640;
const CHART_HEIGHT = 220;
const CHART_PADDING_X = 32;
const CHART_PADDING_Y = 16;
const INTERPOLATION_SMOOTHING = 0.22;
const ANIMATION_INTERVAL_MS = 60;

type ChannelHistory = Record<ChannelName, number[]>;

function emptyHistory(): ChannelHistory {
  return CHANNEL_ORDER.reduce((acc, name) => {
    acc[name] = [];
    return acc;
  }, {} as ChannelHistory);
}

function channelTotal(
  bandPowers: Record<string, Record<string, number>>,
  channel: string,
): number {
  const bands = bandPowers[channel];
  if (!bands) {
    return 0;
  }
  return Object.values(bands).reduce((sum, value) => sum + value, 0);
}

export function MuseDashboard({ telemetry }: MuseDashboardProps) {
  const [history, setHistory] = useState<ChannelHistory>(() => emptyHistory());
  const targetsRef = useRef<Record<ChannelName, number>>({
    TP9: 0,
    AF7: 0,
    AF8: 0,
    TP10: 0,
  });
  const lastWindowRef = useRef<string | null>(null);

  useEffect(() => {
    const features = telemetry?.features;
    const windowStamp = telemetry?.last_window_at ?? null;
    if (!features || !windowStamp || windowStamp === lastWindowRef.current) {
      return;
    }
    lastWindowRef.current = windowStamp;
    const bandPowers = features.band_powers as Record<
      string,
      Record<string, number>
    >;
    for (const channel of CHANNEL_ORDER) {
      targetsRef.current[channel] = channelTotal(bandPowers, channel);
    }
  }, [telemetry]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setHistory((previous) => {
        const next = { ...previous };
        for (const channel of CHANNEL_ORDER) {
          const series = previous[channel];
          const previousValue =
            series.length > 0 ? series[series.length - 1]! : 0;
          const target = targetsRef.current[channel];
          const smoothed =
            previousValue +
            (target - previousValue) * INTERPOLATION_SMOOTHING;
          const nextSeries = [...series, smoothed];
          if (nextSeries.length > HISTORY_LENGTH) {
            nextSeries.splice(0, nextSeries.length - HISTORY_LENGTH);
          }
          next[channel] = nextSeries;
        }
        return next;
      });
    }, ANIMATION_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);

  const allValues = CHANNEL_ORDER.flatMap((channel) => history[channel]);
  const maxValue = allValues.length > 0 ? Math.max(...allValues, 1e-6) : 1;

  const innerWidth = CHART_WIDTH - CHART_PADDING_X * 2;
  const innerHeight = CHART_HEIGHT - CHART_PADDING_Y * 2;

  function buildPath(series: number[]): string {
    if (series.length === 0) {
      return "";
    }
    const stepX =
      series.length > 1 ? innerWidth / (HISTORY_LENGTH - 1) : 0;
    const offsetX = innerWidth - (series.length - 1) * stepX;
    const points = series.map((value, index) => ({
      x: CHART_PADDING_X + offsetX + index * stepX,
      y:
        CHART_PADDING_Y +
        innerHeight -
        (value / maxValue) * innerHeight,
    }));
    if (points.length === 1) {
      const only = points[0]!;
      return `M${only.x.toFixed(2)},${only.y.toFixed(2)}`;
    }
    const first = points[0]!;
    let path = `M${first.x.toFixed(2)},${first.y.toFixed(2)}`;
    for (let i = 0; i < points.length - 1; i += 1) {
      const p1 = points[i]!;
      const p2 = points[i + 1]!;
      const p0 = points[i - 1] ?? p1;
      const p3 = points[i + 2] ?? p2;
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      path += ` C${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(
        2,
      )},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
    }
    return path;
  }

  return (
    <section className="surface-panel flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-ink/55">
            EEG Dashboard
          </p>
        </div>
        <div className="rounded-[24px] border border-ink/8 bg-white/70 px-4 py-3 text-right">
          <p className="text-xs uppercase tracking-[0.18em] text-ink/45">
            Emotion Detect
          </p>
          <p className="mt-2 font-display text-2xl capitalize text-ink">
            {telemetry?.tone_policy ?? "None"}
          </p>
        </div>
      </div>

      <div className="rounded-[28px] border border-ink/8 bg-white/65 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-[0.2em] text-ink/45">
            Band power by channel
          </p>
          <div className="flex flex-wrap gap-3 text-xs text-ink/70">
            {CHANNEL_ORDER.map((channel) => (
              <div key={channel} className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: CHANNEL_COLORS[channel] }}
                />
                <span className="uppercase tracking-[0.16em]">{channel}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 rounded-[24px] bg-mist/70 p-4">
          <svg
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            preserveAspectRatio="none"
            className="h-64 w-full"
            role="img"
            aria-label="Live band power per channel"
          >
            {[0.25, 0.5, 0.75].map((fraction) => (
              <line
                key={fraction}
                x1={CHART_PADDING_X}
                x2={CHART_WIDTH - CHART_PADDING_X}
                y1={CHART_PADDING_Y + innerHeight * fraction}
                y2={CHART_PADDING_Y + innerHeight * fraction}
                stroke="rgba(47,79,79,0.08)"
                strokeWidth={1}
              />
            ))}
            <line
              x1={CHART_PADDING_X}
              x2={CHART_WIDTH - CHART_PADDING_X}
              y1={CHART_PADDING_Y + innerHeight}
              y2={CHART_PADDING_Y + innerHeight}
              stroke="rgba(47,79,79,0.25)"
              strokeWidth={1}
            />
            {CHANNEL_ORDER.map((channel) => (
              <path
                key={channel}
                d={buildPath(history[channel])}
                fill="none"
                stroke={CHANNEL_COLORS[channel]}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
          </svg>
        </div>
      </div>
    </section>
  );
}
