import { Decoder, Stream } from "@garmin/fitsdk";
import type { ActivityRecord, ActivitySummary, ParsedActivity } from "../types/fit";
import { computePeakPower } from "./stats";

export function parseFit(arrayBuffer: ArrayBuffer): ParsedActivity {
  const stream = Stream.fromArrayBuffer(arrayBuffer);
  const decoder = new Decoder(stream);

  if (!decoder.isFIT()) {
    throw new Error("Not a valid FIT file");
  }

  if (!decoder.checkIntegrity()) {
    throw new Error("FIT file integrity check failed");
  }

  const { messages, errors } = decoder.read({
    convertDateTimesToDates: true,
    expandSubFields: true,
    expandComponents: true,
    applyScaleAndOffset: true,
    mergeHeartRates: true,
  });

  if (errors && errors.length > 0) {
    console.warn("FIT decode warnings:", errors);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recordMesgs: any[] = messages.recordMesgs ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionMesgs: any[] = messages.sessionMesgs ?? [];

  if (recordMesgs.length === 0) {
    throw new Error("FIT file contains no record data");
  }

  const startTime = recordMesgs[0].timestamp as Date;

  const records: ActivityRecord[] = recordMesgs.map((msg) => ({
    timestamp: msg.timestamp as Date,
    elapsedSeconds:
      ((msg.timestamp as Date).getTime() - startTime.getTime()) / 1000,
    power: msg.power ?? null,
    heartRate: msg.heartRate ?? null,
    cadence: msg.cadence ?? null,
  }));

  // Extract session data (use first session)
  const session = sessionMesgs[0];

  const dateStr = startTime.toISOString().split("T")[0];

  const peak1min = computePeakPower(records, 60);
  const peak5min = computePeakPower(records, 300);

  const summary: ActivitySummary = {
    date: dateStr,
    totalTimerTime: session?.totalTimerTime
      ? Math.round(session.totalTimerTime)
      : Math.round(records[records.length - 1].elapsedSeconds),
    avgPower: session?.avgPower ? Math.round(session.avgPower) : null,
    maxPower: session?.maxPower ? Math.round(session.maxPower) : null,
    avgHeartRate: session?.avgHeartRate
      ? Math.round(session.avgHeartRate)
      : null,
    maxHeartRate: session?.maxHeartRate
      ? Math.round(session.maxHeartRate)
      : null,
    avgCadence: session?.avgCadence ? Math.round(session.avgCadence) : null,
    totalWork: session?.totalWork ? Math.round(session.totalWork) : null,
    peak1minPower: peak1min,
    peak5minPower: peak5min,
  };

  return { records, summary };
}
