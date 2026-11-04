import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDrawingDisplay } from "#/drawing/display.ts";
import {
	hitShape,
	symbolShapes,
	symbolTextShapes,
	type TextShape,
} from "#/drawing/shapes.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";
import {
	horizontalAlignments,
	textCenter,
	verticalAlignments,
} from "#/drawing/text-alignment.ts";

const text: TextShape = {
	id: 1,
	kind: "text",
	text: "Supply\n3.3 V",
	x: 10,
	y: 20,
	width: 12,
	height: 6,
	rotation: 0,
	lineWidth: 0.2,
	fontSize: 2,
};

const angles = [
	[0, 0],
	[45, 45],
	[90, 90],
	[91, -89],
	[135, -45],
	[180, 0],
	[225, 45],
	[270, 90],
	[315, -45],
	[360, 0],
	[-45, -45],
	[-90, 90],
	[-135, 45],
	[-180, 0],
	[-270, 90],
	[855, -45],
];
const radians = (degrees: number) => (degrees * Math.PI) / 180;
const close = (actual: number, expected: number) =>
	assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test("standalone text and previews stay upright without moving aligned bounds or changing the document", () => {
	for (const [degrees, expected] of angles) {
		for (const horizontalAlign of horizontalAlignments) {
			for (const verticalAlign of verticalAlignments) {
				const shape = {
					...text,
					horizontalAlign,
					verticalAlign,
					rotation: radians(degrees),
				};
				const before = structuredClone(shape);
				const display = buildDrawingDisplay([shape], new Set([shape.id]), [
					shape,
				]);
				const center = textCenter(shape);
				for (const rendered of [display.shapes[0], display.previews[0]]) {
					close(rendered.rotation, radians(expected));
					assert.equal(rendered.x, center.x);
					assert.equal(rendered.y, center.y);
					assert.equal(rendered.text, shape.text);
					assert.equal(rendered.horizontalAlign, horizontalAlign);
				}
				assert.ok(hitShape(shape, center, 0));
				assert.equal(display.selections[0].rotation, shape.rotation);
				assert.deepEqual(shape, before);
			}
		}
	}
});

test("symbol references and values use their combined rotation and retain their world centers", () => {
	for (const [degrees] of angles) {
		const symbol = {
			...createSymbol(2, symbolDefinitions[0], { x: 30, y: 40 }),
			rotation: radians(degrees),
			textAlignments: {
				reference: { horizontalAlign: "left", verticalAlign: "top" },
			} as const,
			childOverrides: { "attribute:reference": { rotation: radians(45) } },
		};
		const before = structuredClone(symbol);
		const display = buildDrawingDisplay([symbol], new Set(), [symbol]);
		for (const parent of [display.shapes[0], display.previews[0]]) {
			assert.equal(parent.rotation, symbol.rotation);
			for (const [index, label] of parent.children!.entries()) {
				const worldRotation = parent.rotation + label.rotation;
				assert.ok(
					worldRotation > -Math.PI / 2 - 1e-9 &&
						worldRotation <= Math.PI / 2 + 1e-9,
				);
				const source = symbolTextShapes(symbol)[index];
				close(Math.sin(worldRotation - source.rotation), 0);
				const center = textCenter(source);
				const x = label.x * parent.width,
					y = label.y * parent.height;
				close(
					parent.x +
						x * Math.cos(parent.rotation) -
						y * Math.sin(parent.rotation),
					center.x,
				);
				close(
					parent.y +
						x * Math.sin(parent.rotation) +
						y * Math.cos(parent.rotation),
					center.y,
				);
			}
		}
		assert.deepEqual(symbol, before);
	}
});

test("static symbol text and pin labels stay upright in committed shapes and previews", () => {
	for (const [degrees] of angles) {
		const symbol = {
			...createSymbol(2, symbolDefinitions[0], { x: 30, y: 40 }),
			rotation: radians(degrees),
		};
		symbol.children.push({ ...text, id: 99, rotation: radians(45) });
		const display = buildDrawingDisplay([symbol], new Set(), [symbol]);
		const source = symbolShapes(symbol).find((child) => child.kind === "text")!;
		for (const shapes of [display.connections, display.previews]) {
			const staticText = shapes.find((shape) => shape.text === text.text)!;
			assert.ok(Math.cos(staticText.rotation) >= -1e-9);
			close(Math.sin(staticText.rotation - source.rotation), 0);
			assert.deepEqual(
				{ x: staticText.x, y: staticText.y },
				textCenter(source),
			);
			for (const pin of shapes.filter(
				(shape) => shape.geometry.kind === "pin",
			)) {
				for (const label of pin.children ?? [])
					close(pin.rotation + label.rotation, 0);
			}
		}
	}
});
