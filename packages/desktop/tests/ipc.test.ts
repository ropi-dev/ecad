import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSymbolFile } from "@ecad/core/components/editor/symbolFormat.ts";
import {
	appChannels,
	displayChannels,
	libraryChannels,
	mcpChannels,
	projectChannels,
	settingsChannels,
	telemetryChannels,
	updateChannels,
} from "#/bridge.ts";
import { ipcArguments, parseIpcArguments } from "#/main/ipc.ts";

const symbol = parseSymbolFile(
	JSON.stringify({
		format: "ecad-symbol",
		version: 1,
		units: "mm",
		id: "test-point",
		name: "Test point",
		description: "",
		prefix: "TP",
		value: "",
		shapes: [{ kind: "pin", name: "Signal", x: 0, y: 0 }],
	}),
);
const request = {
	path: "libraries",
	scope: "project",
	projectDirectory: "/projects/controller",
	id: symbol.id,
};

test("every invoke channel validates its arguments", () => {
	const channels = [
		...Object.values(libraryChannels),
		...Object.values(projectChannels),
		...Object.values(settingsChannels),
		displayChannels.getCalibration,
		appChannels.quit,
		...Object.values(updateChannels),
		...Object.values(mcpChannels),
		...Object.values(telemetryChannels),
	];
	assert.deepEqual(Object.keys(ipcArguments).sort(), [...channels].sort());
});

test("malformed renderer arguments are rejected before any handler runs", () => {
	const rejected: [string, unknown[]][] = [
		[libraryChannels.load, ["unexpected"]],
		[libraryChannels.loadConfiguration, [{}]],
		[libraryChannels.loadDirectory, []],
		[libraryChannels.loadDirectory, [42, "user"]],
		[libraryChannels.loadDirectory, ["", "user"]],
		[libraryChannels.loadDirectory, ["   ", "user"]],
		[libraryChannels.loadDirectory, ["parts\0", "user"]],
		[libraryChannels.loadDirectory, ["x".repeat(4097), "user"]],
		[libraryChannels.loadDirectory, ["parts", "system"]],
		[libraryChannels.loadDirectory, ["parts", "project", 7]],
		[libraryChannels.loadDirectory, ["parts", "project", "/project", "extra"]],
		[libraryChannels.inspectDirectorySymbol, [{ ...request, scope: "any" }]],
		[libraryChannels.inspectDirectorySymbol, [{ ...request, id: 1 }]],
		[libraryChannels.inspectDirectorySymbol, [{ ...request, extra: true }]],
		[libraryChannels.inspectDirectorySymbol, ["libraries"]],
		[libraryChannels.saveDirectorySymbol, [request, symbol]],
		[
			libraryChannels.saveDirectorySymbol,
			[request, symbol, { ...symbol, id: "../escape" }],
		],
		[libraryChannels.saveDirectorySymbol, [request, { id: symbol.id }, symbol]],
		[libraryChannels.saveConfiguration, []],
		[libraryChannels.saveConfiguration, [{ version: 2, symbolLibraries: [] }]],
		[libraryChannels.saveConfiguration, ['{"version":1,"symbolLibraries":[]}']],
		[
			libraryChannels.saveConfiguration,
			[
				{
					version: 1,
					symbolLibraries: [
						{
							id: "x",
							name: "X",
							enabled: true,
							source: { kind: "directory", path: "" },
						},
					],
				},
			],
		],
		[libraryChannels.save, [[symbol]]],
		[libraryChannels.save, [[{ ...symbol, id: "../outside" }], []]],
		[libraryChannels.save, ["symbols", []]],
		[libraryChannels.openLibraryDirectory, [{ name: "Parts" }]],
		[projectChannels.create, ["../Other"]],
		[projectChannels.create, [undefined]],
		[projectChannels.open, ["/somewhere/else"]],
		[projectChannels.save, ["/projects/controller"]],
		[
			projectChannels.save,
			["/projects/controller", { shapes: "none", symbols: [] }],
		],
		[projectChannels.save, ["", { shapes: [], symbols: [] }]],
		[projectChannels.saveProject, [null]],
		[
			projectChannels.importAssets,
			[
				"/projects/controller",
				[{ name: "board.zip", kind: "gerber", bytes: [1, 2] }],
			],
		],
		[
			projectChannels.importAssets,
			[
				"/projects/controller",
				[{ name: "../board.zip", kind: "gerber", bytes: new Uint8Array() }],
			],
		],
		[
			projectChannels.importAssets,
			[
				"/projects/controller",
				[{ name: "model.exe", kind: "binary", bytes: new Uint8Array() }],
			],
		],
		[projectChannels.readAsset, ["/projects/controller", "../secret"]],
		[projectChannels.readAsset, ["/projects/controller", "/etc/passwd"]],
		[
			projectChannels.canWriteFile,
			["/projects/controller", "assets\\..\\secret"],
		],
		[projectChannels.canWriteFile, ["/projects/controller"]],
		[displayChannels.getCalibration, [1]],
	];
	for (const [channel, args] of rejected)
		assert.throws(
			() => parseIpcArguments(channel as keyof typeof ipcArguments, args),
			new RegExp(channel.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")),
			`${channel} accepted ${JSON.stringify(args)}`,
		);
	assert.throws(
		() => parseIpcArguments("projects:delete" as keyof typeof ipcArguments, []),
		/projects:delete/,
	);
});
