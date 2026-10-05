import assert from "node:assert/strict";
import { test } from "node:test";
import {
	commitHistory,
	createHistory,
	getHistoryNode,
	getHistoryState,
	jumpHistory,
	redoHistory,
	undoHistory,
} from "#/components/editor/history.ts";

test("creation and restoration isolate nested snapshots from caller edits", () => {
	const initial = { shapes: [{ id: 1, x: 10 }], selectedIds: new Set([1]) };
	const history = createHistory(initial);
	initial.shapes[0].x = 100;
	initial.selectedIds.clear();
	const restored = getHistoryState(history);
	assert.deepEqual(restored, { shapes: [{ id: 1, x: 10 }], selectedIds: new Set([1]) });
	restored.shapes.push({ id: 2, x: 20 });
	restored.selectedIds.add(2);
	assert.deepEqual(getHistoryState(history), { shapes: [{ id: 1, x: 10 }], selectedIds: new Set([1]) });
	assert.equal(history.currentId, 0);
	assert.equal(history.nextId, 1);
	assert.deepEqual(getHistoryNode(history), {
		id: 0, parentId: null, childIds: [], preferredChildId: null,
		label: "Start", state: { shapes: [{ id: 1, x: 10 }], selectedIds: new Set([1]) },
	});
	assert.equal(getHistoryNode(history, 99), undefined);
});

test("commits copy new snapshots and leave prior history values untouched", () => {
	const first = createHistory({ values: [1] }, "Empty drawing");
	const before = structuredClone(first);
	const next = { values: [1, 2] };
	const committed = commitHistory(first, next, "Draw wire", (a, b) => JSON.stringify(a) === JSON.stringify(b));
	next.values.push(3);
	assert.deepEqual(first, before);
	assert.deepEqual(getHistoryState(committed), { values: [1, 2] });
	assert.equal(getHistoryNode(committed)?.label, "Draw wire");
	assert.equal(getHistoryNode(committed)?.parentId, 0);
	assert.deepEqual(committed.nodes[0].childIds, [1]);
	assert.equal(committed.nodes[0].preferredChildId, 1);
	assert.equal(committed.nextId, 2);
	assert.equal(first.nodes[0].label, "Empty drawing");
});

test("caller equality ignores selection-only changes without allocating a node", () => {
	const history = createHistory({ shapes: [{ id: 1, x: 10 }], selectedIds: [1] });
	const equalGeometry = (a: { shapes: { id: number; x: number }[] }, b: { shapes: { id: number; x: number }[] }) => JSON.stringify(a.shapes) === JSON.stringify(b.shapes);
	const unchanged = commitHistory(history, { shapes: [{ id: 1, x: 10 }], selectedIds: [] }, "Select", equalGeometry);
	assert.equal(unchanged, history);
	assert.equal(unchanged.nextId, 1);
	const edited = commitHistory(unchanged, { shapes: [{ id: 1, x: 20 }], selectedIds: [1] }, "Move line", equalGeometry);
	assert.equal(edited.currentId, 1);
	assert.equal(edited.nextId, 2);
	assert.deepEqual(getHistoryState(undoHistory(edited)), { shapes: [{ id: 1, x: 10 }], selectedIds: [1] });
});

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
	const continued = commitHistory(jumpHistory(branch, 2), 4, "Delete", Object.is);
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

test("boundary navigation and invalid targets return the same history", () => {
	const root = createHistory(0);
	assert.equal(undoHistory(root), root);
	assert.equal(redoHistory(root), root);
	assert.equal(jumpHistory(root, 0), root);
	assert.equal(jumpHistory(root, 100), root);
	assert.equal(jumpHistory(root, -1), root);
	assert.equal(jumpHistory(root, Number.NaN), root);
	const first = commitHistory(root, 1, "A", Object.is);
	const second = commitHistory(first, 2, "B", Object.is);
	assert.equal(redoHistory(second), second);
	assert.equal(redoHistory(second, 0), second);
	assert.equal(redoHistory(first, 100), first);
	const atRoot = jumpHistory(second, 0);
	assert.equal(redoHistory(atRoot, 2), atRoot);
	assert.equal(atRoot.nextId, second.nextId);
});

test("undo and redo restore the whole transaction including removed shapes and selection", () => {
	const before = { shapes: [{ id: 1, x: 10 }, { id: 2, x: 20 }], selectedIds: [2] };
	const after = { shapes: [{ id: 2, x: 15 }], selectedIds: [2] };
	const history = commitHistory(createHistory(before), after, "Move and merge", (a, b) => JSON.stringify(a.shapes) === JSON.stringify(b.shapes));
	const undone = undoHistory(history);
	assert.deepEqual(getHistoryState(undone), before);
	assert.deepEqual(getHistoryState(redoHistory(undone)), after);
	assert.equal(history.nodes[0].state.shapes.length, 2);
});
