import assert from "node:assert/strict";
import { test } from "node:test";
import {
	InvalidProjectFile,
	ProjectClosed,
	ProjectConflict,
} from "@ecad/core/projects/errors.ts";
import { decodeIpcError, encodeIpcError } from "#/ipc-errors.ts";
import { createDesktopProjectStorage } from "#/renderer/storage.ts";

/** What the renderer receives: Electron keeps only `String(error)`. */
function overIpc(channel: string, error: unknown) {
	return new Error(
		`Error invoking remote method '${channel}': ${String(encodeIpcError(error))}`,
	);
}

test("project errors keep their tag and fields across the IPC boundary", () => {
	const conflict = decodeIpcError(
		overIpc("projects:save", new ProjectConflict({ path: "board/board.ecaddraw" })),
	);
	assert.ok(conflict instanceof ProjectConflict);
	assert.equal(conflict._tag, "ProjectConflict");
	assert.equal(conflict.path, "board/board.ecaddraw");
	assert.match(conflict.message, /^The project changed on disk/);

	const invalid = decodeIpcError(
		overIpc(
			"projects:load",
			new InvalidProjectFile({
				path: ".ecadprj",
				reason: "The file is not valid TOML.",
				cause: new SyntaxError("Unexpected token"),
			}),
		),
	);
	assert.ok(invalid instanceof InvalidProjectFile);
	assert.equal(invalid.path, ".ecadprj");
	assert.equal(invalid.reason, "The file is not valid TOML.");
	assert.equal(invalid.cause, undefined);
});

test("other errors pass through IPC with Electron's prefix removed", () => {
	const plain = decodeIpcError(
		overIpc("symbol-library:load-directory", new Error("Symbol files must be regular files.")),
	);
	assert.ok(plain instanceof Error);
	assert.equal(plain.message, "Symbol files must be regular files.");
	const local = new Error("Unchanged");
	assert.equal(decodeIpcError(local), local);
	assert.equal(decodeIpcError("text"), "text");
	const malformed = decodeIpcError(
		new Error("Error invoking remote method 'projects:save': Error: ecad-project-error:{oops"),
	);
	assert.ok(malformed instanceof Error);
	assert.equal(malformed.message, "ecad-project-error:{oops");
});

test("the renderer project storage restores tags from bridge rejections", async () => {
	const reject = (error: unknown) => async () => {
		throw overIpc("projects:any", error);
	};
	const storage = createDesktopProjectStorage({
		mode: "desktop",
		load: async () => null,
		list: async () => [],
		create: async () => null,
		open: async () => null,
		save: reject(new ProjectConflict({ path: ".ecadprj" })),
		importAssets: reject(new ProjectClosed()),
		readAsset: async () => new Uint8Array([1]),
	});
	assert.equal(storage.mode, "desktop");
	assert.equal(storage.saveProject, undefined);
	assert.equal(await storage.load(), null);
	await assert.rejects(storage.save("/project", { shapes: [], symbols: [] }), ProjectConflict);
	await assert.rejects(storage.importAssets("/project", []), ProjectClosed);
	assert.deepEqual(await storage.readAsset("/project", "a"), new Uint8Array([1]));
});
