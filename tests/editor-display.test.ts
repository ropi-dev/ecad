import assert from "node:assert/strict";
import test from "node:test";
import { Group, LineLoop, type Mesh } from "three";
import { buildDrawingDisplay } from "../src/drawing/display.ts";
import { drawShape } from "../src/drawing/shapes.ts";
import { buildWorksheetDisplay } from "../src/drawing/worksheet.ts";
import { createDrawingRenderer } from "../src/engine/drawing/renderer.ts";

test("display resolves wire stroke dimensions, selection, and drawing order without a browser", () => {
	const rectangle = drawShape(1, "rectangle", { x: 0, y: 0 }, { x: 20, y: 10 });
	const wire = {
		...drawShape(2, "wire", { x: 40, y: 0 }, { x: 40, y: 30 }),
		lineWidth: 0.8,
	};
	const shapes = [rectangle, wire];
	const before = structuredClone(shapes);
	const display = buildDrawingDisplay(shapes, new Set([wire.id]));
	assert.deepEqual(shapes, before);
	assert.deepEqual(
		display.shapes.map(({ name, appearance, renderOrder }) => ({
			name,
			appearance,
			renderOrder,
		})),
		[
			{ name: "rectangle 1", appearance: "stroke", renderOrder: 1 },
			{ name: "wire 2", appearance: "selected", renderOrder: 2 },
		],
	);
	assert.equal(display.shapes[1].height, wire.lineWidth);
	assert.equal(display.shapes[1].rotation, Math.PI / 2);
	assert.deepEqual(display.selections, [
		{
			shapeKey: "shape:2",
			x: 40,
			y: 15,
			width: 34,
			height: 4.8,
			rotation: Math.PI / 2,
			renderOrder: 3,
		},
	]);
});

test("display suppresses connected terminals and colors each remaining wire end", () => {
	const first = drawShape(1, "wire", { x: 0, y: 0 }, { x: 20, y: 0 });
	const next = drawShape(2, "wire", { x: 20, y: 0 }, { x: 40, y: 0 });
	const pin = drawShape(3, "pin", { x: 0, y: 0 }, { x: 0, y: 0 });
	const display = buildDrawingDisplay([first, next, pin], new Set([next.id]));
	assert.equal(display.terminals.length, 1);
	assert.deepEqual(
		display.terminals.map(({ x, y, width, height, appearance, renderOrder }) => ({
			x,
			y,
			width,
			height,
			appearance,
			renderOrder,
		})),
		[{ x: 40, y: 0, width: 2, height: 2, appearance: "selected", renderOrder: 4 }],
	);
});

test("preview display uses separate resources from document shapes and skips empty gestures", () => {
	const rectangle = drawShape(1, "rectangle", { x: 0, y: 0 }, { x: 20, y: 10 });
	const preview = { ...rectangle, x: 30 };
	const empty = { ...rectangle, id: 2, width: 0 };
	const display = buildDrawingDisplay([rectangle], new Set(), [preview, empty]);
	assert.equal(display.previews.length, 1);
	assert.equal(display.previews[0].key, "preview:1");
	assert.equal(display.shapes[0].key, "shape:1");
	assert.equal(display.previews[0].name, "editor-shape-preview");
	assert.equal(display.previews[0].appearance, "selected");
	assert.equal(display.previews[0].renderOrder, 3);
	assert.equal(display.shapes[0].x, 10);
	assert.equal(display.previews[0].x, 30);
});

test("worksheet layout produces page edges and labels without canvas or Three objects", () => {
	const display = buildWorksheetDisplay({ width: 210, height: 297, name: "A4" });
	assert.equal(display.name, "A4, 210 × 297 mm");
	assert.deepEqual(display.edge.slice(0, 2), [
		{ x: -105, y: -148.5 },
		{ x: 105, y: -148.5 },
	]);
	assert.ok(display.labels.some(({ text }) => text === "Size: A4"));
	assert.ok(display.labels.some(({ text }) => text === "A"));
	assert.throws(() => buildWorksheetDisplay({ width: 0, height: 10 }), RangeError);
});

test("renderer reuses moved geometry and releases replaced, canceled, and owned resources once", () => {
	const renderer = createDrawingRenderer({ name: "test", labels: [], frame: [], edge: [] });
	const root = new Group();
	const rectangle = drawShape(1, "rectangle", { x: 0, y: 0 }, { x: 20, y: 10 });
	const update = (shape = rectangle, previews = [] as typeof rectangle[]) => {
		renderer.update(root, buildDrawingDisplay([shape], new Set([shape.id]), previews));
		return root.getObjectByName("rectangle 1") as Mesh;
	};
	const original = update();
	const geometry = original.geometry;
	let oldDisposals = 0;
	geometry.addEventListener("dispose", () => oldDisposals++);
	const moved = update({ ...rectangle, x: 70 });
	assert.equal(moved.geometry, geometry);
	assert.equal(moved.position.x, 70);
	assert.equal(oldDisposals, 0);
	const selection = root.getObjectByName("editor-shapes")!.children.find((part) => part instanceof LineLoop)!;
	assert.equal(selection.position.x, 70);
	assert.equal(selection.scale.x, rectangle.width + 4);
	const resized = update({ ...rectangle, width: 40 }, [{ ...rectangle, x: 60 }]);
	assert.notEqual(resized.geometry, geometry);
	assert.equal(oldDisposals, 1);
	const preview = root.getObjectByName("editor-shape-preview") as Mesh;
	assert.notEqual(preview.geometry, resized.geometry);
	let previewDisposals = 0;
	preview.geometry.addEventListener("dispose", () => previewDisposals++);
	let currentDisposals = 0;
	resized.geometry.addEventListener("dispose", () => currentDisposals++);
	update({ ...rectangle, width: 40 });
	assert.equal(root.getObjectByName("editor-shape-preview"), undefined);
	assert.equal(previewDisposals, 1);
	assert.equal(currentDisposals, 0);
	renderer.dispose();
	renderer.dispose();
	assert.equal(currentDisposals, 1);
	assert.equal(previewDisposals, 1);
	assert.equal(oldDisposals, 1);
	assert.equal(root.children.length, 0);
});
