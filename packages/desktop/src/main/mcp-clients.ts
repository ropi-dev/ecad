import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type {
	McpClientId,
	McpClientStatus,
} from "@ecad/core/settings/mcp-clients.ts";
import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import { parse } from "smol-toml";

export interface McpLaunch {
	command: string;
	args: string[];
	env: Record<string, string>;
}

const serverName = "ecad";

export function bundledMcpLaunch({
	packaged,
	execPath,
	appPath,
	tsxLoader,
}: {
	packaged: boolean;
	execPath: string;
	appPath: string;
	tsxLoader: () => string;
}): McpLaunch & { script: string } {
	const env = { ELECTRON_RUN_AS_NODE: "1" };
	if (packaged) {
		const script = join(dirname(execPath), "cli", "ecad.js");
		return { command: execPath, args: [script, "mcp"], env, script };
	}
	const script = join(appPath, "..", "cli", "src", "main.ts");
	return {
		command: execPath,
		args: ["--import", tsxLoader(), script, "mcp"],
		env,
		script,
	};
}

type Config = Record<string, unknown>;

const isRecord = (value: unknown): value is Config =>
	!!value && typeof value === "object" && !Array.isArray(value);

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (isRecord(value) && !(value instanceof Date))
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
			.join(",")}}`;
	return JSON.stringify(value) ?? "null";
}

function launches(entry: unknown, launch: McpLaunch) {
	if (!isRecord(entry)) return false;
	return (
		canonical({ command: entry.command, args: entry.args, env: entry.env }) ===
		canonical(launch)
	);
}

async function readOptional(path: string) {
	try {
		return await readFile(path, "utf8");
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw cause;
	}
}

async function replaceFile(
	path: string,
	previous: string | undefined,
	content: string,
) {
	await mkdir(dirname(path), { recursive: true });
	const mode = previous === undefined ? 0o600 : (await stat(path)).mode & 0o777;
	const temporary = join(
		dirname(path),
		`.${basename(path)}.ecad-${randomUUID()}.tmp`,
	);
	try {
		await writeFile(temporary, content, { mode, flag: "wx" });
		if ((await readOptional(path)) !== previous)
			throw new Error(`${path} changed while ECAD was editing it. Try again.`);
		await rename(temporary, path);
	} finally {
		await rm(temporary, { force: true });
	}
}

interface ClientFormat {
	name: string;
	path(env: NodeJS.ProcessEnv, home: string): string;
	entry(text: string | undefined): unknown;
	edit(text: string | undefined, launch: McpLaunch | undefined): string;
}

function parseJsonConfig(text: string | undefined, path: string): Config {
	if (text === undefined || !text.trim()) return {};
	const config: unknown = JSON.parse(text);
	if (!isRecord(config)) throw new Error(`${path} is not a JSON object.`);
	return config;
}

const claudeCode: ClientFormat = {
	name: "Claude Code",
	path: (env, home) => join(env.CLAUDE_CONFIG_DIR || home, ".claude.json"),
	entry(text) {
		const servers = parseJsonConfig(text, "The Claude Code config").mcpServers;
		return isRecord(servers) ? servers[serverName] : undefined;
	},
	edit(text, launch) {
		const config = parseJsonConfig(text, "The Claude Code config");
		const servers = isRecord(config.mcpServers) ? { ...config.mcpServers } : {};
		if (!launch && !(serverName in servers)) return text ?? "";
		if (launch) servers[serverName] = { type: "stdio", ...launch };
		else delete servers[serverName];
		return `${JSON.stringify({ ...config, mcpServers: servers }, null, 2)}\n`;
	},
};

const ecadTable = /^\s*\[\s*mcp_servers\s*\.\s*["']?ecad["']?\s*(\.[^\]]*)?\]/;
const tableHeader = /^\s*\[/;

function withoutEcad(config: Config) {
	const copy: Config = JSON.parse(JSON.stringify(config));
	if (isRecord(copy.mcp_servers)) {
		delete copy.mcp_servers[serverName];
		if (!Object.keys(copy.mcp_servers).length) delete copy.mcp_servers;
	}
	return canonical(copy);
}

const tomlString = (value: string) => JSON.stringify(value);

const codex: ClientFormat = {
	name: "Codex",
	path: (env, home) =>
		join(env.CODEX_HOME || join(home, ".codex"), "config.toml"),
	entry(text) {
		const servers = parse(text ?? "").mcp_servers;
		return isRecord(servers) ? servers[serverName] : undefined;
	},
	edit(text, launch) {
		const before = parse(text ?? "");
		const kept: string[] = [];
		let skipping = false;
		for (const line of (text ?? "").split("\n")) {
			if (tableHeader.test(line)) skipping = ecadTable.test(line);
			if (!skipping) kept.push(line);
		}
		let next = kept
			.join("\n")
			.replace(/\n{3,}/g, "\n\n")
			.trimEnd();
		if (launch) {
			const table = [
				`[mcp_servers.${serverName}]`,
				`command = ${tomlString(launch.command)}`,
				`args = [${launch.args.map(tomlString).join(", ")}]`,
				`env = { ${Object.entries(launch.env)
					.map(([key, value]) => `${key} = ${tomlString(value)}`)
					.join(", ")} }`,
			].join("\n");
			next = next ? `${next}\n\n${table}` : table;
		}
		next = next ? `${next}\n` : "";
		let after: Config;
		try {
			after = parse(next);
		} catch {
			after = {};
		}
		const entry = isRecord(after.mcp_servers)
			? after.mcp_servers[serverName]
			: undefined;
		if (
			withoutEcad(before) !== withoutEcad(after) ||
			(launch ? !launches(entry, launch) : entry !== undefined)
		)
			throw new Error(
				"ECAD could not edit the Codex config without changing other settings. Edit the [mcp_servers.ecad] table by hand.",
			);
		return next;
	},
};

const formats: Record<McpClientId, ClientFormat> = {
	"claude-code": claudeCode,
	codex,
};

export interface McpClientsOptions {
	launch: () => Promise<McpLaunch>;
	env?: NodeJS.ProcessEnv;
	home?: string;
}

export function createMcpClients({
	launch,
	env = process.env,
	home = homedir(),
}: McpClientsOptions) {
	async function status(id: McpClientId): Promise<McpClientStatus> {
		const format = formats[id];
		const configPath = format.path(env, home);
		const base = { id, name: format.name, configPath };
		try {
			const entry = format.entry(await readOptional(configPath));
			if (entry === undefined) return { ...base, state: "absent" };
			return {
				...base,
				state: launches(entry, await launch()) ? "added" : "outdated",
			};
		} catch (cause) {
			return {
				...base,
				state: "absent",
				error: errorMessage(cause, `Unable to read ${configPath}.`),
			};
		}
	}

	async function change(id: McpClientId, add: boolean) {
		const format = formats[id];
		const path = format.path(env, home);
		const next = add ? await launch() : undefined;
		const text = await readOptional(path);
		if (!add && text === undefined) return status(id);
		const edited = format.edit(text, next);
		if (edited !== text) await replaceFile(path, text, edited);
		return status(id);
	}

	return {
		list: () =>
			Promise.all(Object.keys(formats).map((id) => status(id as McpClientId))),
		add: (id: McpClientId) => change(id, true),
		remove: (id: McpClientId) => change(id, false),
	};
}
