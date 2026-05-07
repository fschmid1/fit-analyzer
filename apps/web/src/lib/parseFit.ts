import { Decoder, Stream } from "@garmin/fitsdk";
import type {
	ActivityRecord,
	ActivitySummary,
	LapMarker,
	ParsedActivity,
} from "@fit-analyzer/shared";
import { computePeakPower } from "./stats";

type FitMessage = Record<string, unknown>;

function asFitMessages(value: unknown): FitMessage[] {
	return Array.isArray(value)
		? value.filter((item): item is FitMessage => !!item)
		: [];
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

	const startTime = recordMesgs[0]?.timestamp as Date;

	const records: ActivityRecord[] = recordMesgs.map((msg) => {
		const rawSpeed = msg.enhancedSpeed ?? msg.speed ?? null;
		return {
			timestamp: msg.timestamp as Date,
			elapsedSeconds:
				((msg.timestamp as Date).getTime() - startTime.getTime()) / 1000,
			power: msg.power ?? null,
			heartRate: msg.heartRate ?? null,
			cadence: msg.cadence ?? null,
			speed: rawSpeed != null ? Math.round(rawSpeed * 3.6 * 10) / 10 : null,
			gradient: msg.grade != null ? Math.round(msg.grade * 10) / 10 : null,
		};
	});

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
		totalDistanceKm:
			session?.totalDistance != null
				? Math.round((session.totalDistance / 1000) * 10) / 10
				: null,
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

	// Extract lap markers
	const laps: LapMarker[] = lapMesgs.map((lap) => {
		const lapStart = lap.startTime as Date;
		const lapTimestamp = lap.timestamp as Date;
		return {
			startSeconds: (lapStart.getTime() - startTime.getTime()) / 1000,
			endSeconds: (lapTimestamp.getTime() - startTime.getTime()) / 1000,
			avgPower: lap.avgPower ? Math.round(lap.avgPower) : null,
			avgHeartRate: lap.avgHeartRate ? Math.round(lap.avgHeartRate) : null,
			avgCadence: lap.avgCadence ? Math.round(lap.avgCadence) : null,
		};
	});

	return { records, summary, laps };
}
