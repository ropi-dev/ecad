import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { importKiCadSchematic } from "#/formats/kicad/import.ts";
import { parseSExpr, nodes, node } from "#/formats/kicad/sexpr.ts";
import { symbolTextShapes } from "#/drawing/shapes.ts";
import { validateProjectDocument } from "#/projects/format.ts";

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
	const expected = JSON.parse(
		readFileSync(
			new URL("./fixtures/kicad/pins.json", import.meta.url),
			"utf8",
		),
	);
	const actual = symbols.flatMap((s, index) =>
		s.children
			.filter((c) => c.kind === "pin")
			.map((p) => ({
				reference: result.report.components[index].properties.Reference,
				number: p.number,
				name: p.name,
				x: Number((s.x + p.x).toFixed(6)),
				y: Number((s.y + p.y).toFixed(6)),
			})),
	);
	assert.equal(actual.length, 272);
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
			const p = s.children.find((c) => c.kind === "pin")!;
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
	assert.equal(
		parseSExpr('(text "hello\\n\\\"world\\\"")')[1],
		'hello\n"world"',
	);
});

test("rotated reference and value labels stay bound after edits and serialization", () => {
	const input = fixture("").replace(
		'(property "Reference" "X1" (at 10 20 0) (effects hide))',
		'(property "Reference" "U1" (at 12 18 90)) (property "Value" "Original" (at 14 18 90))',
	);
	const symbol = importKiCadSchematic(input).shapes[0];
	assert.equal(symbol.kind, "symbol");
	if (symbol.kind !== "symbol") return;
	assert.equal(
		symbol.children.filter(
			(child) =>
				child.kind === "text" && ["U1", "Original"].includes(child.text),
		).length,
		0,
	);
	const updated = {
		...symbol,
		attributes: { ...symbol.attributes, reference: "U2", value: "Changed" },
	};
	const saved = validateProjectDocument(
		JSON.parse(JSON.stringify({ shapes: [updated], symbols: [] })),
	).shapes[0];
	assert.equal(saved.kind, "symbol");
	if (saved.kind !== "symbol") return;
	const labels = symbolTextShapes(saved);
	assert.deepEqual(
		labels.map((label) => label.text),
		["U2", "Changed"],
	);
	assert.deepEqual(
		labels.map((label) => label.rotation),
		[Math.PI / 2, Math.PI / 2],
	);
	assert.deepEqual(
		labels.map((label) => ({ x: label.x, y: label.y })),
		[
			{ x: 12 - 148.5, y: 105 - 18 },
			{ x: 14 - 148.5, y: 105 - 18 },
		],
	);
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

test("native net and supply anchors reproduce all independently derived RP2350A source pin groups", async () => {
	const { referenceNetGroups, sortNetGroups } = await import(
		"./fixtures/kicad/reference-nets.ts"
	);
	const result = importKiCadSchematic(source);
	const oracle = JSON.parse(
		readFileSync(
			new URL("./fixtures/kicad/source-nets.json", import.meta.url),
			"utf8",
		),
	);
	const actual = referenceNetGroups(result.shapes);
	assert.deepEqual(actual, sortNetGroups(oracle));
	assert.equal(actual.filter((group) => group.names.length).length, 51);
	assert.equal(actual.filter((group) => !group.names.length).length, 5);
	assert.equal(actual.flatMap((group) => group.pins).length, 231);
	const labels = result.shapes
		.filter((shape) => shape.kind === "text")
		.filter((shape) => shape.electrical === "net");
	assert.deepEqual(
		labels.map((shape) => ({ text: shape.text, x: shape.x, y: shape.y })),
		nodes(parseSExpr(source), "label").map((label) => {
			const at = node(label, "at");
			return {
				text: String(label[1]),
				x: Number(at[1]) - 210,
				y: 148.5 - Number(at[2]),
			};
		}),
	);
	assert.equal(labels.length, 94);
	const supplies = result.shapes.filter(
		(shape) => shape.kind === "symbol" && shape.netSymbol,
	);
	assert.equal(supplies.length, 41);
	for (const supply of result.report.supplies) {
		const symbol = result.shapes.filter((shape) => shape.kind === "symbol")[
			result.report.components.findIndex(
				(component) => component.properties.Reference === supply.reference,
			)
		];
		assert.ok(symbol && symbol.kind === "symbol");
		const pin = symbol.children.find((child) => child.kind === "pin");
		assert.ok(pin);
		assert.equal(supply.x, symbol.x + pin.x);
		assert.equal(supply.y, symbol.y + pin.y);
	}
	const reopened = validateProjectDocument(
		JSON.parse(JSON.stringify({ shapes: result.shapes, symbols: [] })),
	);
	assert.deepEqual(referenceNetGroups(reopened.shapes), actual);
});

test("imported drawing exports native pin visibility, electrical labels and rotated bound attributes", async () => {
	const { exportDrawingSvg } = await import("#/drawing/export.ts");
	const { pinVisibilitySource, visibilityCases } = await import(
		"./fixtures/kicad/pin-visibility.ts"
	);
	const options = {
		width: 2400,
		height: 1600,
		area: "sheet" as const,
		background: "white" as const,
		sheet: { width: 420, height: 297 },
	};
	const shapes = importKiCadSchematic(source).shapes;
	const saved = JSON.stringify(shapes);
	const svg = exportDrawingSvg(shapes, options);
	for (const shape of shapes)
		assert.ok(svg.includes(`data-name="${shape.kind} ${shape.id}"`));
	assert.doesNotMatch(svg, /NaN|Infinity/);
	assert.equal(JSON.stringify(shapes), saved);
	const rotated = importKiCadSchematic(
		fixture("").replace(
			'(property "Reference" "X1" (at 10 20 0) (effects hide))',
			'(property "Reference" "U1" (at 12 18 90)) (property "Value" "Original" (at 14 18 90))',
		),
	).shapes[0];
	assert.equal(rotated.kind, "symbol");
	if (rotated.kind === "symbol") {
		const edited = exportDrawingSvg(
			[
				{
					...rotated,
					attributes: {
						...rotated.attributes,
						reference: "U2",
						value: "Changed",
					},
				},
			],
			options,
		);
		assert.match(edited, />U2<\/text>/);
		assert.match(edited, />Changed<\/text>/);
		assert.doesNotMatch(edited, />Original<\/text>/);
	}
	const pins = importKiCadSchematic(pinVisibilitySource).shapes;
	for (const [index, visibility] of visibilityCases.entries()) {
		const single = exportDrawingSvg([pins[index]], options);
		assert.equal(
			single.includes(`data-name="pin name 1"`),
			visibility.showName,
		);
		assert.equal(
			single.includes(`data-name="pin number 1"`),
			visibility.showNumber,
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

test("a schematic with one broken symbol imports everything else and reports one readable warning", () => {
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
	assert.deepEqual(result.report.skipped, [
		{
			item: "symbol U2 (RPI_DB:Missing LDO)",
			reason: "Its library symbol is not embedded in the schematic.",
		},
	]);
	assert.deepEqual(
		result.report.warnings.filter((w) => !complete.report.warnings.includes(w)),
		[
			"Skipped symbol U2 (RPI_DB:Missing LDO). Its library symbol is not embedded in the schematic.",
		],
	);
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

const twoSymbols = (definition: string, extra = "") =>
	`(kicad_sch (version 20250114) (paper "A4") (lib_symbols (symbol "Good" (symbol "Good_1_1" (pin input line (at 2 3 0) (length 2) (name "IN") (number "1")))) ${definition}) (symbol (lib_id "Good") (at 10 20 0) (unit 1) (uuid "good") (property "Reference" "X1" (at 10 20 0) (effects hide))) (symbol (lib_id "Bad") (at 30 20 0) (unit 1) (uuid "bad") (property "Reference" "X2" (at 30 20 0) (effects hide))) (wire (pts (xy 0 0) (xy 10 0))) ${extra})`;
test("a symbol whose converted geometry is invalid is skipped with a readable reason", () => {
	const result = importKiCadSchematic(
		twoSymbols(
			'(symbol "Bad" (symbol "Bad_1_1" (pin input line (at 0 0 0) (length 2) (name "A") (number "1")) (circle (center 0 0) (radius wide))))',
		),
	);
	assert.deepEqual(
		result.shapes.map((s) => s.kind),
		["symbol", "wire"],
	);
	assert.deepEqual(result.report.skipped, [
		{
			item: "symbol X2 (Bad)",
			reason: "The radius of child 2 (a circle) is not a number.",
		},
	]);
	assert.equal(result.report.components.length, 1);
});

test("broken power symbols, wires, labels and markers are skipped one at a time", () => {
	const result = importKiCadSchematic(
		twoSymbols(
			'(symbol "Bad" (power) (symbol "Bad_1_1" (pin power_in line (at 0 0 0) (length 0) (name "A") (number "1")) (pin power_in line (at 1 0 0) (length 0) (name "B") (number "2"))))',
			'(wire (pts (xy 0 0) (xy 5 0) (xy 5 5))) (label "SDA" (at 1 2 0)) (label "SCL") (global_label "VBUS" (at x 4 0)) (junction (at 7 8)) (no_connect (at 9) (uuid "nc-1")) (text "Note" (at 3 4 0))',
		).replace(
			'(property "Reference" "X2" (at 30 20 0) (effects hide))',
			'(property "Reference" "#PWR01" (at 30 20 0) (effects hide)) (property "Value" "+3V3" (at 30 20 0))',
		),
	);
	assert.deepEqual(
		result.report.skipped.map(({ item, reason }) => `${item}: ${reason}`),
		[
			"symbol #PWR01 (Bad): A power symbol needs exactly one pin, but this one has 2.",
			"wire at (0, 0): A wire needs two endpoints, but this one has 3.",
			'label "SCL": The position is missing.',
			'global label "VBUS" at (x, 4): Invalid at coordinates.',
			"no-connect marker with UUID nc-1: The position is missing.",
		],
	);
	assert.deepEqual(
		result.shapes.map((s) => s.kind),
		["symbol", "wire", "circle", "text", "text"],
	);
	assert.deepEqual(
		result.report.labels.map((l) => l.text),
		["SDA"],
	);
	assert.deepEqual(result.report.supplies, []);
	assert.ok(
		result.report.warnings.slice(0, 5).every((w) => w.startsWith("Skipped ")),
	);
});

test("skipped units of one multi-unit part are named by unit", () => {
	const unit = (n: number) =>
		`(symbol (lib_id "Lib:Missing") (at ${10 * n} 20 0) (unit ${n}) (uuid "u${n}") (property "Reference" "U3" (at 0 0 0)))`;
	const result = importKiCadSchematic(
		`(kicad_sch (version 20250114) (paper "A4") (lib_symbols) ${unit(1)} ${unit(2)} (wire (pts (xy 0 0) (xy 10 0))))`,
	);
	assert.deepEqual(
		result.report.skipped.map((s) => s.item),
		["symbol U3 (Lib:Missing)", "symbol U3 unit 2 (Lib:Missing)"],
	);
});
