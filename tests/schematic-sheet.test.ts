import assert from "node:assert/strict";
import test from "node:test";
import {
	placeShapesEffect,
	redoEffect,
	setSheetEffect,
	undoEffect,
} from "@ecad/drawing-core/commands/drawing-commands.ts";
import { drawingSnapshotSchema } from "@ecad/drawing-core/commands/drawing-snapshot.ts";
import {
	createDrawingStore,
	DrawingStore,
} from "@ecad/drawing-core/commands/drawing-store.ts";
import { drawShape } from "@ecad/drawing-core/drawing/shapes.ts";
import {
	type SheetSettings,
	sheetPaper,
} from "@ecad/drawing-core/drawing/sheet.ts";
import { executeDrawingOperation } from "@ecad/drawing-core/mcp/drawing-protocol.ts";
import { Effect, Either } from "effect";
import { buildWorksheetDisplay } from "#/drawing/worksheet.ts";
import { validateProjectDocument } from "#/projects/format.ts";
import { assembleProjectSave } from "#/projects/save-assembly.ts";

const run = <A>(
	store: ReturnType<typeof createDrawingStore>,
	program: Effect.Effect<A, unknown, DrawingStore>,
) =>
	Effect.runSync(
		program.pipe(Effect.provideService(DrawingStore, store), Effect.either),
	);
const wire = (id: number) =>
	drawShape(id, "wire", { x: 0, y: 0 }, { x: 10, y: 0 });
const settings: SheetSettings = {
	paper: "A4",
	portrait: true,
	title: "Power supply",
	date: "2026-11-15",
	revision: "B",
	company: "Bench Labs",
	comments: ["Checked by R.", ""],
};

test("editing the sheet is one undoable edit that publishes new shapes", () => {
	const store = createDrawingStore([wire(1)]);
	const before = store.getSnapshot();
	assert.ok(Either.isRight(run(store, setSheetEffect(settings, "Edit sheet"))));
	const after = store.getSnapshot();
	assert.notEqual(after.shapes, before.shapes);
	assert.equal(after.sheet?.title, "Power supply");
	assert.deepEqual(after.sheet?.comments, ["Checked by R."]);
	assert.equal(
		after.history.nodes[after.history.currentId].label,
		"Edit sheet",
	);
	assert.ok(drawingSnapshotSchema.safeParse(after).success);

	// Saving the same settings again records nothing.
	run(store, setSheetEffect(settings, "Again"));
	assert.equal(store.getSnapshot(), after);

	// Shape edits keep the sheet.
	run(store, placeShapesEffect([{ ...wire(0), y: 5 }], "Draw"));
	assert.equal(store.getSnapshot().sheet?.revision, "B");

	run(store, undoEffect);
	run(store, undoEffect);
	assert.equal(store.getSnapshot().sheet, undefined);
	run(store, redoEffect);
	assert.equal(store.getSnapshot().sheet?.company, "Bench Labs");

	run(store, setSheetEffect({}, "Reset"));
	assert.equal("sheet" in store.getSnapshot(), false);
});

test("invalid sheet settings are rejected", () => {
	const store = createDrawingStore();
	for (const sheet of [
		{ paper: "custom" },
		{ paper: "custom", width: 10, height: 300 },
		{ paper: "A4", width: 300, height: 200 },
		{ paper: "custom", width: 300, height: 200, portrait: true },
		{ title: "two\nlines" },
		{ comments: ["1", "2", "3", "4", "5"] },
		{ paper: "B5" },
	] as SheetSettings[])
		assert.ok(
			Either.isLeft(run(store, setSheetEffect(sheet))),
			JSON.stringify(sheet),
		);
	assert.equal(store.getSnapshot().history.currentId, 0);
});

test("the title block shows the sheet's text and paper size", () => {
	const display = buildWorksheetDisplay({
		...sheetPaper(settings),
		page: { name: "Power", number: 2, count: 3 },
		titleBlock: { file: "Supply", ...settings },
	});
	const texts = display.labels.map((label) => label.text);
	for (const text of [
		"Title: Power supply",
		"Date: 2026-11-15",
		"Rev: B",
		"File: Supply",
		"Size: A4",
		"Sheet: /Power",
		"Id: 2/3",
		"Bench Labs",
		"Checked by R.",
	])
		assert.ok(texts.includes(text), text);
	assert.equal(display.name, "A4, 210 × 297 mm");
	const blank = buildWorksheetDisplay({ width: 420, height: 297, name: "A3" });
	assert.ok(blank.labels.some((label) => label.text === "Title:"));
});

test("project drawings load and save the sheet", () => {
	const document = validateProjectDocument({
		shapes: [wire(1)],
		sheet: settings,
		symbols: [],
	});
	assert.equal(document.sheet?.title, "Power supply");
	assert.throws(
		() =>
			validateProjectDocument({
				shapes: [],
				sheet: { paper: "custom" },
				symbols: [],
			}),
		/\bsheet: /,
	);
	const drawing = { id: "second", name: "Second", shapes: [], sheet: settings };
	const saved = assembleProjectSave({
		symbols: [],
		libraries: [],
		pending: new Map(),
		mainShapes: [],
		mainSheet: { title: "Main" },
		drawings: [drawing],
		drawingEdits: new Map([["second", { shapes: [] }]]),
	});
	assert.deepEqual(saved.sheet, { title: "Main" });
	assert.equal(saved.drawings?.[0].sheet, undefined);
});

test("getDrawing returns the sheet, and setSheet edits it over MCP", () => {
	const store = createDrawingStore([wire(1)]);
	const execute = (operation: Parameters<typeof executeDrawingOperation>[0]) =>
		Effect.runSync(
			executeDrawingOperation(operation).pipe(
				Effect.provideService(DrawingStore, store),
			),
		);
	const first = execute({ type: "getDrawing" });
	assert.ok(first.ok);
	assert.equal(first.drawing?.sheet, undefined);
	assert.ok(
		execute({ type: "setSheet", sheet: { paper: "A2", title: "Top" } }).ok,
	);
	const second = execute({ type: "getDrawing" });
	assert.ok(second.ok);
	assert.deepEqual(second.drawing?.sheet, { paper: "A2", title: "Top" });
	assert.notEqual(second.revision, first.revision);
	const rejected = execute({ type: "setSheet", sheet: { paper: "custom" } });
	assert.equal(rejected.ok, false);
});
