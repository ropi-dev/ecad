import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { generateDefaultSymbols, symbolCategories } from "../src/index.ts";

test("default generation is deterministic and returns independent geometry and labels", () => {
	const first = generateDefaultSymbols();
	const second = generateDefaultSymbols();
	assert.equal(first.length, 45);
	assert.deepEqual(first, second);
	assert.equal(new Set(first.map(({ file }) => file.id)).size, first.length);
	assert.deepEqual(new Set(first.map(({ category }) => category)), new Set(symbolCategories));
	for (const [index, symbol] of first.entries()) {
		assert.ok(symbol.file.shapes.length > 0 && symbol.file.shapes.length <= 256);
		assert.ok(symbol.file.shapes.some((shape) => shape.kind === "pin"));
		assert.ok(!symbol.file.shapes.some((shape) => shape.kind === "wire"), `${symbol.file.id} must draw leads and bodies with lines`);
		assert.notEqual(symbol.file.shapes, second[index].file.shapes);
		assert.notEqual(symbol.texts[0], second[index].texts[0]);
		for (const shape of symbol.file.shapes) {
			if (shape.kind === "pin") {
				assert.equal(shape.x, Math.round(shape.x));
				assert.equal(shape.y, Math.round(shape.y));
			}
		}
	}
	first[0].file.shapes.length = 0;
	first[0].texts[0].x = 999;
	assert.deepEqual(generateDefaultSymbols(), second);
});

test("semiconductor and passive variants preserve terminal identity and polarity", () => {
	const files = new Map(generateDefaultSymbols().map(({ file }) => [file.id, file]));
	const pins = (id: string) => files.get(id)!.shapes.filter((shape) => shape.kind === "pin");
	for (const id of ["diode", "diode-schottky", "diode-zener", "led"]) {
		assert.deepEqual(pins(id), [
			{ kind: "pin", name: "K", x: -3, y: 0 },
			{ kind: "pin", name: "A", x: 3, y: 0 },
		]);
	}
	for (const id of ["transistor-npn", "transistor-pnp"]) {
		assert.deepEqual(pins(id), [
			{ kind: "pin", name: "B", x: -4, y: 0 },
			{ kind: "pin", name: "C", x: 2, y: 4 },
			{ kind: "pin", name: "E", x: 2, y: -4 },
		]);
	}
	for (const id of ["mosfet-n", "mosfet-p", "jfet-n", "jfet-p"]) {
		assert.deepEqual(pins(id).map(({ name }) => name), ["G", "S", "D"]);
		const opposite = `${id.slice(0, -1)}${id.endsWith("n") ? "p" : "n"}`;
		assert.notDeepEqual(files.get(id)!.shapes, files.get(opposite)!.shapes);
	}
	assert.notDeepEqual(files.get("transistor-npn")!.shapes, files.get("transistor-pnp")!.shapes);
	assert.deepEqual(pins("potentiometer").map(({ name }) => name), ["1", "2", "3"]);
	assert.deepEqual(pins("capacitor-polarized").map(({ x, y }) => [x, y]), [[3, 0], [-3, 0]]);
	assert.equal(pins("transformer").length, 4);
	assert.equal(pins("connector-8").length, 8);
	assert.deepEqual(pins("op-amp").map(({ name }) => name), ["+", "V-", "-", "4", "V+"]);
});

test("CLI writes one portable file per symbol with attribution and refuses overwrites", async () => {
	const output = await mkdtemp(join(tmpdir(), "ecad-default-symbols-"));
	const cli = new URL("../scripts/generate.ts", import.meta.url);
	try {
		const run = () => spawnSync(process.execPath, ["--import", "tsx", cli.pathname, output], { encoding: "utf8" });
		const result = run();
		assert.equal(result.status, 0, result.stderr);
		const files = await readdir(output);
		assert.equal(files.filter((file) => file.endsWith(".ecadsym")).length, 45);
		for (const { file } of generateDefaultSymbols()) {
			assert.deepEqual(JSON.parse(await readFile(join(output, `${file.id}.ecadsym`), "utf8")), file);
		}
		for (const filename of ["LICENSE.md", "NOTICE.md", "CC-BY-SA-4.0.txt"]) {
			assert.ok((await readFile(join(output, filename), "utf8")).length > 100);
		}
		assert.notEqual(run().status, 0);
		assert.deepEqual(JSON.parse(await readFile(join(output, "resistor.ecadsym"), "utf8")), generateDefaultSymbols()[0].file);
	} finally {
		await rm(output, { recursive: true, force: true });
	}
});
