import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { InvalidFile, WorkerError } from "#/formats/import-effects.ts";
import { importKiCadSchematic } from "#/formats/kicad/import.ts";
import {
	MAX_GERBER_FILE_BYTES,
	parseGerberFile,
} from "#/formats/parseGerberFile.ts";
import {
	MAX_KICAD_FILE_BYTES,
	parseKiCadFile,
} from "#/formats/parseKiCadFile.ts";
import { MAX_STEP_FILE_BYTES, parseStepFile } from "#/formats/parseStepFile.ts";
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
		message: "STEP files must be 256 MiB or smaller.",
	},
	{
		name: "top.gbr",
		limit: MAX_GERBER_FILE_BYTES,
		parse: (file: File) => parseGerberFile(file),
		message: "Gerber files must be 64 MiB or smaller.",
	},
	{
		name: "huge.kicad_sch",
		limit: MAX_KICAD_FILE_BYTES,
		parse: (file: File) => parseKiCadFile(file),
		message: "KiCad schematics must be 32 MiB or smaller.",
	},
];

for (const { name, limit, parse, message } of cases)
	test(`${name} over the byte limit is rejected before it is read`, async (t) => {
		const workers = countWorkers(t);
		const { file, reads } = oversized(name, limit + 1);
		await assert.rejects(
			parse(file),
			(error) => error instanceof InvalidFile && error.message === message,
		);
		assert.deepEqual(reads, []);
		assert.deepEqual(workers, []);
	});

test("import limits cover the KiCad fixture with a wide margin", () => {
	assert.ok(readFileSync(fixturePath).byteLength * 20 < MAX_KICAD_FILE_BYTES);
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

test("KiCad worker failures keep the converter's message and release the worker", async (t) => {
	const installed = installKiCadWorker();
	t.after(installed.restore);
	let expected = "";
	try {
		importKiCadSchematic("(broken");
	} catch (error) {
		expected = (error as Error).message;
	}
	assert.match(expected, /Incomplete KiCad/);
	await assert.rejects(
		parseKiCadFile(new File(["(broken"], "broken.kicad_sch")),
		(error) => error instanceof WorkerError && error.message === expected,
	);
	await assert.rejects(
		parseKiCadFile(new File(["(not_kicad)"], "other.kicad_sch")),
		(error) =>
			error instanceof WorkerError &&
			error.message === "Expected a modern .kicad_sch document.",
	);
	assert.deepEqual(
		installed.workers.map((worker) => worker.terminated),
		[1, 1],
	);
});

test("aborting a KiCad import terminates its pending worker", async (t) => {
	const previous = globalThis.Worker;
	const workers: { posted: unknown[]; terminated: number }[] = [];
	let started!: () => void;
	const posted = new Promise<void>((resolve) => {
		started = resolve;
	});
	globalThis.Worker = class {
		posted: unknown[] = [];
		terminated = 0;
		constructor() {
			workers.push(this);
		}
		postMessage(message: unknown) {
			this.posted.push(message);
			started();
		}
		terminate() {
			this.terminated++;
		}
	} as unknown as typeof Worker;
	t.after(() => {
		globalThis.Worker = previous;
	});
	const controller = new AbortController();
	const reason = new Error("superseded");
	const pending = parseKiCadFile(
		new File(["(kicad_sch)"], "board.kicad_sch"),
		controller.signal,
	);
	await posted;
	controller.abort(reason);
	await assert.rejects(pending, (error) => error === reason);
	assert.equal(workers.length, 1);
	assert.equal(workers[0].terminated, 1);
});
