import assert from "node:assert/strict";
import { test } from "node:test";
import {
	type FootprintLayer,
	footprintLayers,
} from "@ecad/drawing-core/footprint/layers.ts";
import { Group, type Mesh, type MeshBasicMaterial } from "three";
import type { BoardFill } from "#/board/fill.ts";
import { createZoneScene } from "#/board/zone-scene.ts";

const colors = Object.fromEntries(
	footprintLayers.map((layer) => [layer, "#c83434"]),
) as Record<FootprintLayer, string>;

const fill: BoardFill = {
	shapeId: 1,
	layer: "F.Cu",
	polygons: [],
	triangles: new Float32Array([0, 0, 1, 0, 0, 1]),
};

test("zone fills draw at full opacity until a layer is focused", () => {
	const scene = createZoneScene();
	const root = new Group();
	const material = () =>
		(root.children[0].children[0] as Mesh<never, MeshBasicMaterial>).material;
	const update = (focused: boolean) =>
		scene.update(root, [fill], colors, () => 1, new Set(), focused);

	update(false);
	assert.equal(material().opacity, 1);

	update(true);
	assert.equal(material().opacity, 0.6);

	update(false);
	assert.equal(material().opacity, 1);
	scene.dispose();
});
