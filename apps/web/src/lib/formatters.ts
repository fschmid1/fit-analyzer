import type { ActivitySummary, Interval } from "@fit-analyzer/shared";

export function formatElapsedTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatCopyBoxText(
  summary: ActivitySummary,
  intervals: Interval[]
): string {
  const lines: string[] = [];

  const weekday = new Date(summary.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" });
  lines.push(`- Date: ${summary.date} (${weekday})`);
  lines.push(
    `- Peak 1min Power: ${summary.peak1minPower ?? "N/A"}`
  );
  lines.push(
    `- Peak 5min Power: ${summary.peak5minPower ?? "N/A"}`
  );
  lines.push("");
  lines.push(
    `- total_timer_time: ${summary.totalTimerTime ? Math.round(summary.totalTimerTime) : "N/A"}`
  );
  lines.push(`- avg_power: ${summary.avgPower ?? "N/A"}`);
  lines.push(`- max_power: ${summary.maxPower ?? "N/A"}`);
  lines.push(`- avg_heartRate: ${summary.avgHeartRate ?? "N/A"}`);
  lines.push(`- max_heartRate: ${summary.maxHeartRate ?? "N/A"}`);
  lines.push(`- avg_cadence: ${summary.avgCadence ?? "N/A"}`);
  lines.push(
    `- total_work: ${summary.totalWork ? Math.round(summary.totalWork) : "N/A"}`
  );

  if (intervals.length > 0) {
    lines.push("");
    lines.push("Intervals:");
    for (let i = 0; i < intervals.length; i++) {
      const interval = intervals[i];
      const start = formatElapsedTime(interval.startSeconds);
      const dur = formatElapsedTime(interval.duration);
      const power = interval.avgPower ?? "—";
      const hr = interval.avgHeartRate ?? "—";
      const cad = interval.avgCadence ?? "—";
      lines.push(
        `  ${i + 1}. ${start} | ${dur} | ${power}W ${hr}bpm ${cad}rpm`
      );
    }
  }

  return lines.join("\n");
}
