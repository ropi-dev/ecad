import assert from "node:assert/strict";
import { test } from "node:test";
import { Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { createShapeGeometry } from "../src/components/editor/shapeGeometry.ts";
import { drawShape, editShapeAttribute, hitShape, intersectsSelection, moveShapes, normalizeWireSegments, pinTerminals, resizeHandles, selectionSize, symbolShapes, symbolTextShapes } from "../src/components/editor/shapes.ts";
import { createSymbol, symbolDefinitions } from "../src/components/editor/symbols.ts";

for (const definition of symbolDefinitions) {
	test(`${definition.name} selects through each child and renders all its strokes`, () => {
		const symbol = createSymbol(1, definition, { x: 50, y: 60 });
		assert.deepEqual(symbolTextShapes(symbol).map((label) => label.text), [`${definition.prefix}1`, definition.value]);
		assert.equal(Math.max(symbol.width, symbol.height), 6.4);
		for (const terminal of pinTerminals(symbol)) {
			assert.equal(terminal.x, Math.round(terminal.x));
			assert.equal(terminal.y, Math.round(terminal.y));
		}
		const selection = selectionSize(symbol);
		assert.equal(selection.width, symbol.width + 0.5);
		assert.equal(selection.height, symbol.height + 0.5);
		for (const angle of [0, 90, 180, 270]) {
			const rotated = editShapeAttribute(symbol, "angle", angle);
			for (const [x, y, expected] of [
				[0, 0, true],
				[selection.width / 2 - 0.01, selection.height / 2 - 0.01, true],
				[20, 0, false],
				[0, 20, false],
			] as const) {
				const point = {
					x: rotated.x + x * Math.cos(rotated.rotation) - y * Math.sin(rotated.rotation),
					y: rotated.y + x * Math.sin(rotated.rotation) + y * Math.cos(rotated.rotation),
				};
				assert.equal(hitShape(rotated, point, 0), expected);
				assert.equal(intersectsSelection(rotated, { minX: point.x, maxX: point.x, minY: point.y, maxY: point.y }), expected);
			}
		}

		const geometry = createShapeGeometry(symbol);
		const material = new MeshBasicMaterial();
		const mesh = new Mesh(geometry, material);
		mesh.scale.set(symbol.width, symbol.height, 1);
		mesh.position.set(symbol.x, symbol.y, 0);
		mesh.updateMatrixWorld();
		try {
			for (const child of symbolShapes(symbol)) {
				const point = { x: child.x, y: child.y - (child.kind === "rectangle" ? child.height / 2 : 0) };
				assert.equal(hitShape(symbol, point, 0.1), true);
				assert.equal(intersectsSelection(symbol, { minX: point.x - 0.1, maxX: point.x + 0.1, minY: point.y - 0.1, maxY: point.y + 0.1 }), true);
				assert.ok(new Raycaster(new Vector3(point.x, point.y, 10), new Vector3(0, 0, -1)).intersectObject(mesh).length > 0);
			}
			assert.equal(hitShape(symbol, { x: 500, y: 500 }, 0.1), false);
			assert.deepEqual(resizeHandles(symbol), []);
		} finally {
			geometry.dispose();
			material.dispose();
		}
	});
}

test("symbols move rigidly, snap by their origin, and never merge with external lines", () => {
	const symbol = createSymbol(1, symbolDefinitions[0], { x: 1, y: 2 });
	const external = drawShape(2, "wire", { x: 21, y: 2 }, { x: 40, y: 2 });
	const moved = moveShapes([symbol], { x: 10, y: 10 }, 5, symbol, [symbol, external]);
	assert.equal(moved.length, 1);
	const next = moved[0];
	assert.equal(next.kind, "symbol");
	if (next.kind !== "symbol") return;
	assert.equal(next.x, 10);
	assert.equal(next.y, 10);
	assert.deepEqual(next.children, symbol.children);
	assert.deepEqual(symbolShapes(next).map(({ x, y }) => [x, y]), symbolShapes(symbol).map(({ x, y }) => [x + 9, y + 8]));
	assert.deepEqual(normalizeWireSegments([symbol, external]).shapes, [symbol, external]);
	const mixed = moveShapes([symbol, external], { x: 3, y: 4 });
	assert.equal(mixed[0].x, symbol.x + 3);
	assert.equal(mixed[0].y, symbol.y + 4);
});

test("rotation transforms symbol children and instances own their attributes", () => {
	const symbol = createSymbol(1, symbolDefinitions[0], { x: 50, y: 60 });
	const second = createSymbol(2, symbolDefinitions[0], { x: 0, y: 0 });
	const rotated = editShapeAttribute(symbol, "angle", 90);
	assert.equal(hitShape(rotated, { x: 50, y: 57.6 }, 0.1), true);
	assert.equal(hitShape(rotated, { x: 35, y: 60 }, 0.1), false);
	assert.equal(intersectsSelection(rotated, { minX: 49, maxX: 51, minY: 57.5, maxY: 57.7 }), true);
	symbol.attributes.value = "22 kΩ";
	symbol.children[0].width = 999;
	assert.equal(second.attributes.value, "10 kΩ");
	assert.ok(Math.abs(second.children[0].width - 1) < 1e-12);
	assert.ok(Math.abs(symbolDefinitions[0].children[0].width - 1) < 1e-12);
});

test("symbol text resolves reference and value from each instance", () => {
	const first = createSymbol(1, symbolDefinitions[0], { x: 50, y: 60 });
	const second = createSymbol(2, symbolDefinitions[0], { x: 100, y: 60 });
	assert.deepEqual(symbolTextShapes(first).map((label) => label.text), ["R1", "10 kΩ"]);
	first.attributes.reference = "R_INPUT";
	first.attributes.value = "47 kΩ";
	assert.deepEqual(symbolTextShapes(first).map((label) => label.text), ["R_INPUT", "47 kΩ"]);
	assert.deepEqual(symbolTextShapes(second).map((label) => label.text), ["R2", "10 kΩ"]);
	const moved = moveShapes([first], { x: 10, y: 5 })[0];
	assert.equal(moved.kind, "symbol");
	if (moved.kind !== "symbol") return;
	for (const [index, label] of symbolTextShapes(moved).entries()) {
		assert.ok(Math.abs(label.x - symbolTextShapes(first)[index].x - 10) < 1e-10);
		assert.ok(Math.abs(label.y - symbolTextShapes(first)[index].y - 5) < 1e-10);
	}
	const label = symbolTextShapes(moved)[0];
	assert.equal(hitShape(moved, { x: label.x, y: label.y }, 0), true);
	assert.equal(intersectsSelection(moved, { minX: label.x, maxX: label.x, minY: label.y, maxY: label.y }), true);
	const rotated = editShapeAttribute(moved, "angle", 90);
	assert.equal(rotated.kind, "symbol");
	if (rotated.kind !== "symbol") return;
	const rotatedLabel = symbolTextShapes(rotated)[0];
	assert.ok(Math.abs(rotatedLabel.x - (rotated.x - moved.texts[0].y)) < 1e-10);
	assert.ok(Math.abs(rotatedLabel.y - (rotated.y + moved.texts[0].x)) < 1e-10);
	first.attributes.reference = "";
	assert.deepEqual(symbolTextShapes(first).map((text) => text.text), ["47 kΩ"]);
});
