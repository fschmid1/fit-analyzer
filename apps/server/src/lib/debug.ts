/**
 * Lightweight debug logger with a common prefix.
 *
 * Logs are always emitted (no environment gate) so we can use them
 * when investigating "tool calls hang" type incidents on demand.
 * Each call site is tagged with a subsystem prefix so the relevant
 * lines are easy to grep for in the server log.
 */
export type DebugSubsystem =
	| "trainer"
	| "trainer-stream"
	| "trainer-loop"
	| "openrouter-stream"
	| "ollama-stream"
	| "tool-registry"
	| "tool";

function log(
	level: "log" | "warn" | "error",
	subsystem: DebugSubsystem,
	event: string,
	details?: Record<string, unknown>,
): void {
	const prefix = `[debug:${subsystem}] ${event}`;
	if (details && Object.keys(details).length > 0) {
		console[level](prefix, details);
	} else {
		console[level](prefix);
	}
}

export const debug = {
	log: (
		subsystem: DebugSubsystem,
		event: string,
		details?: Record<string, unknown>,
	) => log("log", subsystem, event, details),
	warn: (
		subsystem: DebugSubsystem,
		event: string,
		details?: Record<string, unknown>,
	) => log("warn", subsystem, event, details),
	error: (
		subsystem: DebugSubsystem,
		event: string,
		details?: Record<string, unknown>,
	) => log("error", subsystem, event, details),
	time(subsystem: DebugSubsystem, event: string): () => void {
		const start = Date.now();
		debug.log(subsystem, `${event}:start`);
		return () => {
			debug.log(subsystem, `${event}:end`, { elapsedMs: Date.now() - start });
		};
	},
};
