import type { ToolDefinition, ToolResult } from "@fit-analyzer/shared";

export type ToolHandler = (
	args: Record<string, unknown>,
	userId: string,
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
	userId: string,
): Promise<ToolResult> {
	const tool = tools.get(name);
	if (!tool) {
		return {
			id: "",
			name,
			content: "",
			display: null,
			error: `Unknown tool: ${name}`,
		};
	}
	try {
		return await tool.handler(args, userId);
	} catch (error) {
		return {
			id: "",
			name,
			content: "",
			display: null,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
