import { z } from "zod";

export const mcpClientIds = ["claude-code", "codex"] as const;
export const mcpClientIdSchema = z.enum(mcpClientIds);
export type McpClientId = z.infer<typeof mcpClientIdSchema>;

export interface McpClientStatus {
	id: McpClientId;
	name: string;
	configPath: string;
	state: "added" | "outdated" | "absent";
	error?: string;
}

export interface McpClientSetup {
	list(): Promise<McpClientStatus[]>;
	add(id: McpClientId): Promise<McpClientStatus>;
	remove(id: McpClientId): Promise<McpClientStatus>;
}

let setup: McpClientSetup | undefined;

export function setMcpClientSetup(next: McpClientSetup | undefined) {
	setup = next;
}

export const getMcpClientSetup = () => setup;
