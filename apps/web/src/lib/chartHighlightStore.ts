import type { ChartHighlight } from "@fit-analyzer/shared";

type Listener = (highlights: ChartHighlight[]) => void;

let highlights: ChartHighlight[] = [];
let listeners: Listener[] = [];

export function getChartHighlights(): ChartHighlight[] {
	return [...highlights];
}

export function addChartHighlight(highlight: ChartHighlight): void {
	highlights = [...highlights, highlight];
	for (const fn of listeners) fn(highlights);
}

export function clearChartHighlights(): void {
	highlights = [];
	for (const fn of listeners) fn(highlights);
}

export function subscribeChartHighlights(fn: Listener): () => void {
	listeners.push(fn);
	return () => {
		listeners = listeners.filter((l) => l !== fn);
	};
}
