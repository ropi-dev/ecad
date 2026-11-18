import assert from "node:assert/strict";
import test from "node:test";
import { drawShape, PIN_RADIUS } from "@ecad/drawing-core/drawing/shapes.ts";
import {
	Group,
	type Mesh,
	type MeshBasicMaterial,
	Raycaster,
	Vector3,
} from "three";
import type { DrawingAppearance } from "#/drawing/display.ts";
import { buildDrawingDisplay } from "#/drawing/display.ts";
import { darkSchematicTheme } from "#/drawing/schematic-theme.ts";
import { createSymbolFromShapes } from "#/drawing/symbols.ts";
import { buildWorksheetDisplay } from "#/drawing/worksheet.ts";
import { createDrawingRenderer } from "#/engine/drawing/renderer.ts";

const hex = (appearance: DrawingAppearance) =>
	darkSchematicTheme.appearance[appearance].slice(1);

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
});

test("junction dots count wire branches and ignore bends, lines, and bare crossings", () => {
	const wire = (id: number, x: number, y: number, endX: number, endY: number) =>
		drawShape(id, "wire", { x, y }, { x: endX, y: endY });
	const trunk = wire(1, -10, 0, 10, 0);
	const branch = wire(2, 0, 0, 0, 10);
	const display = buildDrawingDisplay([trunk, branch], new Set());
	assert.equal(display.junctions.length, 1);
	assert.ok(Math.abs(display.junctions[0].x) < 1e-10);
	assert.ok(Math.abs(display.junctions[0].y) < 1e-10);
	assert.deepEqual(
		display.junctions.map(({ width, height, appearance }) => ({
			width,
			height,
			appearance,
		})),
		[{ width: PIN_RADIUS * 2, height: PIN_RADIUS * 2, appearance: "wire" }],
	);
	assert.equal(
		buildDrawingDisplay([trunk, branch], new Set([trunk.id])).junctions[0]
			.appearance,
		"selected",
	);
	assert.equal(
		buildDrawingDisplay(
			[trunk, { ...branch, y: 0.00001 + branch.y }],
			new Set(),
		).junctions.length,
		1,
	);
	assert.equal(
		buildDrawingDisplay([trunk, { ...branch, x: 11 }], new Set()).junctions
			.length,
		0,
	);
	assert.equal(
		buildDrawingDisplay([trunk, { ...branch, kind: "line" }], new Set())
			.junctions.length,
		0,
	);
	assert.equal(
		buildDrawingDisplay([trunk, wire(2, 0, -10, 0, 10)], new Set()).junctions
			.length,
		0,
	);
	assert.equal(
		buildDrawingDisplay([wire(1, -10, 0, 0, 0), branch], new Set()).junctions
			.length,
		0,
	);
	assert.equal(
		buildDrawingDisplay(
			[wire(1, -10, 0, 0, 0), wire(2, 0, 0, 10, 0)],
			new Set(),
		).junctions.length,
		0,
	);
	const fourWay = [
		wire(1, -10, 0, 0, 0),
		wire(2, 0, 0, 10, 0),
		branch,
		wire(4, 0, 0, 0, -10),
	];
	assert.equal(buildDrawingDisplay(fourWay, new Set()).junctions.length, 1);
	assert.equal(
		buildDrawingDisplay(
			[wire(1, 0, 10, 0, -10), wire(2, -10, 0, 0, 0)],
			new Set(),
		).junctions.length,
		1,
	);
	assert.equal(
		buildDrawingDisplay([trunk, wire(2, 0, 0, 0, 0)], new Set()).junctions
			.length,
		0,
	);
});

test("unconnected crossings render an arch and gap without changing the document", () => {
	for (const reversed of [false, true]) {
		const horizontal = drawShape(
			1,
			"wire",
			{ x: reversed ? 10 : -10, y: 0 },
			{ x: reversed ? -10 : 10, y: 0 },
		);
		const vertical = drawShape(
			2,
			"wire",
			{ x: 0, y: reversed ? 10 : -10 },
			{ x: 0, y: reversed ? -10 : 10 },
		);
		const shapes = [vertical, horizontal];
		const before = structuredClone(shapes);
		const display = buildDrawingDisplay(shapes, new Set([horizontal.id]));
		assert.deepEqual(shapes, before);
		assert.equal(display.junctions.length, 0);
		assert.equal(display.shapes[1].appearance, "selected");
		const renderer = createDrawingRenderer(null);
		const root = new Group();
		try {
			renderer.update(root, display);
			root.updateMatrixWorld(true);
			const horizontalMesh = root.getObjectByName("wire 1") as Mesh;
			const verticalMesh = root.getObjectByName("wire 2") as Mesh;
			const hit = (mesh: Mesh, x: number, y: number) =>
				new Raycaster(
					new Vector3(x, y, 10),
					new Vector3(0, 0, -1),
				).intersectObject(mesh).length > 0;
			assert.equal(hit(horizontalMesh, 0, 0), false);
			assert.equal(hit(horizontalMesh, 0, PIN_RADIUS * 3), true);
			assert.equal(hit(verticalMesh, 0, 0), true);
			assert.equal(hit(verticalMesh, 0, PIN_RADIUS * 3), false);
			assert.equal(hit(verticalMesh, 0, 2), true);
			let disposals = 0;
			horizontalMesh.geometry.addEventListener("dispose", () => disposals++);
			const pin = drawShape(3, "pin", { x: 0, y: 0 }, { x: 0, y: 0 });
			const connected = buildDrawingDisplay([...shapes, pin], new Set());
			assert.equal(connected.junctions.length, 1);
			renderer.update(root, connected);
			root.updateMatrixWorld(true);
			assert.equal(disposals, 1);
			assert.equal(hit(root.getObjectByName("wire 1") as Mesh, 0, 0), true);
		} finally {
			renderer.dispose();
		}
	}
});

test("pin halos follow wire connections, disconnections, and coincident pins", () => {
	const pin = drawShape(1, "pin", { x: 10, y: 0 }, { x: 10, y: 0 });
	const wire = drawShape(2, "wire", { x: 0, y: 0 }, { x: 20, y: 0 });
	const halo = () => buildDrawingDisplay([pin], new Set()).halos[0];
	assert.equal(halo().appearance, "pin");
	assert.ok(halo().width > pin.width);
	assert.equal(buildDrawingDisplay([pin, wire], new Set()).halos.length, 0);
	assert.equal(
		buildDrawingDisplay([pin, { ...wire, y: 0.00001 }], new Set()).halos.length,
		0,
	);
	assert.equal(
		buildDrawingDisplay([pin, { ...wire, y: 1 }], new Set()).halos.length,
		1,
	);
	assert.equal(
		buildDrawingDisplay([pin, { ...pin, id: 3 }], new Set()).halos.length,
		0,
	);
	assert.equal(
		buildDrawingDisplay([pin], new Set([pin.id])).halos[0].appearance,
		"selected",
	);
});

test("worksheet layout produces page edges and labels without canvas or Three objects", () => {
	const display = buildWorksheetDisplay({
		width: 210,
		height: 297,
		name: "A4",
	});
	assert.match(display.name, /\bA4\b/);
	assert.deepEqual(display.edge.slice(0, 2), [
		{ x: -105, y: -148.5 },
		{ x: 105, y: -148.5 },
	]);
	assert.ok(display.labels.some(({ text }) => /\bA4\b/.test(text)));
	assert.ok(display.labels.some(({ text }) => text === "A"));
	assert.throws(
		() => buildWorksheetDisplay({ width: 0, height: 10 }),
		RangeError,
	);
});

test("net highlighting follows connected and named wires without selecting components or crossing nets", () => {
	const wire = (id: number, x: number, y: number, endX: number, endY: number) =>
		drawShape(id, "wire", { x, y }, { x: endX, y: endY });
	const first = wire(1, 0, 0, 20, 0);
	const bend = wire(2, 20, 0, 20, 20);
	const remote = wire(3, 60, 0, 80, 0);
	const crossing = wire(4, 10, -10, 10, 10);
	const label = {
		id: 5,
		kind: "text" as const,
		x: 20,
		y: 20,
		width: 20,
		height: 5,
		fontSize: 3,
		lineWidth: 0.3,
		rotation: 0,
		text: "SIGNAL",
		electrical: "net" as const,
	};
	const otherLabel = { ...label, id: 6, x: 60, y: 0 };
	const symbol = createSymbolFromShapes(8, [
		drawShape(7, "rectangle", { x: 0, y: 0 }, { x: 10, y: 10 }),
	]);
	const component = { ...symbol, id: 8 };
	const shapes = [first, bend, remote, crossing, label, otherLabel, component];
	const display = buildDrawingDisplay(shapes, new Set([1]));
	assert.deepEqual(
		display.shapes.map((shape) => shape.appearance),
		[
			"selected",
			"highlighted",
			"highlighted",
			"wire",
			"label",
			"label",
			"stroke",
		],
	);
	const fromLabel = buildDrawingDisplay(shapes, new Set([5]));
	assert.deepEqual(
		fromLabel.shapes.slice(0, 4).map((shape) => shape.appearance),
		["highlighted", "highlighted", "highlighted", "wire"],
	);
	assert.ok(
		buildDrawingDisplay(shapes, new Set()).shapes.every(
			(shape) => shape.appearance !== "highlighted",
		),
	);
	const renderer = createDrawingRenderer(null);
	const root = new Group();
	renderer.update(root, {
		...display,
		shapes: display.shapes.filter((shape) => shape.geometry.kind === "wire"),
	});
	const color = (name: string) =>
		(
			(root.getObjectByName(name) as Mesh).material as MeshBasicMaterial
		).color.getHexString();
	assert.equal(color("wire 1"), hex("selected"));
	assert.equal(color("wire 2"), hex("highlighted"));
	assert.equal(color("wire 4"), hex("wire"));
	renderer.dispose();
});
