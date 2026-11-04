import assert from "node:assert/strict";
import { test } from "node:test";
import {
	connectionCurveOffset,
	netNodeBox,
	netNodeWidth,
} from "@ecad/drawing-core/circuit/graph.ts";
import { connectionTolerance } from "@ecad/drawing-core/drawing/shapes.ts";
import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import { unionFind } from "@ecad/drawing-core/lib/union-find.ts";

test("union-find merges sets transitively and keeps unrelated members apart", () => {
	const sets = unionFind(6);
	for (let index = 0; index < 6; index++) assert.equal(sets.find(index), index);
	sets.union(0, 1);
	sets.union(2, 1);
	sets.union(4, 5);
	assert.equal(sets.find(0), sets.find(2));
	assert.equal(sets.find(0), sets.find(1));
	assert.equal(sets.find(4), sets.find(5));
	assert.notEqual(sets.find(0), sets.find(4));
	assert.equal(sets.find(3), 3);
	sets.union(5, 0);
	assert.equal(sets.find(4), sets.find(2));
	sets.union(1, 1);
	assert.equal(sets.find(3), 3);
});

test("union-find roots the merged set at the second argument's representative", () => {
	const sets = unionFind(3);
	sets.union(0, 1);
	assert.equal(sets.find(0), 1);
	sets.union(1, 2);
	assert.equal(sets.find(0), 2);
});

test("long union chains stay correct after path halving", () => {
	const size = 10_000;
	const sets = unionFind(size);
	for (let index = 1; index < size; index++) sets.union(index - 1, index);
	const root = sets.find(0);
	for (let index = 0; index < size; index += 997)
		assert.equal(sets.find(index), root);
});

test("error messages prefer the thrown Error and fall back otherwise", () => {
	assert.equal(
		errorMessage(new Error("Disk full"), "Unable to save."),
		"Disk full",
	);
	assert.equal(
		errorMessage(new TypeError("Bad type"), "Unable to save."),
		"Bad type",
	);
	assert.equal(errorMessage("offline", "Unable to save."), "Unable to save.");
	assert.equal(errorMessage(undefined, "Unable to save."), "Unable to save.");
	assert.equal(
		errorMessage({ message: "not an Error" }, "Unable to save."),
		"Unable to save.",
	);
	assert.equal(errorMessage("offline"), "offline");
	assert.equal(errorMessage(42), "42");
	assert.equal(errorMessage(new Error("")), "");
	const unprintable = Object.create(null);
	assert.equal(errorMessage(unprintable, "Unable to save."), "Unable to save.");
	const error = new Error("Shown");
	error.toString = () => {
		throw new Error("toString must not run for errors");
	};
	assert.equal(errorMessage(error), "Shown");
});

test("net nodes grow with their labels between 100 and 360 and stay centered on the anchor", () => {
	assert.equal(netNodeWidth(""), 100);
	assert.equal(netNodeWidth("VCC"), 100);
	assert.equal(netNodeWidth("x".repeat(20)), 176);
	assert.equal(netNodeWidth("x".repeat(43)), 360);
	assert.equal(netNodeWidth("x".repeat(200)), 360);
	for (const label of ["GND", "x".repeat(20), "x".repeat(100)]) {
		const box = netNodeBox(label);
		assert.equal(box.width, netNodeWidth(label));
		assert.equal(box.x, -box.width / 2);
		assert.deepEqual({ y: box.y, height: box.height }, { y: -40, height: 60 });
	}
	assert.equal(connectionCurveOffset, 65);
	assert.equal(connectionTolerance, 1e-4);
});
