import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runEffect } from "@ecad/drawing-core/lib/effect.ts";
import { Effect } from "effect";
import { expandGerberFile } from "#/formats/expandGerberFile.ts";
import { InvalidFile } from "#/formats/import-effects.ts";
import {
	MAX_GERBER_ARCHIVE_BYTES,
	MAX_GERBER_FILE_BYTES,
	MAX_KICAD_FILE_BYTES,
	MAX_STEP_FILE_BYTES,
} from "#/formats/import-limits.ts";
import { importFilesEffect } from "#/formats/importFiles.ts";
import { importKiCadSchematic } from "#/formats/kicad/import.ts";
import { parseGerberFile } from "#/formats/parseGerberFile.ts";
import { parseKiCadFile } from "#/formats/parseKiCadFile.ts";
import { parseStepFile, parseStepFileEffect } from "#/formats/parseStepFile.ts";
import type { StepModel } from "#/formats/step/types/StepModel.ts";
import { installKiCadWorker } from "./helpers/kicad-worker.ts";

const fixturePath = new URL(
	"./fixtures/kicad/RPI-RP2350A-MINIMAL_R4-S1.kicad_sch",
	import.meta.url,
);

/** Reports `size` without allocating it, and fails the test if it is read. */
function oversized(name: string, size: number) {
	const file = new File(["x"], name);
	const reads: string[] = [];
	Object.defineProperty(file, "size", { value: size });
	for (const method of ["text", "arrayBuffer", "bytes", "stream"] as const)
		Object.defineProperty(file, method, {
			value: () => {
				reads.push(method);
				throw new Error(`${method}() read an oversized file.`);
			},
		});
	return { file, reads };
}

function countWorkers(t: test.TestContext) {
	const previous = globalThis.Worker;
	const created: unknown[] = [];
	globalThis.Worker = class {
		constructor(url: unknown) {
			created.push(url);
			throw new Error("An oversized file reached a worker.");
		}
	} as unknown as typeof Worker;
	t.after(() => {
		globalThis.Worker = previous;
	});
	return created;
}

const cases = [
	{
		name: "board.step",
		limit: MAX_STEP_FILE_BYTES,
		parse: (file: File) => parseStepFile(file),
	},
	{
		name: "top.gbr",
		limit: MAX_GERBER_FILE_BYTES,
		parse: (file: File) => parseGerberFile(file),
	},
	{
		name: "board.zip",
		limit: MAX_GERBER_ARCHIVE_BYTES,
		parse: (file: File) => expandGerberFile(file, new AbortController().signal),
	},
	{
		name: "huge.kicad_sch",
		limit: MAX_KICAD_FILE_BYTES,
		parse: (file: File) => parseKiCadFile(file),
	},
];

for (const { name, limit, parse } of cases)
	test(`${name} over the byte limit is rejected before it is read`, async (t) => {
		const workers = countWorkers(t);
		const { file, reads } = oversized(name, limit + 1);
		await assert.rejects(parse(file), InvalidFile);
		assert.deepEqual(reads, []);
		assert.deepEqual(workers, []);
	});

test("a mixed batch accepts only the files that imported, without reading the oversized one", async (t) => {
	const model: StepModel = {
		name: "part.step",
		meshes: [
			{
				id: "part",
				name: "part",
				attributes: { position: { array: [0, 0, 0, 1, 0, 0, 0, 1, 0] } },
				index: { array: [0, 1, 2] },
			},
		],
	};
	const previous = globalThis.Worker;
	let workers = 0;
	globalThis.Worker = class {
		onmessage: Worker["onmessage"] = null;
		constructor() {
			workers++;
		}
		postMessage() {
			queueMicrotask(() =>
				this.onmessage?.call(
					this as unknown as Worker,
					new MessageEvent("message", { data: { result: model } }),
				),
			);
		}
		terminate() {}
	} as unknown as typeof Worker;
	t.after(() => {
		globalThis.Worker = previous;
	});
	const valid = new File(["STEP"], "part.step");
	const { file: huge, reads } = oversized("huge.step", MAX_STEP_FILE_BYTES + 1);
	const result = await runEffect(
		importFilesEffect([huge, valid], (file) =>
			Effect.map(parseStepFileEffect(file), (value) => ({ value })),
		),
	);
	assert.deepEqual(result.accepted, [valid]);
	assert.equal(result.values.length, 1);
	assert.equal(result.messages.length, 1);
	assert.match(result.messages[0], /^huge\.step: /);
	assert.deepEqual(reads, []);
	assert.equal(workers, 1);
	for (const value of result.values) value.dispose();
});

test("the KiCad worker imports the RP2350A fixture exactly as the inline converter does", async (t) => {
	const installed = installKiCadWorker();
	t.after(installed.restore);
	const source = readFileSync(fixturePath, "utf8");
	const file = new File([source], "RPI-RP2350A-MINIMAL_R4-S1.kicad_sch");
	const imported = await parseKiCadFile(file);
	assert.deepEqual(imported, importKiCadSchematic(source));
	assert.equal(imported.shapes.filter((s) => s.kind === "symbol").length, 87);
	assert.equal(installed.workers.length, 1);
	assert.match(installed.workers[0].url, /kicad\/parse\.worker\.ts$/);
	assert.deepEqual(installed.workers[0].posted, [{ file }]);
	assert.equal(installed.workers[0].terminated, 1);
});
