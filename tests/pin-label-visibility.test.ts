import assert from "node:assert/strict";
import test from "node:test";
import {
	parseSymbolFile,
	symbolFileFromSymbol,
} from "#/components/editor/symbolFormat.ts";
import { buildDrawingDisplay } from "#/drawing/display.ts";
import { drawingShapeSchema } from "#/drawing/schema.ts";
import {
	DEFAULT_LINE_WIDTH,
	drawShape,
	pinTerminals,
	replaceSymbolChild,
	symbolChildren,
} from "#/drawing/shapes.ts";
import { libraryDefinitions } from "#/drawing/symbol-file.ts";
import {
	createSymbol,
	createSymbolFromShapes,
	symbolDefinitions,
} from "#/drawing/symbols.ts";
import { validateProjectDocument } from "#/projects/format.ts";

test("hidden pin labels preserve terminals in standalone pins, rotated symbols and previews", () => {
	const pin = {
		...drawShape(1, "pin", { x: 10, y: 0 }, { x: 10, y: 0 }),
		kind: "pin" as const,
		name: "GND",
		number: "01",
		showLabels: false,
	};
	const symbol = { ...createSymbolFromShapes(2, [pin]), rotation: Math.PI / 2 };
	const display = buildDrawingDisplay(
		[pin, symbol],
		new Set([pin.id, symbol.id]),
		[symbol],
	);
	for (const parent of [
		display.shapes[0],
		display.connections[0],
		display.previews[1],
	]) {
		assert.deepEqual(parent.children, []);
		assert.equal(parent.geometry.kind, "pin");
	}
	assert.deepEqual(
		pinTerminals(pin),
		pinTerminals({ ...pin, showLabels: true }),
	);
	assert.deepEqual(
		pinTerminals(symbol),
		pinTerminals({
			...symbol,
			children: symbol.children.map((child) =>
				child.kind === "pin" ? { ...child, showLabels: true } : child,
			),
		}),
	);
	assert.equal(buildDrawingDisplay([pin], new Set()).halos.length, 1);
	assert.deepEqual(
		buildDrawingDisplay(
			[{ ...pin, showLabels: true }],
			new Set(),
		).shapes[0].children?.map((label) => label.text),
		["GND", "01"],
	);
});

test("pin label visibility survives symbol and project round trips and rejects non-booleans", () => {
	for (const showLabels of [undefined, false, true]) {
		const file = parseSymbolFile(
			JSON.stringify({
				format: "ecad-symbol",
				version: 1,
				units: "mm",
				id: "custom.ground",
				name: "Ground",
				description: "",
				prefix: "GND",
				value: "0 V",
				shapes: [
					{
						kind: "pin",
						name: "GND",
						number: "01",
						x: 0,
						y: 0,
						...(showLabels === undefined ? {} : { showLabels }),
					},
				],
			}),
		);
		const symbol = createSymbol(2, libraryDefinitions([file])[0], {
			x: 10,
			y: 20,
		});
		const saved = parseSymbolFile(JSON.stringify(symbolFileFromSymbol(symbol)));
		const restored = libraryDefinitions([saved])[0].children[0];
		assert.equal(restored.kind, "pin");
		if (restored.kind !== "pin") throw new Error("Expected a pin");
		assert.equal(restored.name, "GND");
		assert.equal(restored.number, "01");
		assert.equal(restored.showLabels, showLabels);
		assert.deepEqual(
			validateProjectDocument(
				JSON.parse(
					JSON.stringify({ shapes: [restored, symbol], symbols: [saved] }),
				),
			),
			{ shapes: [restored, symbol], symbols: [saved] },
		);
		assert.equal(
			drawingShapeSchema.safeParse({ ...restored, showLabels: "false" })
				.success,
			false,
		);
		assert.throws(
			() =>
				parseSymbolFile(
					JSON.stringify({
						...file,
						shapes: [{ ...file.shapes[0], showLabels: "false" }],
					}),
				),
			/showLabels/,
		);
	}
});

test("built-in ground and supply symbols hide pin labels while other parts use native pin labels", () => {
	const supplies = new Set([
		"signal-ground",
		"vcc",
		"vdd",
		"power-3v3",
		"power-5v",
	]);
	for (const definition of symbolDefinitions) {
		const symbol = createSymbol(1, definition, { x: 0, y: 0 });
		const pins = definition.children.filter((child) => child.kind === "pin");
		const labels = buildDrawingDisplay([symbol], new Set()).connections.flatMap(
			(pin) => pin.children ?? [],
		);
		if (supplies.has(definition.id)) {
			assert.equal(pins.length, 1);
			assert.ok(pins[0].name);
			assert.equal(pins[0].showLabels, false);
			assert.deepEqual(labels, []);
		} else {
			assert.deepEqual(
				labels.map((label) => label.text),
				pins.flatMap((pin) => [pin.name, pin.number].filter(Boolean)),
			);
		}
	}
});

test("native pin names align with leads while numbers stay above them and survive saves", () => {
	for (const labelOffset of [-2.5, 2.5]) {
		const pin = {
			...drawShape(1, "pin", { x: 0, y: 0 }, { x: 0, y: 0 }),
			kind: "pin" as const,
			name: "SWCLK",
			number: "24",
			length: undefined,
			labelOffset,
		};
		delete pin.length;
		const symbol = createSymbolFromShapes(2, [pin]);
		const file = parseSymbolFile(JSON.stringify(symbolFileFromSymbol(symbol)));
		const restored = libraryDefinitions([file])[0].children[0];
		assert.equal(restored.kind, "pin");
		if (restored.kind !== "pin") throw new Error("Expected a pin");
		assert.equal(restored.labelOffset, labelOffset);
		assert.deepEqual(
			pinTerminals(restored),
			pinTerminals({ ...restored, labelOffset: undefined }),
		);
		const [display] = buildDrawingDisplay([pin], new Set()).shapes;
		const [name, number] = display.children!;
		const edge =
			name.x * display.width +
			(labelOffset < 0
				? (name.width * display.width) / 2
				: (-name.width * display.width) / 2);
		assert.ok(Math.abs(edge - labelOffset) < 1e-9);
		assert.equal(name.y, 0);
		assert.equal(Math.sign(number.x), Math.sign(labelOffset));
		assert.ok(
			Math.abs(number.x * display.width) + (number.width * display.width) / 2 <
				Math.abs(labelOffset) - 0.5,
		);
		assert.ok(number.y * display.height > 0);
		assert.ok((number.y + number.height / 2) * display.height < 2);
		assert.equal(drawingShapeSchema.safeParse(restored).success, true);
		assert.equal(
			drawingShapeSchema.safeParse({ ...restored, labelOffset: Infinity })
				.success,
			false,
		);
		assert.equal(
			drawingShapeSchema.safeParse({ ...restored, labelOffset: 1001 }).success,
			false,
		);
		assert.deepEqual(
			validateProjectDocument(
				JSON.parse(JSON.stringify({ shapes: [symbol], symbols: [file] })),
			),
			{ shapes: [symbol], symbols: [file] },
		);
	}
});

test("independent visibility overrides the legacy fallback without moving either label", () => {
	for (const length of [undefined, 0, 4]) {
		for (const rotation of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
			const pin = {
				...drawShape(1, "pin", { x: 0, y: 0 }, { x: 0, y: 0 }),
				kind: "pin" as const,
				length,
				rotation,
				name: "RUN",
				number: "01",
			};
			const full = buildDrawingDisplay([pin], new Set([1])).shapes[0];
			for (const showLabels of [undefined, false, true]) {
				for (const showName of [undefined, false, true]) {
					for (const showNumber of [undefined, false, true]) {
						const variant = { ...pin, showLabels, showName, showNumber };
						const symbol = {
							...createSymbolFromShapes(2, [variant]),
							rotation: Math.PI / 2,
						};
						const visible = [
							showName ?? showLabels ?? true,
							showNumber ?? showLabels ?? true,
						];
						const display = buildDrawingDisplay(
							[variant, symbol],
							new Set([1, 2]),
							[variant, symbol],
						);
						assert.deepEqual(
							display.shapes[0].children,
							full.children!.filter((_, index) => visible[index]),
						);
						for (const item of [
							display.connections[0],
							display.previews[0],
							display.previews[2],
						]) {
							assert.deepEqual(
								item.children?.map((label) => label.text),
								["RUN", "01"].filter((_, index) => visible[index]),
							);
						}
						assert.deepEqual(pinTerminals(variant), pinTerminals(pin));
					}
				}
			}
		}
	}
});

test("independent pin visibility survives symbol, drawing, and child override persistence", () => {
	for (const showLabels of [undefined, false, true]) {
		for (const showName of [undefined, false, true]) {
			for (const showNumber of [undefined, false, true]) {
				const visibility = { showLabels, showName, showNumber };
				const file = parseSymbolFile(
					JSON.stringify({
						format: "ecad-symbol",
						version: 1,
						units: "mm",
						id: "custom.pin",
						name: "Pin",
						description: "",
						prefix: "U",
						value: "",
						shapes: [
							{
								kind: "pin",
								name: "RUN",
								number: "01",
								x: 0,
								y: 0,
								...visibility,
							},
						],
					}),
				);
				const symbol = createSymbol(2, libraryDefinitions([file])[0], {
					x: 10,
					y: 20,
				});
				const saved = parseSymbolFile(
					JSON.stringify(symbolFileFromSymbol(symbol)),
				);
				assert.deepEqual(
					saved.shapes,
					file.shapes.map((shape) => ({
						...shape,
						lineWidth: DEFAULT_LINE_WIDTH,
					})),
				);
				const pin = symbol.children[0];
				const placed = {
					...symbol,
					childOverrides: { [`shape:${pin.id}`]: visibility },
				};
				const document = { shapes: [pin, placed], symbols: [saved] };
				assert.deepEqual(
					validateProjectDocument(JSON.parse(JSON.stringify(document))),
					JSON.parse(JSON.stringify(document)),
				);
				for (const field of ["showName", "showNumber"]) {
					assert.equal(
						drawingShapeSchema.safeParse({ ...pin, [field]: "false" }).success,
						false,
					);
					assert.throws(
						() =>
							parseSymbolFile(
								JSON.stringify({
									...file,
									shapes: [{ ...file.shapes[0], [field]: "false" }],
								}),
							),
						new RegExp(field),
					);
					assert.throws(
						() =>
							validateProjectDocument({
								...document,
								shapes: [
									{
										...placed,
										childOverrides: { [`shape:${pin.id}`]: { [field]: 1 } },
									},
								],
							}),
						new RegExp(field),
					);
				}
			}
		}
	}
});

test("symbol child visibility overrides render independently and export into reusable definitions", () => {
	const pin = {
		...drawShape(1, "pin", { x: 0, y: 0 }, { x: 0, y: 0 }),
		kind: "pin" as const,
		name: "RUN",
		number: "26",
		showLabels: false,
	};
	const original = createSymbolFromShapes(2, [pin]);
	const child = symbolChildren(original)[0];
	assert.equal(child.shape.kind, "pin");
	if (child.shape.kind !== "pin") throw new Error("Expected pin child");
	const changed = replaceSymbolChild(original, child.key, {
		...child.shape,
		showNumber: true,
	});
	assert.equal(changed.childOverrides?.[child.key].showNumber, true);
	assert.deepEqual(
		buildDrawingDisplay([original], new Set()).connections[0].children,
		[],
	);
	assert.deepEqual(
		buildDrawingDisplay([changed], new Set()).connections[0].children?.map(
			(label) => label.text,
		),
		["26"],
	);
	const saved = parseSymbolFile(JSON.stringify(symbolFileFromSymbol(changed)));
	const restored = createSymbol(3, libraryDefinitions([saved])[0], {
		x: 0,
		y: 0,
	});
	assert.deepEqual(
		buildDrawingDisplay([restored], new Set()).connections[0].children?.map(
			(label) => label.text,
		),
		["26"],
	);
	assert.deepEqual(pinTerminals(changed), pinTerminals(original));
});
