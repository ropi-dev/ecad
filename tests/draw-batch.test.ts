import assert from "node:assert/strict";
import test from "node:test";
import {
	Box3,
	BufferGeometry,
	Group,
	Mesh,
	MeshBasicMaterial,
	PlaneGeometry,
	Points,
	PointsMaterial,
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

test("a color changed in place rebuilds its batch", () => {
	const batcher = createDrawBatcher();
	const root = new Group();
	const material = new MeshBasicMaterial({ depthTest: false });
	const mesh = new Mesh(new PlaneGeometry(1, 1), material);
	mesh.userData.batchVersion = 1;
	root.add(mesh);
	try {
		batcher.sync(root, renderer);
		material.color.setRGB(0.25, 0.5, 0.75);
		mesh.userData.batchVersion = 2;
		batcher.sync(root, renderer);
		const batch = required(batcher.object.children[0]) as Mesh;
		const color = batch.geometry.getAttribute("color");
		assert.deepEqual(
			[color.getX(0), color.getY(0), color.getZ(0)],
			[0.25, 0.5, 0.75],
		);
	} finally {
		batcher.dispose();
	}
});

test("an object it cannot draw turns batching off", () => {
	const batcher = createDrawBatcher();
	const root = new Group();
	root.add(new Points(new BufferGeometry(), new PointsMaterial()));
	try {
		assert.equal(batcher.sync(root, renderer).batched, false);
	} finally {
		batcher.dispose();
	}
});
