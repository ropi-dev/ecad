import assert from "node:assert/strict";
import { test } from "node:test";
import { Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { buildDrawingDisplay } from "#/drawing/display.ts";
import { drawShape } from "#/drawing/shapes.ts";
import { createSymbolFromShapes } from "#/drawing/symbols.ts";
import { createShapeGeometry } from "#/engine/drawing/shapeGeometry.ts";

for (const kind of ["line", "wire"] as const) {
	for (const length of [0.5, 40]) {
		for (const grouped of [false, true]) {
			test(`${kind} of length ${length} has circular caps${grouped ? " inside a symbol" : ""}`, () => {
				const rotation = Math.PI / 4;
				const line = {
					...drawShape(1, kind, { x: 0, y: 0 }, { x: length, y: 0 }),
					lineWidth: 4,
					rotation,
				};
				const shape = grouped ? createSymbolFromShapes(2, [line]) : line;
				const display = buildDrawingDisplay([shape], new Set()).shapes[0];
				const geometry = createShapeGeometry(display.geometry);
				const material = new MeshBasicMaterial();
				const mesh = new Mesh(geometry, material);
				mesh.scale.set(display.width, display.height, 1);
				mesh.rotation.z = display.rotation;
				mesh.position.set(display.x, display.y, 0);
				mesh.updateMatrixWorld();
				const hits = (x: number, y: number) => {
					const point = new Vector3(
						line.x + x * Math.cos(rotation) - y * Math.sin(rotation),
						line.y + x * Math.sin(rotation) + y * Math.cos(rotation),
						10,
					);
					return new Raycaster(point, new Vector3(0, 0, -1))
						.intersectObject(mesh).length > 0;
				};
				try {
					assert.equal(hits(0, 1.9), true);
					assert.equal(hits(0, 2.1), false);
					for (const end of [-1, 1]) {
						assert.equal(hits(end * (length / 2 + 1.9), 0), true);
						assert.equal(hits(end * (length / 2 + 2.1), 0), false);
						assert.equal(hits(end * (length / 2 + 1.3), 1.3), true);
						assert.equal(hits(end * (length / 2 + 1.6), 1.6), false);
					}
				} finally {
					geometry.dispose();
					material.dispose();
				}
			});
		}
	}
}
