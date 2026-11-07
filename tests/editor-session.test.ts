import assert from "node:assert/strict";
import { test } from "node:test";
import {
	placeShapesEffect,
	redoEffect,
	removeShapesEffect,
	undoEffect,
} from "@ecad/drawing-core/commands/drawing-commands.ts";
import {
	createDrawingStore,
	DrawingStore,
} from "@ecad/drawing-core/commands/drawing-store.ts";
import {
	drawShape,
	type EditorShape,
	routeWire,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { Effect } from "effect";
import { createEditorSession } from "#/components/editor/editorSession.ts";
import { replaceDrawingShapes } from "#/projects/drawing-refresh.ts";

const rectangle = (id: number, x = 0) =>
	drawShape(id, "rectangle", { x, y: 0 }, { x: x + 10, y: 10 });

function setup(shapes: EditorShape[] = []) {
	const store = createDrawingStore(shapes);
	const session = createEditorSession(store);
	let notifications = 0;
	session.subscribe(() => notifications++);
	const external = <A, E>(program: Effect.Effect<A, E, DrawingStore>) =>
		Effect.runSync(Effect.provideService(program, DrawingStore, store));
	return { store, session, external, notifications: () => notifications };
}

test("selection keeps only existing shapes the lock rule allows, and resets the child", () => {
	const locked = { ...rectangle(2, 20), locked: true };
	const { session, notifications } = setup([rectangle(1), locked]);
	session.select(new Set([1, 2, 99]));
	assert.deepEqual([...session.getState().selection], [1]);
	session.selectChild("shape:1");
	const before = notifications();
	// Selecting the same shapes again changes nothing, so the child stays.
	session.select(new Set([1]));
	assert.equal(notifications(), before);
	assert.equal(session.getState().childKey, "shape:1");
	session.setAllowLocked(true);
	assert.equal(session.getState().childKey, null);
	session.select(new Set([1, 2]));
	assert.deepEqual([...session.getState().selection], [1, 2]);
	session.selectChild("shape:3");
	session.setAllowLocked(false);
	assert.deepEqual(session.getState(), {
		selection: new Set([1]),
		childKey: null,
		draft: null,
		error: "",
		allowLocked: false,
	});
});

test("placing shapes selects them and history steps restore their own selection", () => {
	const { session } = setup();
	session.place([rectangle(1)], "First");
	assert.deepEqual([...session.getState().selection], [1]);
	session.place([rectangle(2, 20), rectangle(3, 40)], "Second");
	assert.deepEqual([...session.getState().selection], [2, 3]);
	session.select(new Set());
	session.restore(undoEffect);
	assert.deepEqual([...session.getState().selection], [1]);
	session.restore(undoEffect);
	assert.deepEqual([...session.getState().selection], []);
	session.restore(redoEffect);
	session.restore(redoEffect);
	assert.deepEqual([...session.getState().selection], [2, 3]);
});

test("a placed route that splits an existing wire selects only the new legs", () => {
	const { session } = setup([
		drawShape(1, "wire", { x: 0, y: 0 }, { x: 100, y: 0 }),
	]);
	const legs = routeWire(session.nextId(), { x: 50, y: 50 }, { x: 80, y: 0 });
	session.place(legs, "Draw wire");
	const selected = [...session.getState().selection];
	assert.equal(selected.length, 1);
	assert.equal(
		session.shapes().find((shape) => shape.id === selected[0])?.rotation,
		-Math.PI / 2,
	);
});

test("replacements keep the selection, and failures report an error and drop the draft", () => {
	const { session, store } = setup([rectangle(1), rectangle(2, 20)]);
	session.select(new Set([1]));
	session.preview([{ ...rectangle(1), x: 5 }, rectangle(2, 20)]);
	assert.equal(session.shapes()[0].x, 5);
	session.replace([{ ...rectangle(1), width: 0 }], "Broken");
	assert.match(session.getState().error, /^width:.*>0/);
	assert.equal(session.getState().draft, null);
	assert.equal(store.getSnapshot().shapes[0].width, 10);
	session.replace([{ ...rectangle(1), x: 30 }], "Move");
	assert.equal(session.getState().error, "");
	assert.deepEqual([...session.getState().selection], [1]);
	assert.equal(
		store.getSnapshot().history.nodes[store.getSnapshot().history.currentId]
			.label,
		"Move",
	);
});

test("a command that changes nothing keeps the last error", () => {
	const { session } = setup([rectangle(1)]);
	session.setError("Earlier failure");
	session.replace([rectangle(1)], "Same");
	assert.equal(session.getState().error, "Earlier failure");
	session.setError((current) => current || "Replaced");
	assert.equal(session.getState().error, "Earlier failure");
});

test("commit with an explicit selection, such as deleting, selects that instead", () => {
	const { session } = setup([rectangle(1), rectangle(2, 20)]);
	session.select(new Set([1, 2]));
	const result = session.commit(removeShapesEffect([1]), new Set());
	assert.ok(result);
	assert.deepEqual([...session.getState().selection], []);
	assert.equal(session.shapes().length, 1);
	session.restore(undoEffect);
	assert.deepEqual(
		[...session.getState().selection],
		[],
		"the start step had no saved selection",
	);
	session.rememberSelection(0, [1, 2]);
	session.restore(redoEffect);
	session.restore(undoEffect);
	assert.deepEqual([...session.getState().selection], [1, 2]);
});

test("external edits cancel gestures and drop deleted shapes; the session's own commands do not", () => {
	const { session, store, external } = setup([rectangle(1), rectangle(2, 20)]);
	let cancelled = 0;
	const disconnect = session.connect(store, () => cancelled++);
	assert.equal(cancelled, 1, "connecting reconciles once");
	session.select(new Set([1, 2]));
	session.replace([{ ...rectangle(1), x: 3 }], "Own edit");
	assert.equal(cancelled, 1);
	external(removeShapesEffect([2], "Elsewhere"));
	assert.equal(cancelled, 2);
	assert.deepEqual([...session.getState().selection], [1]);
	disconnect();
	external(placeShapesEffect([rectangle(5, 60)], "After disconnect"));
	assert.equal(cancelled, 2);
});

test("a refresh with the store's own saved shapes keeps a drag, which then commits and undoes", () => {
	const { session, store } = setup([rectangle(1), rectangle(2, 20)]);
	let cancelled = 0;
	session.connect(store, () => cancelled++);
	cancelled = 0;
	session.select(new Set([1, 2]));
	const initial = session.shapes();
	const moved = { ...rectangle(1), x: rectangle(1).x + 7 };
	session.preview(initial.map((shape) => (shape.id === 1 ? moved : shape)));

	// The save hands back equal shapes with new identities.
	replaceDrawingShapes(
		store,
		structuredClone(store.getSnapshot().shapes),
		false,
	);
	assert.equal(cancelled, 0);
	assert.notEqual(session.getState().draft, null);
	assert.deepEqual([...session.getState().selection], [1, 2]);

	// Committing like a finished move: only the shapes the drag changed.
	const before = new Map(initial.map((shape) => [shape.id, shape]));
	session.replace(
		session.shapes().filter((shape) => shape !== before.get(shape.id)),
		"Move selection",
	);
	assert.deepEqual(store.getSnapshot().shapes, [moved, rectangle(2, 20)]);
	assert.equal(
		store.getSnapshot().history.nodes[store.getSnapshot().history.currentId]
			.label,
		"Move selection",
	);
	session.restore(undoEffect);
	assert.deepEqual(store.getSnapshot().shapes, [
		rectangle(1),
		rectangle(2, 20),
	]);
	session.restore(redoEffect);
	assert.deepEqual(store.getSnapshot().shapes, [moved, rectangle(2, 20)]);
	assert.equal(cancelled, 0);
});

test("a refresh with the store's own saved shapes does not cancel, and a wire placed after it undoes", () => {
	const { session, store } = setup([rectangle(1)]);
	let cancelled = 0;
	session.connect(store, () => cancelled++);
	cancelled = 0;
	replaceDrawingShapes(
		store,
		structuredClone(store.getSnapshot().shapes),
		false,
	);
	assert.equal(cancelled, 0);
	session.place(
		[drawShape(session.nextId(), "wire", { x: 0, y: 40 }, { x: 30, y: 40 })],
		"Draw wire",
	);
	assert.equal(store.getSnapshot().shapes.length, 2);
	session.restore(undoEffect);
	assert.deepEqual(store.getSnapshot().shapes, [rectangle(1)]);
});

test("a refresh keeps the store's objects for shapes the save left equal", () => {
	const { store } = setup([rectangle(1), rectangle(2, 20)]);
	const before = store.getSnapshot();
	const same = replaceDrawingShapes(
		store,
		structuredClone(before.shapes),
		false,
	);
	assert.equal(same, before.shapes);
	assert.equal(store.getSnapshot(), before);
	const changed = { ...rectangle(2, 20), x: 40 };
	const installed = replaceDrawingShapes(
		store,
		[structuredClone(before.shapes[0]), changed],
		false,
	);
	assert.equal(store.getSnapshot().shapes, installed);
	assert.equal(installed[0], before.shapes[0]);
	assert.deepEqual(installed[1], changed);
});

test("an external refresh starts a history that holds the installed shapes", () => {
	const { store } = setup([rectangle(1)]);
	const installed = replaceDrawingShapes(
		store,
		[rectangle(1), rectangle(2, 20)],
		true,
	);
	const { history, shapes } = store.getSnapshot();
	assert.equal(shapes, installed);
	assert.equal(history.nodes[history.currentId].state.shapes, installed);
});

test("an external refresh still cancels gestures and drops removed shapes", () => {
	const { session, store } = setup([rectangle(1), rectangle(2, 20)]);
	let cancelled = 0;
	session.connect(store, () => cancelled++);
	cancelled = 0;
	session.select(new Set([1, 2]));
	// Equal content still counts: another program wrote the file.
	replaceDrawingShapes(
		store,
		structuredClone(store.getSnapshot().shapes),
		true,
	);
	assert.equal(cancelled, 1);
	replaceDrawingShapes(store, [rectangle(1)], true);
	assert.equal(cancelled, 2);
	assert.deepEqual([...session.getState().selection], [1]);
});

test("a refresh that changes the saved drawing still cancels gestures", () => {
	const { session, store } = setup([rectangle(1), rectangle(2, 20)]);
	let cancelled = 0;
	session.connect(store, () => cancelled++);
	cancelled = 0;
	session.select(new Set([1, 2]));
	// Linked assembly dropped a shape while saving: a drag on it would be lost.
	replaceDrawingShapes(store, [rectangle(1)], false);
	assert.equal(cancelled, 1);
	assert.deepEqual([...session.getState().selection], [1]);
});

test("connecting a store whose last change was a saved refresh still cancels gestures", () => {
	const { session, store } = setup([rectangle(1)]);
	const other = createDrawingStore([rectangle(1)]);
	replaceDrawingShapes(
		other,
		structuredClone(other.getSnapshot().shapes),
		false,
	);
	let cancelled = 0;
	session.connect(store, () => cancelled++);
	cancelled = 0;
	session.connect(other, () => cancelled++);
	assert.equal(cancelled, 1);
});

test("connecting another store resets saved history selections", () => {
	const { session, store } = setup();
	session.connect(store, () => {})();
	session.place([rectangle(1)], "First");
	const other = createDrawingStore([rectangle(1)]);
	session.connect(other, () => {});
	session.place([rectangle(2, 20)], "Second");
	session.restore(undoEffect);
	assert.deepEqual([...session.getState().selection], []);
	assert.equal(
		store.getSnapshot().shapes.length,
		1,
		"the first store is untouched",
	);
});

test("a store switch during an async edit is visible as a changed drawing, and commands follow the new store", () => {
	const { session, store } = setup([rectangle(1), rectangle(2, 20)]);
	session.connect(store, () => {});
	const before = session.drawing();
	const other = createDrawingStore([rectangle(1), rectangle(2, 20)]);
	session.connect(other, () => {});
	assert.notEqual(session.drawing(), before);
	assert.equal(session.drawing(), other.getSnapshot());
	session.commit(removeShapesEffect([1]), new Set());
	assert.equal(other.getSnapshot().shapes.length, 1);
	assert.equal(store.getSnapshot().shapes.length, 2);
});

test("shapes are resolved once per document version and the draft wins while it exists", () => {
	const store = createDrawingStore([rectangle(1)]);
	let calls = 0;
	const resolve = (shapes: EditorShape[]) => {
		calls++;
		return shapes.map((shape) => ({ ...shape, x: shape.x + 100 }));
	};
	const session = createEditorSession(store, resolve);
	assert.equal(session.shapes()[0].x, 105);
	session.shapes();
	assert.equal(calls, 1);
	const draft = [rectangle(9)];
	session.preview(draft);
	assert.equal(session.shapes(), draft);
	session.preview(null);
	session.place([rectangle(2, 20)], "Add");
	assert.deepEqual(
		session.shapes().map((shape) => shape.x),
		[105, 125],
	);
	assert.equal(calls, 2);
	// A known resolution is reused instead of resolving again.
	const known = { input: store.getSnapshot().shapes, output: [rectangle(7)] };
	session.setResolver(resolve, known);
	assert.equal(session.shapes(), known.output);
	assert.equal(calls, 2);
	session.setResolver((shapes) => shapes);
	assert.deepEqual(
		session.shapes().map((shape) => shape.x),
		[5, 25],
	);
});
