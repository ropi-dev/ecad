import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import { exportDrawingSvg } from "#/drawing/export.ts";

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
test("an export for a PNG widens the view box to the image, so its background reaches the edges and the drawing stays centred", () => {
	const svg = exportDrawingSvg(fixture.shapes, {
		...options,
		coverOutput: true,
	});
	const [x, y, width, height] = (/viewBox="([^"]+)"/.exec(svg)?.[1] ?? "")
		.split(" ")
		.map(Number);
	assert.deepEqual([y, height], [-148.5, 297]);
	assert.ok(Math.abs(width / height - 9600 / 6400) < 1e-12);
	assert.ok(Math.abs(x + width / 2) < 1e-9);
	assert.ok(
		svg.includes(
			`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="white"/>`,
		),
	);
	const body = (text: string) => text.slice(text.indexOf("</rect>") + 1);
	assert.equal(
		body(svg.replace(/<rect [^>]+\/>/, "</rect>")),
		body(
			exportDrawingSvg(fixture.shapes, options).replace(
				/<rect [^>]+\/>/,
				"</rect>",
			),
		),
	);
	const tall = exportDrawingSvg(fixture.shapes, {
		...options,
		width: 2000,
		height: 6400,
		background: "transparent",
		coverOutput: true,
	});
	assert.match(tall, /viewBox="-210 -672 420 1344"/);
	assert.doesNotMatch(tall, /<rect/);
});

test("export validates allocation sizes and handles empty drawings and XML text", () => {
	assert.throws(
		() => exportDrawingSvg([], { ...options, width: 16000, height: 16000 }),
		RangeError,
	);
	assert.throws(
		() => exportDrawingSvg([], { ...options, width: NaN }),
		RangeError,
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

test("back-side board text exports mirrored, as the editor draws it", () => {
	const text = (layer: "F.SilkS" | "B.SilkS"): EditorShape => ({
		id: 1,
		kind: "text",
		layer,
		x: 0,
		y: 0,
		width: 20,
		height: 10,
		lineWidth: 0,
		fontSize: 2,
		rotation: 0,
		text: "R1",
	});
	const scaleX = (layer: "F.SilkS" | "B.SilkS") =>
		Number(
			/<g transform="matrix\(([-\d.e]+) /.exec(
				exportDrawingSvg([text(layer)], { ...options, area: "drawing" }),
			)?.[1],
		);
	assert.ok(scaleX("F.SilkS") > 0);
	assert.equal(scaleX("B.SilkS"), -scaleX("F.SilkS"));
});
