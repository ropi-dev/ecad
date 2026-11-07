import assert from "node:assert/strict";
import test from "node:test";
import {
	Box3,
	BufferGeometry,
	DoubleSide,
	Group,
	Line,
	LineBasicMaterial,
	Mesh,
	MeshBasicMaterial,
	PlaneGeometry,
	Vector3,
	type WebGLRenderer,
} from "three";
import { createDrawBatcher } from "#/engine/draw-batch.ts";
import { required } from "./helpers/required.ts";

const renderer = {
	capabilities: { maxTextureSize: 4096 },
} as unknown as WebGLRenderer;

test("a mesh whose geometry grows damages its new extent", () => {
	const batcher = createDrawBatcher();
	const root = new Group();
	const mesh = new Mesh(
		new PlaneGeometry(1, 1),
		new MeshBasicMaterial({ depthTest: false }),
	);
	mesh.userData.batchVersion = 1;
	root.add(mesh);
	try {
		assert.equal(batcher.sync(root, renderer).batched, true);
		mesh.geometry = new PlaneGeometry(10, 10);
		mesh.userData.batchVersion = 2;
		const damage = required(batcher.sync(root, renderer).damage);
		const covered = damage.reduce((box, part) => box.union(part), new Box3());
		assert.ok(covered.min.x <= -5 && covered.max.x >= 5, "x extent");
		assert.ok(covered.min.y <= -5 && covered.max.y >= 5, "y extent");
	} finally {
		batcher.dispose();
	}
});

test("a material changed in place rebuilds its batch", () => {
	const batcher = createDrawBatcher();
	const root = new Group();
	const material = new MeshBasicMaterial({ depthTest: false });
	const mesh = new Mesh(new PlaneGeometry(1, 1), material);
	mesh.userData.batchVersion = 1;
	root.add(mesh);
	try {
		batcher.sync(root, renderer);
		material.side = DoubleSide;
		material.needsUpdate = true;
		mesh.userData.batchVersion = 2;
		batcher.sync(root, renderer);
		const batch = required(batcher.object.children[0]) as Mesh;
		assert.equal((batch.material as MeshBasicMaterial).side, DoubleSide);
	} finally {
		batcher.dispose();
	}
});

test("a line with its own shader is not batched", () => {
	const batcher = createDrawBatcher();
	const root = new Group();
	const material = new LineBasicMaterial({ depthTest: false });
	material.onBeforeCompile = () => {};
	root.add(
		new Line(
			new BufferGeometry().setFromPoints([
				new Vector3(0, 0, 0),
				new Vector3(1, 0, 0),
			]),
			material,
		),
	);
	try {
		assert.equal(batcher.sync(root, renderer).batched, false);
	} finally {
		batcher.dispose();
	}
});
