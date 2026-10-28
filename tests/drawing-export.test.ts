import { createSymbolFromShapes } from "#/drawing/symbols.ts";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { exportDrawingSvg } from "#/drawing/export.ts";
import type { EditorShape } from "#/drawing/shapes.ts";
const options = {
	width: 9600,
	height: 6400,
	area: "sheet" as const,
	background: "white" as const,
	sheet: { width: 420, height: 297 },
};
const fixture: { shapes: EditorShape[] } = JSON.parse(
	readFileSync("tests/fixtures/rp2350a-reference/drawing.ecaddraw", "utf8"),
);
test("reference export covers every symbol child and rotation without changing the source", () => {
	const original = JSON.stringify(fixture);
	const svg = exportDrawingSvg(fixture.shapes, options);
	for (const shape of fixture.shapes) {
		assert.ok(svg.includes(`data-name="${shape.kind} ${shape.id}"`));
		if (shape.kind === "symbol")
			for (const child of shape.children.filter((s) =>
				["pin", "text", "wire"].includes(s.kind),
			))
				assert.ok(
					svg.includes(`data-name="${child.kind} ${shape.id}:${child.id}"`),
				);
	}
	assert.match(svg, /viewBox="-210 -148.5 420 297"/);
	assert.doesNotMatch(svg, /<image|NaN|Infinity/);
	assert.equal(JSON.stringify(fixture), original);
});
test("export validates allocation sizes and handles empty drawings and XML text", () => {
	assert.throws(
		() => exportDrawingSvg([], { ...options, width: 16000, height: 16000 }),
		/100 megapixels/,
	);
	assert.throws(
		() => exportDrawingSvg([], { ...options, width: NaN }),
		/dimensions/,
	);
	const text: EditorShape = {
		id: 1,
		kind: "text",
		x: 300,
		y: 0,
		width: 20,
		height: 10,
		lineWidth: 0,
		fontSize: 2,
		rotation: Math.PI / 2,
		text: '<&"\nnext',
	};
	const svg = exportDrawingSvg([text], {
		...options,
		background: "transparent",
		area: "drawing",
	});
	assert.match(svg, /&lt;&amp;&quot;/);
	assert.match(svg, />next<\/text>/);
	assert.doesNotMatch(svg, /fill="white"/);
	assert.doesNotMatch(
		exportDrawingSvg([], { ...options, area: "drawing" }),
		/NaN|Infinity/,
	);
});

test("pin-only symbols keep their connections and labels when their container has no vertices", () => {
	const pin: EditorShape = {
		id: 1,
		kind: "pin",
		x: 0,
		y: 0,
		width: 0.508,
		height: 0.508,
		lineWidth: 0.18,
		rotation: 0,
		length: 2,
		name: "Clock signal",
		number: "17",
	};
	const symbol = createSymbolFromShapes(2, [pin]);
	symbol.texts = [{ attribute: "reference", x: 0, y: 3, fontSize: 2 }];
	const svg = exportDrawingSvg([symbol], options);
	assert.match(svg, /data-name="symbol 2"/);
	assert.match(svg, /data-name="pin 2:1"><path[^>]*d="M/);
	assert.match(svg, />Clock signal<\/text>/);
	assert.match(svg, />17<\/text>/);
	assert.match(svg, />U2<\/text>/);
	assert.doesNotMatch(svg, /NaN|Infinity/);
});

test("zero-width geometry does not prevent later drawing objects from exporting", () => {
	const line: EditorShape = {
		id: 1,
		kind: "line",
		x: 0,
		y: 0,
		width: 10,
		height: 0,
		lineWidth: 0,
		rotation: 0,
	};
	const svg = exportDrawingSvg(
		[line, { ...line, id: 2, height: 0.2, lineWidth: 0.2 }],
		options,
	);
	assert.match(svg, /data-name="line 1"><\/g>/);
	assert.match(svg, /data-name="line 2"><path[^>]*d="M/);
});

test("native pin name and number visibility survive standalone and symbol override export", () => {
	for (const showName of [true, false])
		for (const showNumber of [true, false]) {
			const pin: import("#/drawing/shapes.ts").PinShape = {
				id: 1,
				kind: "pin",
				x: 0,
				y: 0,
				width: 0.508,
				height: 0.508,
				lineWidth: 0.18,
				rotation: Math.PI / 2,
				length: 2,
				name: "EXPORT_PIN",
				number: "97",
				showLabels: false,
				showName,
				showNumber,
			};
			const symbol = createSymbolFromShapes(2, [
				{ ...pin, showName: !showName, showNumber: !showNumber },
			]);
			symbol.childOverrides = { "shape:1": { showName, showNumber } };
			for (const shape of [pin, symbol]) {
				const svg = exportDrawingSvg([shape], options);
				assert.equal(svg.includes(">EXPORT_PIN</text>"), showName);
				assert.equal(svg.includes(">97</text>"), showNumber);
				assert.match(svg, /<path[^>]*d="M/);
				assert.doesNotMatch(svg, /NaN|Infinity/);
			}
		}
});
