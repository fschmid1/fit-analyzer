import type { ToolDefinition, ToolResult } from "@fit-analyzer/shared";
import { debug } from "../debug.js";

export type ToolHandlerContext = {
	userId: string;
	threadId?: string;
};

export type ToolHandler = (
	args: Record<string, unknown>,
	context: ToolHandlerContext,
) => Promise<ToolResult>;

export interface ToolEntry {
	definition: ToolDefinition;
	handler: ToolHandler;
}

const tools = new Map<string, ToolEntry>();

export function registerTool(
	definition: ToolDefinition,
	handler: ToolHandler,
): void {
	tools.set(definition.name, { definition, handler });
	debug.log("tool-registry", "registerTool", { name: definition.name });
}

export function getToolDefinitions(): ToolDefinition[] {
	return Array.from(tools.values()).map((t) => t.definition);
}

export function getTool(name: string): ToolEntry | undefined {
	return tools.get(name);
}

export async function executeTool(
	name: string,
	args: Record<string, unknown>,
	context: ToolHandlerContext,
): Promise<ToolResult> {
	debug.log("tool-registry", "executeTool start", {
		name,
		userId: context.userId,
		threadId: context.threadId,
		args,
	});
	const start = Date.now();
	const tool = tools.get(name);
	if (!tool) {
		debug.warn("tool-registry", "executeTool unknown tool", {
			name,
			userId: context.userId,
		});
		return {
			id: "",
			name,
			content: "",
			display: null,
			error: `Unknown tool: ${name}`,
		};
	}
	try {
		const result = await tool.handler(args, context);
		debug.log("tool-registry", "executeTool end", {
			name,
			userId: context.userId,
			elapsedMs: Date.now() - start,
			hasError: Boolean(result.error),
			contentBytes: result.content.length,
		});
		return result;
	} catch (error) {
		debug.error("tool-registry", "executeTool threw", {
			name,
			userId: context.userId,
			elapsedMs: Date.now() - start,
			error: error instanceof Error ? error.message : String(error),
		});
		return {
			id: "",
			name,
			content: "",
			display: null,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
