import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pinElectricalType } from "@ecad/drawing-core/drawing/pin-types.ts";
import { required } from "../../../tests/helpers/required.ts";
import { generateDefaultSymbols, symbolCategories } from "../src/index.ts";

test("default generation is deterministic and returns independent geometry and labels", () => {
	const first = generateDefaultSymbols();
	const second = generateDefaultSymbols();
	assert.equal(first.length, 61);
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
		required(files.get(id)).shapes.filter((shape) => shape.kind === "pin");
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
		assert.notDeepEqual(
			required(files.get(id)).shapes,
			required(files.get(opposite)).shapes,
		);
	}
	assert.notDeepEqual(
		required(files.get("transistor-npn")).shapes,
		required(files.get("transistor-pnp")).shapes,
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
	// The drawn plus mark sits beside pin 1, the top terminal.
	assert.deepEqual(
		pins("buzzer").map(({ name, y }) => [name, Math.sign(y)]),
		[
			["+", 1],
			["-", -1],
		],
	);
	assert.equal(pins("transformer").length, 4);
	assert.equal(pins("connector-8").length, 8);
	assert.deepEqual(
		pins("op-amp").map((pin) => [pin.name, pinElectricalType(pin)]),
		[
			["+", "input"],
			["V-", "power-in"],
			["-", "input"],
			["OUT", "output"],
			["V+", "power-in"],
		],
	);
});

test("every built-in pin has an electrical type that fits its role", () => {
	const types = (id: string) =>
		new Map(
			required(
				generateDefaultSymbols().find(({ file }) => file.id === id),
			).file.shapes.flatMap((shape) =>
				shape.kind === "pin" ? [[shape.name, pinElectricalType(shape)]] : [],
			),
		);
	for (const { file, category } of generateDefaultSymbols()) {
		const pins = file.shapes
			.filter((shape) => shape.kind === "pin")
			.map((pin) => ({ ...pin, electricalType: pinElectricalType(pin) }));
		for (const pin of pins) {
			// Supply and ground pins take power; only regulators supply it.
			if (/^(\w*VDD\w*|VBAT|VREG_VIN|\w*VSS\w*|GND|VREG_PGND)$/.test(pin.name))
				assert.equal(pin.electricalType, "power-in", `${file.id} ${pin.name}`);
			if (/^(GPIO\d+|P\d\.\d\d)/.test(pin.name))
				assert.equal(
					pin.electricalType,
					"bidirectional",
					`${file.id} ${pin.name}`,
				);
		}
		if (file.netSymbol)
			assert.deepEqual(
				pins.map(({ electricalType }) => electricalType),
				["power-in"],
			);
		else if (
			["Passives", "Diodes", "Transistors", "Switches", "Connectors"].includes(
				category,
			)
		)
			assert.ok(
				pins.every(({ electricalType }) => electricalType === "passive"),
				file.id,
			);
	}
	assert.equal(types("rp2040").get("VREG_VOUT"), "power-out");
	assert.equal(types("rp2350a").get("VREG_LX"), "power-out");
	assert.equal(types("nrf54l15-qfaa").get("DECD"), "power-out");
	assert.equal(types("nrf54l15-qfaa").get("nRESET"), "input");
	assert.equal(types("npm2100-qeaa").get("VOUT"), "power-out");
	assert.equal(types("npm2100-qeaa").get("PG/RESET"), "open-collector");
	assert.equal(types("battery").get("+"), "passive");
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
		assert.equal(files.filter((file) => file.endsWith(".ecadsym")).length, 61);
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
		const { file, category } = required(
			generateDefaultSymbols().find(({ file }) => file.id === id),
		);
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
			.map((pin) => Number(required(pin.name.match(/^GPIO(\d+)/))[1]))
			.sort((a, b) => a - b);
		assert.deepEqual(
			gpios,
			Array.from({ length: gpioCount }, (_, i) => i),
		);
	}
});

test("Nordic chips have one symbol per package with that package's pin numbers", () => {
	const symbols = generateDefaultSymbols();
	const qfn = (count: number) =>
		Array.from({ length: count }, (_, i) => String(i + 1));
	const grid = (rows: string, columns: number, missing: string[] = []) =>
		[...rows]
			.flatMap((row) =>
				Array.from({ length: columns }, (_, i) => `${row}${i + 1}`),
			)
			.filter((ball) => !missing.includes(ball));
	const packages = {
		QDAA: {
			numbers: qfn(41),
			gpios: 24,
			expected: {
				1: "P1.00/XL1",
				8: "P1.08/EXTREF",
				9: "VDD",
				20: "P0.00",
				22: "SWDIO",
				23: "SWDCLK",
				24: "P0.04",
				25: "nRESET",
				26: "ANT",
				27: "VSS_PA",
				29: "XC1",
				32: "P1.11/AIN4",
				37: "VSS",
				39: "DCC",
				41: "VSS",
			},
		},
		QFAA: {
			numbers: qfn(49),
			gpios: 31,
			expected: {
				1: "P1.00/XL1",
				3: "P1.02/NFC1",
				9: "P1.08/EXTREF",
				10: "VDD",
				21: "P2.10",
				25: "SWDIO",
				26: "SWDCLK",
				30: "nRESET",
				31: "ANT",
				32: "VSS_PA",
				33: "DECRF",
				42: "P1.14/AIN7",
				44: "VSS",
				46: "DCC",
				49: "VSS",
			},
		},
		QGAA: {
			numbers: qfn(53),
			gpios: 35,
			expected: {
				6: "P1.16",
				10: "P1.08/EXTREF",
				11: "VDD",
				24: "P0.06",
				27: "SWDIO",
				28: "SWDCLK",
				32: "P0.05",
				33: "nRESET",
				34: "ANT",
				46: "P1.15",
				48: "VSS",
				50: "DCC",
				53: "VSS",
			},
		},
		CAAA: {
			numbers: grid("ABCDEFG", 7, ["B2", "C1"]),
			gpios: 32,
			expected: {
				A1: "XC1",
				A3: "P1.12/AIN5",
				A6: "VSS",
				A7: "DCC",
				B1: "DECRF",
				B7: "VDD",
				C2: "VSS_PA",
				C5: "P1.00/XL1",
				D1: "ANT",
				D2: "nRESET",
				E3: "SWDCLK",
				F2: "SWDIO",
				F7: "P1.08/EXTREF",
				G2: "P2.10",
				G3: "VDD",
				G4: "VSS",
			},
		},
	};
	const npm2100 = {
		QEAA: {
			numbers: qfn(17),
			expected: {
				1: "VSET",
				2: "SW",
				3: "VBAT",
				4: "SHPHLD",
				5: "GPIO0",
				6: "SDA",
				7: "SCL",
				8: "SYSGDEN",
				9: "GPIO1",
				10: "PG/RESET",
				11: "AVSS2",
				12: "LSOUT/VOUTLDO",
				13: "VOUT",
				14: "VINT",
				15: "VINT",
				16: "PVSS",
				17: "AVSS1",
			},
		},
		CAAA: {
			numbers: grid("ABCD", 4),
			expected: {
				A1: "LSOUT/VOUTLDO",
				A2: "VOUT",
				A3: "VINT",
				A4: "PVSS",
				B1: "AVSS1",
				B2: "AVSS2",
				B3: "VSET",
				B4: "SW",
				C1: "PG/RESET",
				C2: "SYSGDEN",
				C3: "GPIO0",
				C4: "VBAT",
				D1: "GPIO1",
				D2: "SCL",
				D3: "SDA",
				D4: "SHPHLD",
			},
		},
	};
	const cases = [
		...["nRF54L15", "nRF54L10", "nRF54L05"].flatMap((part) =>
			(["QDAA", "QFAA", "QGAA"] as const).map(
				(code) =>
					[`${part}-${code}`, "Microcontrollers", packages[code]] as const,
			),
		),
		["nRF54L15-CAAA", "Microcontrollers", packages.CAAA] as const,
		["nPM2100-QEAA", "Power", { ...npm2100.QEAA, gpios: 2 }] as const,
		["nPM2100-CAAA", "Power", { ...npm2100.CAAA, gpios: 2 }] as const,
	];
	assert.deepEqual(
		symbols
			.filter(({ file }) => /^(nrf54|npm)/.test(file.id))
			.map(({ file }) => file.name)
			.sort(),
		cases.map(([name]) => name).sort(),
	);
	const shapes = new Map<string, unknown>();
	for (const [name, category, { numbers, gpios, expected }] of cases) {
		const symbol = required(symbols.find(({ file }) => file.name === name));
		assert.equal(symbol.file.id, name.toLowerCase());
		assert.equal(symbol.file.value, name);
		assert.equal(symbol.category, category);
		assert.equal(symbol.file.prefix, "U");
		const pins = symbol.file.shapes.filter((shape) => shape.kind === "pin");
		assert.equal(symbol.file.shapes.length, pins.length + 1);
		assert.ok(pins.every((pin) => pin.length === 2.54));
		assert.equal(
			new Set(pins.map((pin) => `${pin.x},${pin.y}`)).size,
			pins.length,
		);
		for (const side of [-1, 1]) {
			const ys = pins
				.filter((pin) => Math.sign(pin.x) === side)
				.map((pin) => pin.y)
				.sort((a, b) => a - b);
			assert.ok(
				ys.slice(1).every((y, index) => Math.abs(y - ys[index] - 2.54) < 1e-8),
			);
		}
		assert.deepEqual(
			pins.map((pin) => pin.number).sort(),
			[...numbers].sort(),
			name,
		);
		const names = new Map(pins.map((pin) => [pin.number, pin.name]));
		for (const [number, pinName] of Object.entries(expected))
			assert.equal(names.get(number), pinName, `${name} pin ${number}`);
		assert.equal(
			pins.filter((pin) => /^(P\d\.\d\d|GPIO\d)/.test(pin.name)).length,
			gpios,
			name,
		);
		const code = name.slice(-4);
		const sibling = shapes.get(`${category}:${code}`);
		if (sibling) assert.deepEqual(symbol.file.shapes, sibling, name);
		else shapes.set(`${category}:${code}`, symbol.file.shapes);
		assert.deepEqual(
			symbols
				.filter(({ file }) =>
					[file.id, file.name, file.description, file.value].some((text) =>
						text.toLowerCase().includes(name.toLowerCase()),
					),
				)
				.map(({ file }) => file.name),
			[name],
		);
	}
});

test("package-specific chips group their packages under one part", () => {
	const parts = new Map<string, string[]>();
	for (const { file, packaging } of generateDefaultSymbols()) {
		const pinNumbers = file.shapes.some(
			(shape) => shape.kind === "pin" && shape.number !== undefined,
		);
		assert.equal(packaging !== undefined, pinNumbers, file.id);
		if (!packaging) continue;
		assert.ok(packaging.name && packaging.description, file.id);
		parts.set(packaging.part, [
			...(parts.get(packaging.part) ?? []),
			packaging.name,
		]);
	}
	assert.deepEqual(Object.fromEntries(parts), {
		RP2040: ["RP2040"],
		RP2350: ["RP2350A", "RP2350B"],
		nRF54L15: ["QDAA", "QFAA", "QGAA", "CAAA"],
		nRF54L10: ["QDAA", "QFAA", "QGAA"],
		nRF54L05: ["QDAA", "QFAA", "QGAA"],
		nPM2100: ["QEAA", "CAAA"],
	});
	const first = generateDefaultSymbols();
	const packaged = required(first.find(({ packaging }) => packaging));
	required(packaged.packaging).name = "changed";
	assert.notEqual(
		generateDefaultSymbols().find(({ file }) => file.id === packaged.file.id)
			?.packaging?.name,
		"changed",
	);
});
