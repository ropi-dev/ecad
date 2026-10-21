import assert from "node:assert/strict";
import test from "node:test";
import { Group, LineLoop, type Mesh, type MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { buildDrawingDisplay } from "#/drawing/display.ts";
import { drawShape, pinTerminals } from "#/drawing/shapes.ts";
import { createSymbolFromShapes } from "#/drawing/symbols.ts";
import { buildWorksheetDisplay } from "#/drawing/worksheet.ts";
import { createDrawingRenderer } from "#/engine/drawing/renderer.ts";

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
		[{ x: 40, y: 0, width: 0.508, height: 0.508, appearance: "selected", renderOrder: 4 }],
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

test("pin halos follow wire connections, disconnections, and coincident pins", () => {
	const pin = drawShape(1, "pin", { x: 10, y: 0 }, { x: 10, y: 0 });
	const wire = drawShape(2, "wire", { x: 0, y: 0 }, { x: 20, y: 0 });
	const halo = () => buildDrawingDisplay([pin], new Set()).halos[0];
	assert.equal(halo().appearance, "pin");
	assert.ok(halo().width > pin.width);
	assert.equal(buildDrawingDisplay([pin, wire], new Set()).halos.length, 0);
	assert.equal(buildDrawingDisplay([pin, { ...wire, y: 0.00001 }], new Set()).halos.length, 0);
	assert.equal(buildDrawingDisplay([pin, { ...wire, y: 1 }], new Set()).halos.length, 1);
	assert.equal(buildDrawingDisplay([pin, { ...pin, id: 3 }], new Set()).halos.length, 0);
	assert.equal(buildDrawingDisplay([pin], new Set([pin.id])).halos[0].appearance, "selected");
});

test("rotated symbol leads use the body color while external wires keep their distinct color", () => {
	const pin = drawShape(1, "pin", { x: 0, y: 0 }, { x: 0, y: 0 });
	const innerWire = drawShape(2, "wire", { x: 0, y: 0 }, { x: 10, y: 0 });
	const symbol = { ...createSymbolFromShapes(3, [pin, innerWire]), rotation: Math.PI / 2 };
	const [terminal] = pinTerminals(symbol);
	const display = buildDrawingDisplay([symbol], new Set(), [symbol]);
	assert.deepEqual(display.connections.map(({ appearance }) => appearance), ["pin", "stroke"]);
	assert.equal(display.halos[0].x, terminal.x);
	assert.equal(display.halos[0].y, terminal.y);
	assert.equal(display.connections[1].rotation, Math.PI / 2);
	assert.equal(display.previews.length, 3);
	assert.ok(display.previews.every(({ appearance }) => appearance === "selected"));
	assert.equal(new Set(display.previews.map(({ key }) => key)).size, 3);
	const external = drawShape(4, "wire", terminal, { x: terminal.x + 10, y: terminal.y });
	assert.equal(buildDrawingDisplay([symbol, external], new Set()).halos.length, 0);
	assert.ok(buildDrawingDisplay([symbol], new Set([symbol.id])).connections.every(({ appearance }) => appearance === "selected"));
	const renderer = createDrawingRenderer(null);
	const root = new Group();
	try {
		renderer.update(root, buildDrawingDisplay([symbol, external], new Set()));
		const color = (name: string) => (root.getObjectByName(name) as Mesh<never, MeshBasicMaterial>).material.color.getHexString();
		assert.equal(color("wire 3:2"), color("symbol 3"));
		assert.equal(color("wire 3:2"), "76c4c0");
		assert.equal(color("wire 4"), "ef8f9c");
	} finally {
		renderer.dispose();
	}
});

test("renderer uses shape colors for pins and hollow halos while wires keep their distinct color", () => {
	const renderer = createDrawingRenderer(null);
	const root = new Group();
	const pin = drawShape(1, "pin", { x: 0, y: 0 }, { x: 0, y: 0 });
	const wire = drawShape(2, "wire", { x: 10, y: 0 }, { x: 20, y: 0 });
	const line = drawShape(3, "line", { x: 0, y: 10 }, { x: 20, y: 10 });
	try {
		renderer.update(root, buildDrawingDisplay([pin, wire, line], new Set()));
		const color = (name: string) => (root.getObjectByName(name) as Mesh<never, MeshBasicMaterial>).material.color.getHexString();
		assert.equal(color("pin 1"), "76c4c0");
		assert.equal(color("wire 2"), "ef8f9c");
		assert.equal(color("line 3"), "76c4c0");
		assert.equal(color("editor-pin-halo"), color("line 3"));
		const halo = root.getObjectByName("editor-pin-halo") as Mesh;
		root.updateMatrixWorld(true);
		const hit = (x: number) => new Raycaster(new Vector3(x, 0, 10), new Vector3(0, 0, -1)).intersectObject(halo).length > 0;
		assert.equal(hit(0), false);
		assert.equal(hit(0.46), true);
		let disposals = 0;
		halo.geometry.addEventListener("dispose", () => disposals++);
		renderer.update(root, buildDrawingDisplay([pin, { ...wire, x: 5 }], new Set()));
		assert.equal(root.getObjectByName("editor-pin-halo"), undefined);
		assert.equal(disposals, 1);
		renderer.update(root, buildDrawingDisplay([pin, wire], new Set([pin.id, wire.id])));
		assert.equal(color("pin 1"), "e8b77e");
		assert.equal(color("wire 2"), "e8b77e");
	} finally {
		renderer.dispose();
	}
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
