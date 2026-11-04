import assert from "node:assert/strict";
import test from "node:test";
import {
	BufferGeometry,
	Group,
	LineLoop,
	Material,
	Mesh,
	MeshBasicMaterial,
	type Object3D,
	Texture,
} from "three";
import {
	buildPreviewDisplay,
	buildStaticDisplay,
	type DrawingDisplay,
} from "#/drawing/display.ts";
import {
	drawShape,
	type EditorShape,
	moveShapes,
	type TextShape,
} from "#/drawing/shapes.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";
import { createDrawingRenderer } from "#/engine/drawing/renderer.ts";

// Glyph textures need a 2D canvas. This stand-in measures text by its length.
const context = {
	font: "",
	textBaseline: "",
	textAlign: "",
	fillStyle: "",
	measureText: (text: string) => ({
		width: text.length * 7,
		actualBoundingBoxAscent: 8,
		actualBoundingBoxDescent: 2,
	}),
	fillText() {},
	save() {},
	restore() {},
	translate() {},
	scale() {},
};
globalThis.document = {
	createElement: () => ({ width: 0, height: 0, getContext: () => context }),
} as unknown as Document;

const disposed = new WeakSet<object>();
for (const type of [BufferGeometry, Texture, Material]) {
	const dispose = type.prototype.dispose;
	type.prototype.dispose = function (this: object) {
		disposed.add(this);
		return dispose.call(this);
	};
}

const part = (id: string) =>
	symbolDefinitions.find((definition) => definition.id === id)!;

/** Wires with crossings and junctions, labelled pins, symbols, and net labels. */
function drawing(): EditorShape[] {
	const wire = (id: number, x: number, y: number, endX: number, endY: number) =>
		drawShape(id, "wire", { x, y }, { x: endX, y: endY });
	return [
		...[0, 1, 2, 3].map((index) =>
			wire(1 + index, -30, index * 5, 30, index * 5),
		),
		...[0, 1, 2, 3].map((index) =>
			wire(5 + index, index * 7 - 10, -8, index * 7 - 10, 20),
		),
		wire(9, 4, 5, 4, 30),
		{
			...drawShape(10, "pin", { x: 40, y: 0 }, { x: 40, y: 0 }),
			name: "CLK",
			number: "3",
		} as EditorShape,
		{
			...drawShape(11, "pin", { x: 40, y: 10 }, { x: 40, y: 10 }),
			name: "EN",
			number: "4",
			rotation: Math.PI / 2,
		} as EditorShape,
		createSymbol(12, part("resistor"), { x: -20, y: 30 }),
		{
			...createSymbol(13, part("connector-4"), { x: 10, y: 40 }),
			rotation: Math.PI / 2,
		},
		{
			...createSymbol(14, part("transistor-npn"), { x: 30, y: 40 }),
			rotation: Math.PI,
		},
		{
			...drawShape(15, "rectangle", { x: -40, y: -20 }, { x: -30, y: -10 }),
			filled: true,
		} as EditorShape,
		{
			id: 16,
			kind: "text",
			x: -30,
			y: 15,
			width: 6,
			height: 1.905,
			rotation: 0,
			lineWidth: 0.254,
			fontSize: 1.27,
			text: "NET",
			electrical: "net",
		},
		{
			id: 17,
			kind: "text",
			x: 0,
			y: -20,
			width: 12,
			height: 3,
			rotation: 0,
			lineWidth: 0.254,
			fontSize: 2,
			text: "Notes\nline two",
		},
		drawShape(18, "no-connect", { x: 40, y: 10 }, { x: 40, y: 10 }),
	];
}

const round = (value: number) => Math.round(value * 1e6) / 1e6 || 0;

/** Every property that affects pixels, in traversal order. */
function describe(root: Object3D) {
	root.updateMatrixWorld(true);
	const objects: Object3D[] = [];
	root.traverse((object) => {
		if (object !== root) objects.push(object);
	});
	const index = new Map(objects.map((object, position) => [object, position]));
	const material = (object: Object3D) =>
		object instanceof Mesh || object instanceof LineLoop
			? (object.material as MeshBasicMaterial)
			: undefined;
	const description = objects.map((object) => {
		const paint = material(object);
		const geometry =
			object instanceof Mesh || object instanceof LineLoop
				? (object.geometry as BufferGeometry)
				: undefined;
		return {
			type: object.type,
			name: object.name,
			parent: object.parent === root ? "root" : index.get(object.parent!),
			renderOrder: object.renderOrder,
			matrix: object.matrixWorld.elements.map(round),
			material: paint && {
				color: paint.color.getHexString(),
				transparent: paint.transparent,
				opacity: paint.opacity,
				alphaMap: paint.alphaMap ? true : undefined,
			},
			geometry: geometry && {
				position: [...(geometry.getAttribute("position")?.array ?? [])].map(
					round,
				),
				uv: [...(geometry.getAttribute("uv")?.array ?? [])].map(round),
				index: [...(geometry.getIndex()?.array ?? [])],
			},
		};
	});
	// Three sorts by render order, then material for opaque objects, then ID.
	// Material IDs exist at runtime but are missing from the type declarations.
	const materialId = (object: Object3D) =>
		(material(object) as unknown as { id: number }).id;
	const drawn = objects.filter((object) => material(object));
	const sorted = (transparent: boolean) =>
		drawn
			.filter((object) => material(object)!.transparent === transparent)
			.sort(
				(a, b) =>
					a.renderOrder - b.renderOrder ||
					(transparent ? 0 : materialId(a) - materialId(b)) ||
					(transparent ? a.id - b.id : index.get(a)! - index.get(b)!),
			)
			.map((object) => index.get(object));
	return { description, transparent: sorted(true), opaque: sorted(false) };
}

function display(
	shapes: EditorShape[],
	selected: number[],
	previews: EditorShape[] = [],
): DrawingDisplay {
	return {
		...buildStaticDisplay(shapes, new Set(selected)),
		previews: buildPreviewDisplay(previews, shapes.length),
	};
}

function fresh(value: DrawingDisplay) {
	const renderer = createDrawingRenderer(null);
	const root = new Group();
	try {
		renderer.update(root, value);
		return describe(root);
	} finally {
		renderer.dispose();
	}
}

test("incremental scene updates match a full rebuild and release replaced resources", () => {
	const renderer = createDrawingRenderer(null);
	const root = new Group();
	// Palette materials and the outline frame live as long as the renderer. Each
	// mesh geometry, glyph material, and texture belongs to the displays using it.
	const owned = new Set<object>();
	const shared = new Set<object>();
	const resources = () => {
		const live = new Set<object>();
		root.traverse((object) => {
			if (!(object instanceof Mesh || object instanceof LineLoop)) return;
			const material = object.material as MeshBasicMaterial;
			const items = [material, material.alphaMap];
			if (object instanceof Mesh) items.push(object.geometry);
			for (const item of items) if (item) live.add(item);
			(object instanceof Mesh && material.alphaMap ? owned : shared).add(
				material,
			);
			if (material.alphaMap) owned.add(material.alphaMap);
			if (object instanceof Mesh) owned.add(object.geometry);
			else shared.add(object.geometry);
		});
		return live;
	};
	const check = (value: DrawingDisplay, step: string) => {
		renderer.update(root, value);
		assert.deepEqual(describe(root), fresh(value), step);
		const live = resources();
		for (const item of owned)
			assert.ok(
				live.has(item) || disposed.has(item),
				`${step}: leaked resource`,
			);
	};
	try {
		let shapes = drawing();
		check(display(shapes, []), "open");
		const meshes = new Map<string, Object3D>();
		root.traverse((object) => meshes.set(object.name, object));
		check(display(shapes, [12, 13, 2]), "select");
		const selection = shapes.filter(({ id }) => [12, 13].includes(id));
		let draft = shapes;
		for (let step = 1; step <= 12; step++) {
			const moved = moveShapes(
				selection,
				{ x: step * 1.27, y: (step % 3) * 1.27 },
				1.27,
				selection[0],
				shapes,
				100,
			);
			const byId = new Map(moved.map((shape) => [shape.id, shape]));
			draft = [
				...shapes.map((shape) => byId.get(shape.id) ?? shape),
				...moved.filter((shape) => !shapes.some(({ id }) => id === shape.id)),
			];
			check(display(draft, [12, 13, 2]), `drag ${step}`);
		}
		// A drag keeps the meshes of shapes that did not move.
		const unmoved = root.getObjectByName("wire 1");
		assert.equal(unmoved, meshes.get("wire 1"));
		shapes = draft;
		const preview = createSymbol(100, part("connector-8"), { x: -10, y: -40 });
		check(display(shapes, [12], [preview]), "symbol preview");
		check(
			display(shapes, [12], [{ ...preview, x: 5 }]),
			"symbol preview moves",
		);
		const wire = drawShape(101, "wire", { x: 40, y: 0 }, { x: 50, y: 0 });
		check(display(shapes, [], [wire]), "wire preview");
		const placed = createSymbol(102, part("op-amp"), { x: -40, y: 40 });
		shapes = [
			...shapes,
			{ ...placed, attributes: { ...placed.attributes, value: "" } },
		];
		check(display(shapes, [102]), "place");
		shapes = [...shapes.slice(0, -1), placed];
		check(display(shapes, [102]), "edit");
		// A replaced text ties in draw order with the pin labels before it.
		const labelled = createSymbol(103, part("resistor-us"), { x: 20, y: -30 });
		const note = shapes.find(
			(shape): shape is TextShape => shape.id === 17 && shape.kind === "text",
		)!;
		shapes = [...shapes, labelled, note];
		check(display(shapes, []), "labelled symbol");
		shapes = [...shapes.slice(0, -1), { ...note, id: 104, text: "Replaced" }];
		check(display(shapes, []), "replace text");
		shapes = shapes.filter(({ id }) => ![1, 6, 10, 13].includes(id));
		check(display(shapes, []), "delete");
		shapes = drawing();
		check(display(shapes, [11]), "undo");
		check(display([], []), "empty");
	} finally {
		renderer.dispose();
	}
	for (const item of [...owned, ...shared])
		assert.ok(disposed.has(item), "disposed on teardown");
});

test("previews update in their own group without touching document meshes", () => {
	const renderer = createDrawingRenderer(null);
	const root = new Group();
	try {
		const shapes = drawing();
		const document = buildStaticDisplay(shapes, new Set());
		renderer.update(root, { ...document, previews: [] });
		const drawingGroup = root.getObjectByName("editor-shapes")!;
		const children = [...drawingGroup.children];
		const wire = drawShape(101, "wire", { x: 40, y: 0 }, { x: 50, y: 0 });
		renderer.update(root, {
			...document,
			previews: buildPreviewDisplay([wire], shapes.length),
		});
		const preview = root.getObjectByName("editor-wire-preview")!;
		assert.equal(preview.parent?.name, "editor-previews");
		assert.deepEqual(drawingGroup.children, children);
		renderer.update(root, {
			...document,
			previews: buildPreviewDisplay([{ ...wire, x: 60 }], shapes.length),
		});
		assert.equal(root.getObjectByName("editor-wire-preview"), preview);
		assert.equal(preview.position.x, 60);
		renderer.update(root, { ...document, previews: [] });
		assert.equal(root.getObjectByName("editor-wire-preview"), undefined);
		assert.ok(disposed.has((preview as Mesh).geometry));
	} finally {
		renderer.dispose();
	}
});

test("document displays keep identity for unchanged shapes and selections", () => {
	const shapes = drawing();
	const first = buildStaticDisplay(shapes, new Set([12]));
	const moved = shapes.map((shape) =>
		shape.id === 12 ? { ...shape, x: shape.x + 2.54 } : shape,
	);
	const second = buildStaticDisplay(moved, new Set([12]));
	for (const [index, shape] of moved.entries())
		assert.equal(
			second.shapes[index] === first.shapes[index],
			shape.id !== 12,
			`shape ${shape.id}`,
		);
	const reselected = buildStaticDisplay(moved, new Set([13]));
	assert.notEqual(reselected.shapes[11], second.shapes[11]);
	assert.equal(reselected.shapes[0], second.shapes[0]);
});
