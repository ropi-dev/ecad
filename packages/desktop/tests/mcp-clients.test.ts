import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { parse } from "smol-toml";
import { createMcpClients, type McpLaunch } from "#/main/mcp-clients.ts";

const toml = (text: string) => JSON.parse(JSON.stringify(parse(text)));

async function setup(context: TestContext) {
	const home = await mkdtemp(join(tmpdir(), "ecad-mcp-clients-"));
	context.after(() => rm(home, { recursive: true, force: true }));
	let launch: McpLaunch = {
		command: "/usr/lib/ecad/ecad-desktop",
		args: ["/usr/lib/ecad/cli/ecad.js", "mcp"],
		env: { ELECTRON_RUN_AS_NODE: "1" },
	};
	const clients = createMcpClients({
		launch: async () => launch,
		env: {},
		home,
	});
	return {
		home,
		clients,
		get launch() {
			return launch;
		},
		move(command: string) {
			launch = { ...launch, command };
		},
	};
}

test("Claude Code gets the ecad server without losing the rest of its config", async (context) => {
	const fixture = await setup(context);
	const path = join(fixture.home, ".claude.json");
	const other = { type: "stdio", command: "other-server", args: [] };
	await writeFile(
		path,
		JSON.stringify({ theme: "dark", mcpServers: { other } }),
	);
	const read = async () => JSON.parse(await readFile(path, "utf8"));

	assert.equal((await fixture.clients.list())[0].state, "absent");
	assert.equal((await fixture.clients.add("claude-code")).state, "added");
	assert.deepEqual(await read(), {
		theme: "dark",
		mcpServers: { other, ecad: { type: "stdio", ...fixture.launch } },
	});

	fixture.move("/opt/ecad/ecad-desktop");
	assert.equal((await fixture.clients.list())[0].state, "outdated");
	await fixture.clients.add("claude-code");
	assert.equal(
		(await read()).mcpServers.ecad.command,
		"/opt/ecad/ecad-desktop",
	);

	assert.equal((await fixture.clients.remove("claude-code")).state, "absent");
	assert.deepEqual(await read(), { theme: "dark", mcpServers: { other } });
});

test("Codex gets the ecad table without losing comments or other settings", async (context) => {
	const fixture = await setup(context);
	const path = join(fixture.home, ".codex", "config.toml");
	await mkdir(join(fixture.home, ".codex"));
	const original = `# My Codex settings
model = "o4"

[mcp_servers.ecad]
command = "/old/ecad"
args = ["mcp"]

[mcp_servers.ecad.env]
OLD = "1"

[mcp_servers.other]
command = "other-server"
`;
	await writeFile(path, original);

	assert.equal((await fixture.clients.list())[1].state, "outdated");
	assert.equal((await fixture.clients.add("codex")).state, "added");
	const text = await readFile(path, "utf8");
	assert.match(text, /^# My Codex settings$/m);
	assert.deepEqual(toml(text), {
		model: "o4",
		mcp_servers: {
			other: { command: "other-server" },
			ecad: fixture.launch,
		},
	});

	assert.equal((await fixture.clients.remove("codex")).state, "absent");
	assert.deepEqual(toml(await readFile(path, "utf8")), {
		model: "o4",
		mcp_servers: { other: { command: "other-server" } },
	});

	const inline = `[mcp_servers]\necad = { command = "/old/ecad" }\n`;
	await writeFile(path, inline);
	await assert.rejects(fixture.clients.add("codex"), /by hand/);
	assert.equal(await readFile(path, "utf8"), inline);
});
