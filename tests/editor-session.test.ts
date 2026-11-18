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
		page: null,
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

test("replacements keep the selection, and failures report an error and drop the draft", () => {
	const { session, store } = setup([rectangle(1), rectangle(2, 20)]);
	session.select(new Set([1]));
	session.preview([{ ...rectangle(1), x: 5 }, rectangle(2, 20)]);
	assert.equal(session.shapes()[0].x, 5);
	session.replace([{ ...rectangle(1), width: 0 }], "Broken");
	assert.match(session.getState().error, /\bwidth\b/);
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
