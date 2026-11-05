import assert from "node:assert/strict";
import test from "node:test";
import {
	redoEffect,
	replaceShapesEffect,
	undoEffect,
} from "@ecad/drawing-core/commands/drawing-commands.ts";
import {
	createDrawingStore,
	DrawingStore,
} from "@ecad/drawing-core/commands/drawing-store.ts";
import {
	containsSelection,
	drawShape,
	editShapeAttribute,
	hitShape,
	intersectsSelection,
	type PinShape,
	pinTerminals,
	shapeBounds,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { Effect } from "effect";
import { Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import {
	parseSymbolFile,
	symbolFileFromSymbol,
} from "#/components/editor/symbolFormat.ts";
import { buildDrawingDisplay } from "#/drawing/display.ts";
import { libraryDefinitions } from "#/drawing/symbol-file.ts";
import { createSymbolFromShapes } from "#/drawing/symbols.ts";
import { createShapeGeometry } from "#/engine/drawing/shapeGeometry.ts";
import { validateProjectDocument } from "#/projects/format.ts";
import { required } from "./helpers/required.ts";

test("pins own their leads, bounds, selection, and labels while only the exposed end connects", () => {
	const base = drawShape(1, "pin", { x: 10, y: 20 }, { x: 10, y: 20 });
	assert.equal(base.kind, "pin");
	if (base.kind !== "pin") throw new Error("Expected a pin");
	assert.equal(base.length, 2.54);
	for (const angle of [0, 90, 180, -90]) {
		const pin: PinShape = {
			...editShapeAttribute(base, "angle", angle),
			kind: "pin" as const,
			name: "SWCLK",
			number: "24",
		};
		const dx = Math.cos(pin.rotation),
			dy = Math.sin(pin.rotation);
		const mid = { x: pin.x + dx, y: pin.y + dy };
		assert.ok(hitShape(pin, mid, 0.1));
		assert.ok(!hitShape(pin, { x: mid.x - dy, y: mid.y + dx }, 0.1));
		assert.deepEqual(pinTerminals(pin), [{ x: 10, y: 20 }]);
		const box = shapeBounds(pin);
		assert.ok(
			mid.x >= box.minX &&
				mid.x <= box.maxX &&
				mid.y >= box.minY &&
				mid.y <= box.maxY,
		);
		assert.ok(
			intersectsSelection(pin, {
				minX: mid.x - 0.1,
				maxX: mid.x + 0.1,
				minY: mid.y - 0.1,
				maxY: mid.y + 0.1,
			}),
		);
		assert.ok(
			!containsSelection(pin, {
				minX: 9.5,
				maxX: 10.5,
				minY: 19.5,
				maxY: 20.5,
			}),
		);
		const [display] = buildDrawingDisplay([pin], new Set()).shapes;
		const geometry = createShapeGeometry(display.geometry);
		const material = new MeshBasicMaterial();
		try {
			const mesh = new Mesh(geometry, material);
			mesh.position.set(pin.x, pin.y, 0);
			mesh.rotation.z = pin.rotation;
			mesh.scale.set(pin.width, pin.height, 1);
			mesh.updateMatrixWorld(true);
			assert.ok(
				new Raycaster(
					new Vector3(mid.x, mid.y, 10),
					new Vector3(0, 0, -1),
				).intersectObject(mesh).length,
			);
		} finally {
			geometry.dispose();
			material.dispose();
		}
		const [name, number] = required(display.children);
		assert.ok(name.x * pin.width - (name.width * pin.width) / 2 > 2);
		assert.equal(name.y, 0);
		assert.ok(Math.abs(number.x * pin.width - base.length / 2) < 1e-9);
		const textAngle = pin.rotation + name.rotation;
		assert.ok(
			textAngle > -Math.PI / 2 - 1e-9 && textAngle <= Math.PI / 2 + 1e-9,
		);
		const longer = editShapeAttribute(pin, "length", 4);
		assert.ok(longer.kind === "pin" && longer.length === 4);
	}
});

test("lead length and orientation survive symbol and project saves, and missing lengths stay point-only", () => {
	const file = parseSymbolFile(
		JSON.stringify({
			format: "ecad-symbol",
			version: 1,
			units: "mm",
			id: "custom.pin-lead",
			name: "Pin",
			description: "",
			prefix: "U",
			value: "",
			shapes: [
				{
					kind: "pin",
					x: 0,
					y: 0,
					name: "RUN",
					number: "26",
					length: 2,
					rotation: 180,
				},
			],
		}),
	);
	const definition = libraryDefinitions([file])[0];
	const pin = definition.children[0];
	assert.equal(pin.rotation, Math.PI);
	const symbol = createSymbolFromShapes(2, [pin]);
	const saved = parseSymbolFile(JSON.stringify(symbolFileFromSymbol(symbol)));
	const restored = libraryDefinitions([saved])[0].children[0];
	assert.equal(restored.kind, "pin");
	assert.ok("length" in restored && restored.length === 2);
	assert.ok(Math.abs(Math.cos(restored.rotation) + 1) < 1e-9);
	assert.deepEqual(
		validateProjectDocument(
			JSON.parse(JSON.stringify({ shapes: [symbol], symbols: [saved] })),
		),
		{ shapes: [symbol], symbols: [saved] },
	);
	const legacy = parseSymbolFile(
		JSON.stringify({
			...file,
			shapes: [{ kind: "pin", x: 0, y: 0, name: "OLD", number: "1" }],
		}),
	);
	const point = libraryDefinitions([legacy])[0].children[0];
	assert.ok(!("length" in point));
	assert.ok(!hitShape(point, { x: 1, y: 0 }, 0.1));
	assert.throws(() =>
		parseSymbolFile(
			JSON.stringify({ ...file, shapes: [{ ...file.shapes[0], length: -1 }] }),
		),
	);
});

test("lead-only edits commit and participate in undo and redo", () => {
	const pin = drawShape(1, "pin", { x: 0, y: 0 }, { x: 0, y: 0 });
	const store = createDrawingStore([pin]);
	const run = <A, E>(effect: Effect.Effect<A, E, DrawingStore>) =>
		Effect.runSync(effect.pipe(Effect.provideService(DrawingStore, store)));
	run(
		replaceShapesEffect(
			[{ ...pin, kind: "pin", name: "RUN", number: "26", length: 4 }],
			"Change lead",
		),
	);
	const read = () => store.getSnapshot().shapes[0] as PinShape;
	assert.equal(read().length, 4);
	run(undoEffect);
	assert.equal(read().length, 2.54);
	run(redoEffect);
	assert.equal(read().length, 4);
});

test("visibility-only pin edits commit, undo, and redo independently", () => {
	const pin = {
		...drawShape(1, "pin", { x: 0, y: 0 }, { x: 0, y: 0 }),
		kind: "pin" as const,
		name: "RUN",
		number: "01",
		showLabels: false,
	};
	const store = createDrawingStore([pin]);
	const run = <A, E>(effect: Effect.Effect<A, E, DrawingStore>) =>
		Effect.runSync(effect.pipe(Effect.provideService(DrawingStore, store)));
	const read = () => store.getSnapshot().shapes[0] as PinShape;
	for (const field of ["showName", "showNumber"] as const) {
		const before = read();
		run(
			replaceShapesEffect([{ ...before, [field]: true }], "Change visibility"),
		);
		assert.equal(read()[field], true);
		run(undoEffect);
		assert.deepEqual(read(), before);
		run(redoEffect);
		assert.equal(read()[field], true);
	}
	assert.equal(read().showLabels, false);
});
