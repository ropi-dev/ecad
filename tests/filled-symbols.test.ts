import assert from "node:assert/strict";
import test from "node:test";
import {
	Group,
	type Mesh,
	type MeshBasicMaterial,
	Raycaster,
	Vector3,
} from "three";
import {
	parseSymbolFile,
	symbolFileFromSymbol,
} from "#/components/editor/symbolFormat.ts";
import { buildDrawingDisplay } from "#/drawing/display.ts";
import { drawShape } from "#/drawing/shapes.ts";
import {
	libraryDefinitions,
	symbolFileShapes,
	symbolFileWithShapes,
} from "#/drawing/symbol-file.ts";
import { createSymbolFromShapes } from "#/drawing/symbols.ts";
import { createDrawingRenderer } from "#/engine/drawing/renderer.ts";
import { validateProjectDocument } from "#/projects/format.ts";

const luminance = (hex: string) => {
	const channels = [0, 2, 4]
		.map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
		.map((value) =>
			value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
		);
	return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};

test("circle and rectangle fills survive symbol loading and saving", () => {
	for (const kind of ["circle", "rectangle"] as const)
		for (const filled of [undefined, false, true]) {
			const shape = {
				kind,
				x: 0,
				y: 0,
				lineWidth: 0.254,
				...(kind === "circle"
					? { radius: 2 }
					: { width: 4, height: 4, rotation: 0 }),
				...(filled === undefined ? {} : { filled }),
			};
			const file = parseSymbolFile(
				JSON.stringify({
					format: "ecad-symbol",
					version: 1,
					units: "mm",
					id: "custom.fill-roundtrip",
					name: "Fill",
					description: "",
					prefix: "U",
					value: "",
					shapes: [shape],
				}),
			);
			const shapes = symbolFileShapes(file);
			assert.equal(
				"filled" in shapes[0] ? shapes[0].filled : undefined,
				filled,
			);
			assert.equal(Object.hasOwn(shapes[0], "filled"), filled !== undefined);
			assert.deepEqual(
				parseSymbolFile(JSON.stringify(symbolFileWithShapes(file, shapes))),
				file,
			);
		}
});

test("filled bodies cover their interiors beneath outlines with readable normal and selected colors", () => {
	const rectangle = {
		...drawShape(1, "rectangle", { x: -10, y: -5 }, { x: 10, y: 5 }),
		filled: true,
	};
	const symbol = createSymbolFromShapes(2, [rectangle]);
	for (const shape of [rectangle, symbol])
		for (const selected of [false, true]) {
			const renderer = createDrawingRenderer(null);
			const root = new Group();
			try {
				const display = buildDrawingDisplay(
					[shape],
					new Set(selected ? [shape.id] : []),
				);
				renderer.update(root, display);
				root.updateMatrixWorld(true);
				const body = root.getObjectByName(`fill ${shape.id}:1`) as Mesh<
					never,
					MeshBasicMaterial
				>;
				assert.ok(body);
				assert.ok(
					new Raycaster(
						new Vector3(0, 0, 10),
						new Vector3(0, 0, -1),
					).intersectObject(body).length,
				);
				const outline = root.getObjectByName(
					`${shape.kind} ${shape.id}`,
				) as Mesh<never, MeshBasicMaterial>;
				assert.ok(body.renderOrder < outline.renderOrder);
				assert.equal(body.material.transparent, false);
				const foreground = luminance(outline.material.color.getHexString());
				const background = luminance(body.material.color.getHexString());
				assert.ok(
					(Math.max(foreground, background) + 0.05) /
						(Math.min(foreground, background) + 0.05) >=
						4.5,
				);
			} finally {
				renderer.dispose();
			}
		}
	const file = parseSymbolFile(JSON.stringify(symbolFileFromSymbol(symbol)));
	assert.equal(file.shapes[0].kind, "rectangle");
	assert.ok("filled" in file.shapes[0] && file.shapes[0].filled);
	assert.ok("filled" in libraryDefinitions([file])[0].children[0]);
	assert.deepEqual(
		validateProjectDocument(
			JSON.parse(JSON.stringify({ shapes: [symbol], symbols: [file] })),
		),
		{ shapes: [symbol], symbols: [file] },
	);
	assert.throws(
		() =>
			parseSymbolFile(
				JSON.stringify({
					...file,
					shapes: [{ ...file.shapes[0], filled: "true" }],
				}),
			),
		/Invalid symbol file/,
	);
});
