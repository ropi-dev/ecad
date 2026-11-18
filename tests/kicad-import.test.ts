import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseOverbars } from "@ecad/drawing-core/drawing/overbar.ts";
import { symbolTextShapes } from "@ecad/drawing-core/drawing/shapes.ts";
import { importKiCadSchematic } from "#/formats/kicad/import.ts";
import { node, nodes, parseSExpr } from "#/formats/kicad/sexpr.ts";
import { validateProjectDocument } from "#/projects/format.ts";
import { required } from "./helpers/required.ts";

const source = readFileSync(
	new URL(
		"./fixtures/kicad/RPI-RP2350A-MINIMAL_R4-S1.kicad_sch",
		import.meta.url,
	),
	"utf8",
);

test("RP2350A imports all instances, terminal positions, values, wires and visible labels", () => {
	const result = importKiCadSchematic(source);
	const symbols = result.shapes.filter((s) => s.kind === "symbol");
	assert.equal(symbols.length, 87);
	const expected = (
		JSON.parse(
			readFileSync(
				new URL("./fixtures/kicad/pins.json", import.meta.url),
				"utf8",
			),
		) as { name: string }[]
	).map((pin) => {
		const { text, overbars } = parseOverbars(pin.name);
		return {
			...pin,
			name: text,
			activeLow: overbars.length ? true : undefined,
		};
	});
	const actual = symbols.flatMap((s, index) =>
		s.children
			.filter((c) => c.kind === "pin")
			.map((p) => ({
				reference: result.report.components[index].properties.Reference,
				number: p.number,
				name: p.name,
				activeLow: p.activeLow,
				x: Number((s.x + p.x).toFixed(6)),
				y: Number((s.y + p.y).toFixed(6)),
			})),
	);
	assert.equal(actual.length, 272);
	const pin = (reference: string, number: string) =>
		actual.find((p) => p.reference === reference && p.number === number);
	assert.deepEqual(
		[pin("U3", "1"), pin("U3", "3")].map((p) => [p?.name, p?.activeLow]),
		[
			["CS", true],
			["WP_IO2", true],
		],
	);
	assert.deepEqual(
		[pin("U3", "6")].map((p) => [p?.name, p?.activeLow]),
		[["CLK", undefined]],
	);
	assert.deepEqual(actual, expected);
	assert.equal(
		new Set(actual.filter((p) => p.reference === "U1").map((p) => p.number))
			.size,
		61,
	);
	const root = parseSExpr(source);
	assert.deepEqual(
		symbols.map((s, index) =>
			s.netSymbol
				? [
						result.report.components[index].properties.Reference,
						s.attributes.name,
					]
				: [s.attributes.reference, s.attributes.value],
		),
		result.report.components.map((c) => [
			c.properties.Reference,
			c.properties.Value,
		]),
	);
	const wires = result.shapes.filter((s) => s.kind === "wire");
	assert.equal(wires.length, 346);
	for (const [i, wire] of nodes(root, "wire").entries()) {
		const expected = nodes(node(wire, "pts"), "xy").map((p) => ({
			x: Number(p[1]) - 210,
			y: 148.5 - Number(p[2]),
		}));
		const w = wires[i];
		const ends = [-1, 1].map((sign) => ({
			x: w.x + (sign * Math.cos(w.rotation) * w.width) / 2,
			y: w.y + (sign * Math.sin(w.rotation) * w.width) / 2,
		}));
		for (let j = 0; j < 2; j++) {
			assert.ok(Math.abs(ends[j].x - expected[j].x) < 1e-8);
			assert.ok(Math.abs(ends[j].y - expected[j].y) < 1e-8);
		}
	}
	assert.equal(result.shapes.filter((s) => s.kind === "no-connect").length, 1);
	assert.equal(result.report.labels.length, 94);
	assert.equal(result.shapes.filter((s) => s.kind === "circle").length, 83);
	assert.ok(result.report.warnings.some((w) => w.includes("embedded_files")));
	assert.ok(result.report.metadata.some((n) => n[0] === "lib_symbols"));
	assert.equal(
		validateProjectDocument({ shapes: result.shapes, symbols: [] }).shapes
			.length,
		621,
	);
});

const fixture = (extra: string, at = "10 20 0", mirror = "") =>
	`(kicad_sch (version 20250114) (paper "A4") (lib_symbols (symbol "Test" (symbol "Test_1_1" (pin input line (at 2 3 0) (length 2) (name "IN") (number "01"))))) (symbol (lib_id "Test") (at ${at}) ${mirror} (unit 1) (uuid "test") (property "Reference" "X1" (at 10 20 0) (effects hide))) ${extra})`;
test("rotation and mirrors preserve terminal positions and lead directions", () => {
	for (const angle of [0, 90, 180, 270])
		for (const mirror of ["", "x", "y"]) {
			const r = importKiCadSchematic(
				fixture("", `10 20 ${angle}`, mirror ? `(mirror ${mirror})` : ""),
			);
			const s = r.shapes[0];
			assert.equal(s.kind, "symbol");
			if (s.kind !== "symbol") return;
			const p = required(s.children.find((c) => c.kind === "pin"));
			const x = mirror === "y" ? -2 : 2,
				y = mirror === "x" ? -3 : 3,
				a = (angle * Math.PI) / 180;
			assert.ok(Math.abs(p.x - (Math.cos(a) * x - Math.sin(a) * y)) < 1e-9);
			assert.ok(Math.abs(p.y - (Math.sin(a) * x + Math.cos(a) * y)) < 1e-9);
			assert.equal(p.kind === "pin" && p.number, "01");
		}
});
test("unsupported constructs produce reports and documents with nothing importable fail", () => {
	assert.ok(
		importKiCadSchematic(
			fixture('(sheet (uuid "child"))'),
		).report.warnings.some((w) => w.includes("sheet")),
	);
	for (const s of [
		"(kicad_sch",
		"(kicad_sch))",
		"(other)",
		"(kicad_sch) trailing",
		fixture("").replace('(lib_id "Test")', '(lib_id "Missing")'),
	])
		assert.throws(() => importKiCadSchematic(s));
	assert.equal(parseSExpr('(text "hello\\n\\"world\\"")')[1], 'hello\n"world"');
});

test("imported pin labels use native independent fields and preserve all visibility combinations", async () => {
	const { pinVisibilitySource, visibilityCases } = await import(
		"./fixtures/kicad/pin-visibility.ts"
	);
	const { buildDrawingDisplay } = await import("#/drawing/display.ts");
	const original = importKiCadSchematic(pinVisibilitySource).shapes;
	const saved = validateProjectDocument(
		JSON.parse(JSON.stringify({ shapes: original, symbols: [] })),
	).shapes;
	for (const [index, symbol] of saved.entries()) {
		assert.equal(symbol.kind, "symbol");
		if (symbol.kind !== "symbol") continue;
		assert.equal(symbol.children.length, 1);
		const pin = symbol.children[0];
		assert.equal(pin.kind, "pin");
		if (pin.kind !== "pin") continue;
		assert.equal(pin.showName, visibilityCases[index].showName);
		assert.equal(pin.showNumber, visibilityCases[index].showNumber);
		assert.equal(pin.showLabels, undefined);
		const rendered =
			buildDrawingDisplay([pin], new Set()).shapes[0].children?.map(
				(label) => label.text,
			) ?? [];
		assert.deepEqual(rendered, [
			...(pin.showName ? [`Signal${index}`] : []),
			...(pin.showNumber ? [String(index + 1)] : []),
		]);
	}
	const hidden = pinVisibilitySource.replaceAll(
		"(pin input line (at -8 0 0)",
		"(pin input line hide (at -8 0 0)",
	);
	for (const hiddenSymbol of importKiCadSchematic(hidden).shapes) {
		assert.equal(hiddenSymbol.kind, "symbol");
		if (hiddenSymbol.kind === "symbol")
			assert.deepEqual(
				hiddenSymbol.children.map(
					(p) => p.kind === "pin" && [p.showName, p.showNumber],
				),
				[[false, false]],
			);
	}
});

test("named supplies show one name while power flags keep their normal visible Value", async () => {
	const { exportDrawingSvg } = await import("#/drawing/export.ts");
	const result = importKiCadSchematic(source);
	for (const supply of result.report.supplies) {
		const symbol = result.shapes.filter((shape) => shape.kind === "symbol")[
			result.report.components.findIndex(
				(component) => component.properties.Reference === supply.reference,
			)
		];
		assert.ok(symbol?.kind === "symbol");
		assert.equal(symbol.attributes.name, supply.text);
		assert.equal(symbol.attributes.reference, "");
		assert.equal(symbol.attributes.value, "");
		assert.equal(symbol.netSymbol, true);
		assert.ok(symbol.texts.some((label) => label.attribute === "name"));
		assert.ok(
			!symbol.texts.some(
				(label) =>
					label.attribute === "reference" || label.attribute === "value",
			),
		);
		assert.ok(
			!symbol.children.some(
				(child) => child.kind === "text" && child.text === supply.text,
			),
		);
		assert.equal(
			result.shapes.filter(
				(shape) =>
					shape.kind === "text" &&
					shape.electrical === "supply" &&
					shape.x === supply.x &&
					shape.y === supply.y &&
					shape.text === supply.text,
			).length,
			0,
		);
		assert.equal(
			result.report.components.find(
				(component) => component.properties.Reference === supply.reference,
			)?.properties.Value,
			supply.text,
		);
	}
	const input = fixture("")
		.replaceAll('"Test"', '"power:PWR_FLAG"')
		.replace(
			'(symbol "power:PWR_FLAG" (symbol',
			'(symbol "power:PWR_FLAG" (power global) (symbol',
		)
		.replace(
			'(property "Reference" "X1" (at 10 20 0) (effects hide))',
			'(property "Reference" "#FLG01" (at 10 20 0) (effects hide)) (property "Value" "PWR_FLAG" (at 12 18 90))',
		);
	const flag = importKiCadSchematic(input);
	assert.equal(flag.report.supplies.length, 0);
	const symbol = flag.shapes[0];
	assert.equal(symbol.kind, "symbol");
	if (symbol.kind !== "symbol") return;
	assert.equal(symbol.attributes.value, "PWR_FLAG");
	assert.deepEqual(
		symbolTextShapes(symbol).map((label) => label.text),
		["PWR_FLAG"],
	);
	const svg = exportDrawingSvg(flag.shapes, {
		width: 2400,
		height: 1600,
		area: "sheet",
		background: "white",
		sheet: { width: 420, height: 297 },
	});
	assert.match(svg, />PWR_FLAG<\/text>/);
	assert.ok(
		!flag.shapes.some((shape) => shape.kind === "text" && shape.electrical),
	);
});

test("a schematic with one broken symbol imports everything else and reports one warning", () => {
	const broken = source.replace(
		'(lib_id "RPI_DB:Integrated_Circuits | Power | LDO/RP-01JWD9-7JRX6J")',
		'(lib_id "RPI_DB:Missing LDO")',
	);
	assert.notEqual(broken, source);
	const complete = importKiCadSchematic(source);
	const result = importKiCadSchematic(broken);
	const symbols = result.shapes.filter((s) => s.kind === "symbol");
	assert.equal(symbols.length, 86);
	assert.equal(result.shapes.filter((s) => s.kind === "wire").length, 346);
	assert.equal(result.report.labels.length, 94);
	assert.equal(result.shapes.length, complete.shapes.length - 1);
	assert.equal(result.report.skipped.length, 1);
	assert.match(result.report.skipped[0].item, /\bU2\b.*RPI_DB:Missing LDO/);
	const added = result.report.warnings.filter(
		(w) => !complete.report.warnings.includes(w),
	);
	assert.equal(added.length, 1);
	assert.match(added[0], /\bU2\b/);
	// Report entries stay aligned with the imported symbols.
	assert.deepEqual(
		result.report.components,
		complete.report.components.filter((c) => c.properties.Reference !== "U2"),
	);
	assert.equal(result.report.components.length, 86);
	assert.ok(result.shapes.every((s, index) => s.id === index + 1));
	assert.equal(
		validateProjectDocument({ shapes: result.shapes, symbols: [] }).shapes
			.length,
		result.shapes.length,
	);
});
