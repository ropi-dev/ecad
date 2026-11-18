import assert from "node:assert/strict";
import { test } from "node:test";
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
