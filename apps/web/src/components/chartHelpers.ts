import type { ActivityRecord } from "@fit-analyzer/shared";

export function findNearestElapsedIndex(
	records: ActivityRecord[],
	seconds: number,
): number {
	if (records.length === 0) return 0;

	let left = 0;
	let right = records.length - 1;

	while (left <= right) {
		const mid = Math.floor((left + right) / 2);
		const value = records[mid]?.elapsedSeconds ?? 0;

		if (value === seconds) return mid;
		if (value < seconds) {
			left = mid + 1;
		} else {
			right = mid - 1;
		}
	}

	if (left >= records.length) return records.length - 1;
	if (right < 0) return 0;

	const leftDiff = Math.abs((records[left]?.elapsedSeconds ?? 0) - seconds);
	const rightDiff = Math.abs((records[right]?.elapsedSeconds ?? 0) - seconds);

	return leftDiff < rightDiff ? left : right;
}

export interface ChartDataPoint {
	elapsedSeconds: number;
	power: number | null;
	heartRate: number | null;
	cadence: number | null;
	speed: number | null;
	gradient: number | null;
}

export function findStartIndex(data: ChartDataPoint[], seconds: number): number {
	let left = 0;
	let right = data.length;

	while (left < right) {
		const mid = Math.floor((left + right) / 2);
		if ((data[mid]?.elapsedSeconds ?? 0) < seconds) {
			left = mid + 1;
		} else {
			right = mid;
		}
	}

	return left;
}

export function findEndIndex(data: ChartDataPoint[], seconds: number): number {
	let left = 0;
	let right = data.length;

	while (left < right) {
		const mid = Math.floor((left + right) / 2);
		if ((data[mid]?.elapsedSeconds ?? 0) <= seconds) {
			left = mid + 1;
		} else {
			right = mid;
		}
	}

	return left;
}
