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
	assert.equal(first.length, 49);
	assert.deepEqual(first, second);
	assert.equal(new Set(first.map(({ file }) => file.id)).size, first.length);
	assert.deepEqual(
		new Set(first.map(({ category }) => category)),
		new Set(symbolCategories),
	);
	for (const [index, symbol] of first.entries()) {
		assert.ok(
			symbol.file.shapes.length > 0 && symbol.file.shapes.length <= 256,
		);
		assert.equal(
			symbol.file.shapes.some((shape) => shape.kind === "pin"),
			symbol.category !== "Annotations",
		);
		assert.ok(
			!symbol.file.shapes.some((shape) => shape.kind === "wire"),
			`${symbol.file.id} must draw leads and bodies with lines`,
		);
		assert.notEqual(symbol.file.shapes, second[index].file.shapes);
		for (const [labelIndex, label] of symbol.texts.entries())
			assert.notEqual(label, second[index].texts[labelIndex]);
		const grid = 1.27;
		for (const shape of symbol.file.shapes) {
			if (shape.kind === "pin") {
				assert.ok(Math.abs(shape.x / grid - Math.round(shape.x / grid)) < 1e-8);
				assert.ok(Math.abs(shape.y / grid - Math.round(shape.y / grid)) < 1e-8);
			}
		}
	}
	first[0].file.shapes.length = 0;
	first[0].texts[0].x = 999;
	assert.deepEqual(generateDefaultSymbols(), second);
});

test("semiconductor and passive variants preserve terminal identity and polarity", () => {
	const files = new Map(
		generateDefaultSymbols().map(({ file }) => [file.id, file]),
	);
	const pins = (id: string) =>
		files.get(id)!.shapes.filter((shape) => shape.kind === "pin");
	for (const id of ["diode", "diode-schottky", "diode-zener", "led"]) {
		assert.deepEqual(pins(id), [
			{ kind: "pin", name: "K", x: -3.81, y: 0 },
			{ kind: "pin", name: "A", x: 3.81, y: 0 },
		]);
	}
	for (const id of ["transistor-npn", "transistor-pnp"]) {
		assert.deepEqual(pins(id), [
			{ kind: "pin", name: "B", x: -5.08, y: 0 },
			{ kind: "pin", name: "C", x: 2.54, y: 5.08 },
			{ kind: "pin", name: "E", x: 2.54, y: -5.08 },
		]);
	}
	for (const id of ["mosfet-n", "mosfet-p", "jfet-n", "jfet-p"]) {
		assert.deepEqual(
			pins(id).map(({ name }) => name),
			["G", "S", "D"],
		);
		const opposite = `${id.slice(0, -1)}${id.endsWith("n") ? "p" : "n"}`;
		assert.notDeepEqual(files.get(id)!.shapes, files.get(opposite)!.shapes);
	}
	assert.notDeepEqual(
		files.get("transistor-npn")!.shapes,
		files.get("transistor-pnp")!.shapes,
	);
	assert.deepEqual(
		pins("potentiometer").map(({ name }) => name),
		["1", "2", "3"],
	);
	assert.deepEqual(
		pins("capacitor-polarized").map(({ x, y }) => [x, y]),
		[
			[3.81, 0],
			[-3.81, 0],
		],
	);
	assert.equal(pins("transformer").length, 4);
	assert.equal(pins("connector-8").length, 8);
	assert.deepEqual(
		pins("op-amp").map(({ name }) => name),
		["+", "V-", "-", "4", "V+"],
	);
});

test("CLI writes one portable file per symbol with attribution and refuses overwrites", async () => {
	const output = await mkdtemp(join(tmpdir(), "ecad-default-symbols-"));
	const cli = new URL("../scripts/generate.ts", import.meta.url);
	try {
		const run = () =>
			spawnSync(process.execPath, ["--import", "tsx", cli.pathname, output], {
				encoding: "utf8",
			});
		const result = run();
		assert.equal(result.status, 0, result.stderr);
		const files = await readdir(output);
		assert.equal(files.filter((file) => file.endsWith(".ecadsym")).length, 49);
		for (const { file } of generateDefaultSymbols()) {
			assert.deepEqual(
				JSON.parse(await readFile(join(output, `${file.id}.ecadsym`), "utf8")),
				file,
			);
		}
		for (const filename of ["LICENSE.md", "NOTICE.md", "CC-BY-SA-4.0.txt"]) {
			assert.ok((await readFile(join(output, filename), "utf8")).length > 100);
		}
		assert.notEqual(run().status, 0);
		assert.deepEqual(
			JSON.parse(await readFile(join(output, "resistor.ecadsym"), "utf8")),
			generateDefaultSymbols()[0].file,
		);
	} finally {
		await rm(output, { recursive: true, force: true });
	}
});

test("Raspberry Pi chips preserve package numbers, GPIOs, and exposed ground pads", () => {
	for (const [id, count, gpioCount, expected] of [
		[
			"rp2040",
			57,
			30,
			{
				1: "IOVDD",
				19: "TESTEN",
				24: "SWCLK",
				25: "SWDIO",
				26: "RUN",
				43: "ADC_AVDD",
				45: "VREG_VOUT",
				46: "USB_DM",
				47: "USB_DP",
				56: "QSPI_SS_N",
			},
		],
		[
			"rp2350a",
			61,
			30,
			{
				6: "DVDD",
				24: "SWCLK",
				25: "SWDIO",
				26: "RUN",
				44: "ADC_AVDD",
				47: "VREG_PGND",
				48: "VREG_LX",
				50: "VREG_FB",
				51: "USB_DM",
				52: "USB_DP",
				60: "QSPI_SS_N",
			},
		],
		[
			"rp2350b",
			81,
			48,
			{
				1: "GPIO4",
				33: "SWCLK",
				34: "SWDIO",
				35: "RUN",
				58: "GPIO47/ADC7",
				59: "ADC_AVDD",
				62: "VREG_PGND",
				63: "VREG_LX",
				65: "VREG_FB",
				66: "USB_DM",
				67: "USB_DP",
				75: "QSPI_SS_N",
				77: "GPIO0",
			},
		],
	] as const) {
		const { file, category } = generateDefaultSymbols().find(
			({ file }) => file.id === id,
		)!;
		assert.equal(category, "Microcontrollers");
		assert.equal(file.prefix, "U");
		const pins = file.shapes.filter((shape) => shape.kind === "pin");
		assert.equal(pins.length, count);
		assert.equal(file.shapes.length, count + 1);
		assert.ok(pins.every((pin) => pin.length === 2.54));
		assert.equal(new Set(pins.map((pin) => `${pin.x},${pin.y}`)).size, count);
		for (const side of [-1, 1]) {
			const ys = pins
				.filter((pin) => Math.sign(pin.x) === side)
				.map((pin) => pin.y)
				.sort((a, b) => a - b);
			assert.ok(
				ys.slice(1).every((y, index) => Math.abs(y - ys[index] - 2.54) < 1e-8),
			);
		}
		assert.equal(
			file.shapes.filter((shape) => shape.kind === "text").length,
			0,
		);
		const names = new Map(pins.map((pin) => [pin.number, pin.name]));
		assert.deepEqual(
			[...names.keys()].map(Number).sort((a, b) => a - b),
			Array.from({ length: count }, (_, i) => i + 1),
		);
		for (const [number, name] of Object.entries(expected))
			assert.equal(names.get(number), name, `${id} pin ${number}`);
		assert.equal(names.get(String(count)), "GND");
		const gpios = pins
			.filter((pin) => pin.name.startsWith("GPIO"))
			.map((pin) => Number(pin.name.match(/^GPIO(\d+)/)![1]))
			.sort((a, b) => a - b);
		assert.deepEqual(
			gpios,
			Array.from({ length: gpioCount }, (_, i) => i),
		);
	}
});
