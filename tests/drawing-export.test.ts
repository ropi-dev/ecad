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
