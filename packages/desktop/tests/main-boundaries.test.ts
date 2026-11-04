import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { transform } from "esbuild";
import { libraryChannels } from "#/bridge.ts";
import * as bridge from "#/bridge.ts";
import * as errors from "#/ipc-errors.ts";
import * as ipc from "#/main/ipc.ts";

async function boot() {
	const handlers = new Map<
		string,
		(event: unknown, ...args: unknown[]) => Promise<unknown>
	>();
	let protocolHandler!: (request: { url: string }) => Promise<Response>;
	let ready!: Promise<void>;
	let loads = 0;
	const fetched: string[] = [];
	const frame = { url: "ecad://app/index.html" };
	const contents = {
		mainFrame: frame,
		setWindowOpenHandler() {},
		on() {},
		session: { setPermissionRequestHandler() {} },
	};
	class Window {
		webContents = contents;
		on() {}
		loadURL() {}
		static getAllWindows() {
			return [this];
		}
	}
	class Library {
		async load() {
			loads++;
			return [];
		}
	}
	const electron = {
		app: {
			isPackaged: true,
			getPath: () => "/tmp/ecad-test-user",
			on() {},
			whenReady: () => ({
				then(callback: () => void) {
					ready = Promise.resolve().then(callback);
				},
			}),
		},
		BrowserWindow: Window,
		dialog: {},
		screen: { on() {} },
		ipcMain: {
			handle(channel: string, handler: typeof protocolHandler) {
				handlers.set(channel, handler as never);
			},
		},
		protocol: {
			registerSchemesAsPrivileged() {},
			handle(_scheme: string, handler: typeof protocolHandler) {
				protocolHandler = handler;
			},
		},
		net: {
			async fetch(url: string) {
				fetched.push(url);
				return new Response("asset", {
					headers: { "Content-Type": "text/javascript" },
				});
			},
		},
	};
	const modules: Record<string, unknown> = {
		electron,
		"#/bridge.ts": bridge,
		"#/ipc-errors.ts": errors,
		"#/main/ipc.ts": ipc,
		"#/main/display-calibration.ts": {},
		"#/main/library-approvals.ts": { ExternalLibraryApprovals: class {} },
		"#/main/projects.ts": { DesktopProjects: class {} },
		"#/main/symbol-library.ts": { DesktopSymbolLibrary: Library },
	};
	const source = await readFile(
		new URL("../src/main/main.ts", import.meta.url),
		"utf8",
	);
	const { code } = await transform(source, { loader: "ts", format: "cjs" });
	const require = createRequire(import.meta.url);
	runInNewContext(code, {
		require: (id: string) => (id in modules ? modules[id] : require(id)),
		__dirname: "/tmp/ecad-test-main",
		process: { argv: [], env: {} },
		URL,
		Response,
		Headers,
		setTimeout,
		clearTimeout,
	});
	await ready;
	return {
		handlers,
		protocolHandler,
		contents,
		frame,
		fetched,
		loads: () => loads,
	};
}

test("IPC accepts only the editor's main frame and validates arguments before dispatch", async () => {
	const app = await boot();
	const invoke = app.handlers.get(libraryChannels.load)!;
	const valid = { sender: app.contents, senderFrame: app.frame };
	for (const event of [
		{ ...valid, sender: {} },
		{ ...valid, senderFrame: { ...app.frame } },
		{ ...valid, senderFrame: null },
	])
		await assert.rejects(invoke(event), /Filesystem access is limited/);
	app.frame.url = "ecad://app/other.html";
	await assert.rejects(invoke(valid), /Filesystem access is limited/);
	app.frame.url = "ecad://app/index.html";
	await assert.rejects(invoke(valid, "unexpected"), /Invalid .* request/);
	assert.equal(app.loads(), 0);
	assert.deepEqual(await invoke(valid), []);
	assert.equal(app.loads(), 1);
});

test("the packaged protocol confines requests and applies separate worker CSP", async () => {
	const app = await boot();
	for (const [url, status] of [
		["ecad://other/index.html", 404],
		["ecad://app/%2e%2e%2fsecret", 403],
	] as const)
		assert.equal((await app.protocolHandler({ url })).status, status);
	assert.equal(app.fetched.length, 0);
	for (const name of ["index.html", "assets/parser.worker-test.js"]) {
		const response = await app.protocolHandler({ url: `ecad://app/${name}` });
		assert.equal(response.status, 200);
		assert.equal(response.headers.get("Content-Type"), "text/javascript");
		assert.match(
			response.headers.get("Content-Security-Policy")!,
			name.includes(".worker-")
				? /script-src 'self' 'unsafe-eval'/
				: /script-src 'self' 'wasm-unsafe-eval'/,
		);
		assert.equal(
			app.fetched.at(-1),
			pathToFileURL(resolve("/tmp/ecad-test-main/renderer", name)).href,
		);
	}
});
