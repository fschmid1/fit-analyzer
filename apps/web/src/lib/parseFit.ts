import { Decoder, Stream } from "@garmin/fitsdk";
import type {
	ActivityRecord,
	ActivitySummary,
	LapMarker,
	ParsedActivity,
} from "@fit-analyzer/shared";
import { computePeakPower } from "./stats";

type FitMessage = Record<string, unknown>;

function isFitMessage(value: unknown): value is FitMessage {
	return typeof value === "object" && value !== null;
}

function asFitMessages(value: unknown): FitMessage[] {
	return Array.isArray(value) ? value.filter(isFitMessage) : [];
}

function asValidDate(value: unknown): Date | null {
	if (value instanceof Date && !Number.isNaN(value.getTime())) {
		return value;
	}
	if (typeof value === "number") {
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? null : date;
	}
	return null;
}

function asFiniteNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

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

	const recordMesgs = asFitMessages(messages.recordMesgs);
	const sessionMesgs = asFitMessages(messages.sessionMesgs);
	const lapMesgs = asFitMessages(messages.lapMesgs);

	if (recordMesgs.length === 0) {
		throw new Error("FIT file contains no record data");
	}

	const parsedRecordMesgs = recordMesgs.flatMap((msg) => {
		const timestamp = asValidDate(msg.timestamp);
		return timestamp ? [{ msg, timestamp }] : [];
	});
	if (parsedRecordMesgs.length === 0) {
		throw new Error("FIT file contains no valid record timestamps");
	}

	const startTime = parsedRecordMesgs[0].timestamp;

	const records: ActivityRecord[] = parsedRecordMesgs.map(
		({ msg, timestamp }) => {
			const rawSpeed = msg.enhancedSpeed ?? msg.speed ?? null;
			return {
				timestamp,
				elapsedSeconds: (timestamp.getTime() - startTime.getTime()) / 1000,
				power: typeof msg.power === "number" ? msg.power : null,
				heartRate: typeof msg.heartRate === "number" ? msg.heartRate : null,
				cadence: typeof msg.cadence === "number" ? msg.cadence : null,
				speed:
					typeof rawSpeed === "number"
						? Math.round(rawSpeed * 3.6 * 10) / 10
						: null,
				gradient:
					typeof msg.grade === "number"
						? Math.round(msg.grade * 10) / 10
						: null,
			};
		},
	);

	// Extract session data (use first session)
	const session = sessionMesgs[0];

	const dateStr = startTime.toISOString().split("T")[0];

	const peak1min = computePeakPower(records, 60);
	const peak5min = computePeakPower(records, 300);
	const totalTimerTime = asFiniteNumber(session?.totalTimerTime);
	const totalDistance = asFiniteNumber(session?.totalDistance);
	const avgPower = asFiniteNumber(session?.avgPower);
	const maxPower = asFiniteNumber(session?.maxPower);
	const avgHeartRate = asFiniteNumber(session?.avgHeartRate);
	const maxHeartRate = asFiniteNumber(session?.maxHeartRate);
	const avgCadence = asFiniteNumber(session?.avgCadence);
	const totalWork = asFiniteNumber(session?.totalWork);

	const summary: ActivitySummary = {
		date: dateStr,
		totalTimerTime:
			totalTimerTime != null
				? Math.round(totalTimerTime)
				: Math.round(records[records.length - 1].elapsedSeconds),
		totalDistanceKm:
			totalDistance != null
				? Math.round((totalDistance / 1000) * 10) / 10
				: null,
		avgPower: avgPower != null ? Math.round(avgPower) : null,
		maxPower: maxPower != null ? Math.round(maxPower) : null,
		avgHeartRate: avgHeartRate != null ? Math.round(avgHeartRate) : null,
		maxHeartRate: maxHeartRate != null ? Math.round(maxHeartRate) : null,
		avgCadence: avgCadence != null ? Math.round(avgCadence) : null,
		totalWork: totalWork != null ? Math.round(totalWork) : null,
		peak1minPower: peak1min,
		peak5minPower: peak5min,
	};

	// Extract lap markers
	const laps: LapMarker[] = lapMesgs.flatMap((lap) => {
		const lapStart = asValidDate(lap.startTime);
		const lapTimestamp = asValidDate(lap.timestamp);
		if (!lapStart || !lapTimestamp) return [];

		return [
			{
				startSeconds: (lapStart.getTime() - startTime.getTime()) / 1000,
				endSeconds: (lapTimestamp.getTime() - startTime.getTime()) / 1000,
				avgPower:
					typeof lap.avgPower === "number" ? Math.round(lap.avgPower) : null,
				avgHeartRate:
					typeof lap.avgHeartRate === "number"
						? Math.round(lap.avgHeartRate)
						: null,
				avgCadence:
					typeof lap.avgCadence === "number"
						? Math.round(lap.avgCadence)
						: null,
			},
		];
	});

	return { records, summary, laps };
}
