import assert from "node:assert/strict";
import { test } from "node:test";
import { Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { createShapeGeometry } from "../src/components/editor/shapeGeometry.ts";
import { drawShape, hitShape, intersectsSelection, moveShapes, normalizeWireSegments, resizeHandles, resizeShape } from "../src/components/editor/shapes.ts";

for (const kind of ["rectangle", "circle", "triangle"] as const) {
	test(`${kind} has an empty center and a constant-width mesh outline`, () => {
		const shape = { ...drawShape(1, kind, { x: 0, y: 0 }, { x: 80, y: 40 }), lineWidth: 4 };
		const geometry = createShapeGeometry(shape);
		const material = new MeshBasicMaterial();
		const mesh = new Mesh(geometry, material);
		mesh.scale.set(shape.width, shape.height, 1);
		mesh.updateMatrixWorld();
		const hits = (x: number, y: number) => new Raycaster(new Vector3(x, y, 10), new Vector3(0, 0, -1)).intersectObject(mesh).length > 0;
		try {
			assert.equal(hits(0, 0), false);
			const edge = -shape.height / 2;
			assert.equal(hits(0, edge + 1.5), true);
			assert.equal(hits(0, edge - 1.5), true);
			assert.equal(hits(0, edge + 2.5), false);
			assert.equal(hits(0, edge - 2.5), false);
			if (kind === "rectangle") {
				assert.equal(hits(shape.width / 2 - 1.5, 0), true);
				assert.equal(hits(shape.width / 2 - 2.5, 0), false);
			}
		} finally {
			geometry.dispose();
			material.dispose();
		}
	});
}

test("wire width survives resizing, connected movement and merging", () => {
	const line = { ...drawShape(1, "wire", { x: 0, y: 0 }, { x: 20, y: 0 }), lineWidth: 3 };
	const neighbor = { ...drawShape(2, "wire", { x: 20, y: 0 }, { x: 20, y: 20 }), lineWidth: 2 };
	for (const handle of resizeHandles(line)) assert.equal(resizeShape(line, handle, { x: 5, y: 0 }).lineWidth, 3);
	const moved = moveShapes([line], { x: 0, y: 5 }, 0, line, [line, neighbor]);
	assert.deepEqual(moved.map((shape) => shape.lineWidth), [3, 2]);
	const continuation = { ...drawShape(3, "wire", { x: 20, y: 0 }, { x: 40, y: 0 }), lineWidth: 3 };
	const merged = normalizeWireSegments([line, continuation]).shapes;
	assert.equal(merged.length, 1);
	assert.equal(merged[0].lineWidth, 3);
	assert.equal(merged[0].width, 40);
});

test("wire selection uses the independent width attribute", () => {
	const line = { ...drawShape(1, "wire", { x: 0, y: 0 }, { x: 20, y: 0 }), lineWidth: 8 };
	assert.equal(hitShape(line, { x: 10, y: 3 }, 0), true);
	assert.equal(hitShape(line, { x: 10, y: 5 }, 0), false);
	assert.equal(intersectsSelection(line, { minX: 5, maxX: 15, minY: 3, maxY: 6 }), true);
});
