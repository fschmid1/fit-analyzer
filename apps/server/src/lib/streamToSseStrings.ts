import type { StreamChunk } from "@tanstack/ai";

export function toServerSentEventsStringStream(
	stream: AsyncIterable<StreamChunk>,
): ReadableStream<string> {
	return new ReadableStream({
		async start(controller) {
			try {
				for await (const chunk of stream) {
					controller.enqueue(`data: ${JSON.stringify(chunk)}\n\n`);
				}
				controller.enqueue("data: [DONE]\n\n");
				controller.close();
			} catch (error) {
				controller.enqueue(
					`data: ${JSON.stringify({
						type: "RUN_ERROR",
						timestamp: Date.now(),
						error: {
							message:
								error instanceof Error
									? error.message
									: "Unknown error occurred",
						},
					})}\n\n`,
				);
				controller.close();
			}
		},
	});
}
