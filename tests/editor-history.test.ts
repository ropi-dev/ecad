import assert from "node:assert/strict";
import { test } from "node:test";
import {
	commitHistory,
	createHistory,
	getHistoryState,
	jumpHistory,
	redoHistory,
	undoHistory,
} from "@ecad/drawing-core/drawing/history.ts";

test("editing after undo preserves alternate futures with monotonic node IDs", () => {
	const start = createHistory(0);
	const a = commitHistory(start, 1, "Create", Object.is);
	const b = commitHistory(a, 2, "Move", Object.is);
	const branch = commitHistory(undoHistory(b), 3, "Resize", Object.is);
	assert.equal(branch.currentId, 3);
	assert.deepEqual(branch.nodes[1].childIds, [2, 3]);
	assert.equal(branch.nodes[1].preferredChildId, 3);
	assert.equal(branch.nodes[2], b.nodes[2]);
	assert.equal(getHistoryState(jumpHistory(branch, 2)), 2);
	const continued = commitHistory(
		jumpHistory(branch, 2),
		4,
		"Delete",
		Object.is,
	);
	assert.equal(continued.currentId, 4);
	assert.equal(continued.nextId, 5);
	assert.deepEqual(continued.nodes[2].childIds, [4]);
	assert.deepEqual(continued.nodes[1].childIds, [2, 3]);
	assert.equal(continued.nodes[3].state, 3);
	assert.deepEqual(Object.keys(continued.nodes), ["0", "1", "2", "3", "4"]);
	assert.deepEqual(b.nodes[1].childIds, [2]);
});

test("redo follows the last visited branch and can choose another direct child", () => {
	let history = commitHistory(createHistory(0), 1, "A", Object.is);
	history = commitHistory(history, 2, "B", Object.is);
	history = commitHistory(undoHistory(history), 3, "C", Object.is);
	const branchPoint = undoHistory(history);
	assert.equal(redoHistory(branchPoint).currentId, 3);
	const chooseB = redoHistory(branchPoint, 2);
	assert.equal(chooseB.currentId, 2);
	assert.equal(chooseB.nodes[1].preferredChildId, 2);
	assert.equal(redoHistory(undoHistory(chooseB)).currentId, 2);
	const chooseC = jumpHistory(chooseB, 3);
	assert.equal(redoHistory(undoHistory(chooseC)).currentId, 3);
	assert.equal(branchPoint.nodes[1].preferredChildId, 3);
});

test("jumping across the tree updates the redo route back to the target", () => {
	let history = commitHistory(createHistory("start"), "A", "A", Object.is);
	history = commitHistory(history, "A1", "A1", Object.is);
	history = commitHistory(history, "A2", "A2", Object.is);
	history = commitHistory(jumpHistory(history, 0), "B", "B", Object.is);
	history = commitHistory(history, "B1", "B1", Object.is);
	const previous = structuredClone(history);
	const visited = jumpHistory(history, 3);
	assert.equal(visited.currentId, 3);
	assert.equal(visited.nodes[0].preferredChildId, 1);
	assert.equal(visited.nodes[1].preferredChildId, 2);
	assert.equal(visited.nodes[2].preferredChildId, 3);
	assert.equal(visited.nodes[4].preferredChildId, 5);
	let replayed = jumpHistory(visited, 0);
	for (const expected of [1, 2, 3]) {
		replayed = redoHistory(replayed);
		assert.equal(replayed.currentId, expected);
	}
	assert.equal(getHistoryState(jumpHistory(replayed, 5)), "B1");
	assert.deepEqual(history, previous);
});

test("undo and redo restore the whole transaction including removed shapes and selection", () => {
	const before = {
		shapes: [
			{ id: 1, x: 10 },
			{ id: 2, x: 20 },
		],
		selectedIds: [2],
	};
	const after = { shapes: [{ id: 2, x: 15 }], selectedIds: [2] };
	const history = commitHistory(
		createHistory(before),
		after,
		"Move and merge",
		(a, b) => JSON.stringify(a.shapes) === JSON.stringify(b.shapes),
	);
	const undone = undoHistory(history);
	assert.deepEqual(getHistoryState(undone), before);
	assert.deepEqual(getHistoryState(redoHistory(undone)), after);
	assert.equal(history.nodes[0].state.shapes.length, 2);
});

test("history retains 100 nodes and 99 undo steps with monotonic IDs", () => {
	let history = createHistory(0);
	for (let i = 1; i <= 250; i++)
		history = commitHistory(history, i, `Edit ${i}`, Object.is);
	assert.equal(Object.keys(history.nodes).length, 100);
	assert.equal(history.currentId, 250);
	assert.equal(history.nextId, 251);
	assert.equal(history.nodes[151].parentId, null);
	assert.equal(jumpHistory(history, 150), history);
	for (let i = 249; i >= 151; i--) {
		history = undoHistory(history);
		assert.equal(history.currentId, i);
	}
	assert.equal(undoHistory(history), history);
	for (let i = 152; i <= 250; i++) {
		history = redoHistory(history);
		assert.equal(history.currentId, i);
	}
});
