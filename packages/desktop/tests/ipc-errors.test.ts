import assert from "node:assert/strict";
import { test } from "node:test";
import {
	InvalidProjectFile,
	ProjectAssetTooLarge,
	ProjectConflict,
} from "@ecad/core/projects/errors.ts";
import { decodeIpcError, encodeIpcError } from "#/ipc-errors.ts";

function overIpc(channel: string, error: unknown) {
	return new Error(
		`Error invoking remote method '${channel}': ${String(encodeIpcError(error))}`,
	);
}

test("project errors keep their tag and fields across the IPC boundary", () => {
	const conflict = decodeIpcError(
		overIpc(
			"projects:save",
			new ProjectConflict({ path: "board/board.ecaddraw" }),
		),
	);
	assert.ok(conflict instanceof ProjectConflict);
	assert.equal(conflict._tag, "ProjectConflict");
	assert.equal(conflict.path, "board/board.ecaddraw");

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

	const tooLarge = decodeIpcError(
		overIpc(
			"projects:read-asset",
			new ProjectAssetTooLarge({
				assetName: "board.step",
				reason: "STEP files must be 256 MiB or smaller.",
			}),
		),
	);
	assert.ok(tooLarge instanceof ProjectAssetTooLarge);
	assert.equal(tooLarge.assetName, "board.step");
	assert.equal(tooLarge.reason, "STEP files must be 256 MiB or smaller.");
});
