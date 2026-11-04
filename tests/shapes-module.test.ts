import assert from "node:assert/strict";
import { test } from "node:test";
import { connectTransformedTerminals } from "@ecad/drawing-core/drawing/connected-wire-transforms.ts";
import { electricalNets } from "@ecad/drawing-core/drawing/named-nets.ts";
import { drawShape } from "@ecad/drawing-core/drawing/shape-geometry.ts";
import * as publicShapes from "@ecad/drawing-core/drawing/shapes.ts";
import { normalizeWireSegments } from "@ecad/drawing-core/drawing/wire-normalization.ts";
import { build } from "esbuild";
import * as editorShapes from "#/components/editor/shapes.ts";

test("package and editor shape imports expose the same routing API", () => {
	assert.equal(publicShapes.drawShape, drawShape);
	assert.equal(
		editorShapes.connectTransformedTerminals,
		connectTransformedTerminals,
	);
	assert.equal(publicShapes.normalizeWireSegments, normalizeWireSegments);
	const terminal = drawShape(1, "pin", { x: 0, y: 0 }, { x: 0, y: 0 });
	const wire = drawShape(2, "wire", { x: 0, y: 0 }, { x: 10, y: 0 });
	const neighbor = drawShape(3, "pin", { x: 10, y: 0 }, { x: 10, y: 0 });
	const original = [terminal, wire, neighbor];
	const replacement = { ...terminal, x: -5, y: 5 };
	for (const options of [undefined, {}, { rerouteWireEnds: true }]) {
		const transformed = connectTransformedTerminals(
			[terminal],
			[replacement],
			original,
			4,
			options,
		);
		const updates = new Map(transformed.map((shape) => [shape.id, shape]));
		const result = normalizeWireSegments([
			...original.map((shape) => updates.get(shape.id) ?? shape),
			...transformed.filter((shape) => shape.id >= 4),
		]).shapes;
		const nets = electricalNets(result);
		assert.equal(nets.length, 1);
		assert.deepEqual(nets[0].pins.map((pin) => pin.shapeId).sort(), [1, 3]);
		for (const shape of result.filter((shape) => shape.kind === "wire")) {
			assert.ok(Math.abs(Math.sin(shape.rotation * 2)) < 1e-10);
		}
	}
	assert.equal(terminal.x, 0);
	assert.equal(wire.width, 10);
});

test("shape and schema runtime imports stay acyclic and independent of the UI", async () => {
	const result = await build({
		entryPoints: [
			"packages/drawing-core/src/drawing/shapes.ts",
			"packages/drawing-core/src/drawing/schema.ts",
			"packages/drawing-core/src/drawing/named-nets.ts",
		],
		bundle: true,
		write: false,
		outdir: "/tmp/ecad-task23-import-check",
		platform: "node",
		format: "esm",
		packages: "external",
		metafile: true,
	});
	const inputs = result.metafile.inputs;
	assert.ok(
		Object.keys(inputs).every(
			(path) => !/components\/|renderer\/|react/.test(path),
		),
	);
	const visited = new Set<string>();
	function visit(path: string, ancestors: string[]) {
		assert.ok(
			!ancestors.includes(path),
			`Runtime import cycle: ${[...ancestors, path].join(" -> ")}`,
		);
		if (visited.has(path)) return;
		for (const dependency of inputs[path]?.imports ?? []) {
			if (!dependency.external) visit(dependency.path, [...ancestors, path]);
		}
		visited.add(path);
	}
	for (const path of Object.keys(inputs)) visit(path, []);
	const schemaDependencies = new Set<string>();
	function collect(path: string) {
		if (schemaDependencies.has(path)) return;
		schemaDependencies.add(path);
		for (const dependency of inputs[path]?.imports ?? []) {
			if (!dependency.external) collect(dependency.path);
		}
	}
	collect("packages/drawing-core/src/drawing/schema.ts");
	assert.ok(
		![...schemaDependencies].some((path) =>
			/named-nets|terminals|connected-wire|shape-editing/.test(path),
		),
	);
});
