import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
	arrowDelta,
	handleHistoryKeyDown,
	isArrowKey,
	isEditableTarget,
} from "#/lib/keyboard.ts";

const globals = globalThis as { HTMLElement?: unknown };
let originalHTMLElement: unknown;

/** The DOM surface `isEditableTarget` reads, without a browser. */
class FakeElement {
	constructor(
		readonly tagName: string,
		readonly isContentEditable = false,
		readonly parent?: FakeElement,
	) {}
	closest(selector: string) {
		const tags = selector.split(",").map((tag) => tag.trim().toUpperCase());
		for (
			let element: FakeElement | undefined = this;
			element;
			element = element.parent
		)
			if (tags.includes(element.tagName)) return element;
		return null;
	}
}

beforeEach(() => {
	originalHTMLElement = globals.HTMLElement;
	globals.HTMLElement = FakeElement;
});
afterEach(() => {
	globals.HTMLElement = originalHTMLElement;
});

test("typing targets include form controls and every content-editable element", () => {
	for (const tag of ["INPUT", "TEXTAREA", "SELECT"])
		assert.equal(
			isEditableTarget({ target: new FakeElement(tag) as never }),
			true,
			tag,
		);
	const editor = new FakeElement("DIV", true);
	assert.equal(isEditableTarget({ target: editor as never }), true);
	assert.equal(
		isEditableTarget({
			target: new FakeElement("SPAN", true, editor) as never,
		}),
		true,
		"elements inside an editing host inherit isContentEditable",
	);
	assert.equal(
		isEditableTarget({
			target: new FakeElement(
				"OPTION",
				false,
				new FakeElement("SELECT"),
			) as never,
		}),
		true,
	);
});

test("buttons, canvases, non-elements and missing targets are not typing targets", () => {
	for (const tag of ["BUTTON", "DIV", "BODY"])
		assert.equal(
			isEditableTarget({ target: new FakeElement(tag) as never }),
			false,
			tag,
		);
	assert.equal(isEditableTarget({ target: null }), false);
	assert.equal(
		isEditableTarget({ target: { closest: () => ({}) } as never }),
		false,
		"SVG and other non-HTML targets never count",
	);
});

test("arrow deltas follow screen coordinates by default and flip y for drawing coordinates", () => {
	assert.deepEqual(arrowDelta("ArrowLeft", 5), { x: -5, y: 0 });
	assert.deepEqual(arrowDelta("ArrowRight", 5), { x: 5, y: 0 });
	assert.deepEqual(arrowDelta("ArrowUp", 5), { x: 0, y: -5 });
	assert.deepEqual(arrowDelta("ArrowDown", 5), { x: 0, y: 5 });
	assert.deepEqual(arrowDelta("ArrowUp", 2.5, "up"), { x: 0, y: 2.5 });
	assert.deepEqual(arrowDelta("ArrowDown", 2.5, "up"), { x: 0, y: -2.5 });
	assert.deepEqual(arrowDelta("ArrowLeft", 2.5, "up"), { x: -2.5, y: 0 });
	for (const key of ["Enter", "a", "Arrow", "arrowleft", "Home"]) {
		assert.equal(arrowDelta(key, 5), undefined, key);
		assert.equal(isArrowKey(key), false, key);
	}
	for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"])
		assert.equal(isArrowKey(key), true, key);
});

test("history keys undo with Ctrl or Cmd+Z and redo with Shift+Z or Y", () => {
	const press = (
		key: string,
		modifiers: Partial<
			Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>
		> = {},
	) => {
		const calls: string[] = [];
		const event = {
			key,
			ctrlKey: false,
			metaKey: false,
			altKey: false,
			shiftKey: false,
			...modifiers,
			preventDefault: () => calls.push("prevented"),
		};
		const handled = handleHistoryKeyDown(event, {
			undo: () => calls.push("undo"),
			redo: () => calls.push("redo"),
		});
		return { handled, calls };
	};
	assert.deepEqual(press("z", { ctrlKey: true }), {
		handled: true,
		calls: ["undo", "prevented"],
	});
	assert.deepEqual(press("z", { metaKey: true }), {
		handled: true,
		calls: ["undo", "prevented"],
	});
	assert.deepEqual(press("Z", { ctrlKey: true, shiftKey: true }), {
		handled: true,
		calls: ["redo", "prevented"],
	});
	assert.deepEqual(press("y", { ctrlKey: true }), {
		handled: true,
		calls: ["redo", "prevented"],
	});
	assert.deepEqual(press("Y", { metaKey: true }), {
		handled: true,
		calls: ["redo", "prevented"],
	});
	for (const [key, modifiers] of [
		["z", {}],
		["y", {}],
		["z", { ctrlKey: true, altKey: true }],
		["y", { ctrlKey: true, shiftKey: true }],
		["x", { ctrlKey: true }],
	] as const)
		assert.deepEqual(
			press(key, modifiers),
			{ handled: false, calls: [] },
			`${key} ${JSON.stringify(modifiers)}`,
		);
});
