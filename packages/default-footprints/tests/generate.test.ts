import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { generateDefaultFootprints } from "../src/index.ts";

const footprint = (id: string) => {
	const found = generateDefaultFootprints().find(({ file }) => file.id === id);
	assert.ok(found, id);
	return found.file;
};
const pads = (id: string) =>
	footprint(id).shapes.flatMap((shape) =>
		"pad" in shape && shape.pad ? [{ ...shape, pad: shape.pad }] : [],
	);

test("generation is deterministic and returns fresh objects", () => {
	const first = generateDefaultFootprints();
	const second = generateDefaultFootprints();
	assert.deepEqual(first, second);
	assert.notEqual(first[0], second[0]);
	assert.notEqual(first[0].file.shapes, second[0].file.shapes);
	first[0].file.shapes.length = 0;
	assert.deepEqual(generateDefaultFootprints(), second);
});

test("every footprint has a unique portable ID, numbered pads and unique shape IDs", () => {
	const footprints = generateDefaultFootprints();
	assert.equal(footprints.length, 56);
	assert.equal(
		new Set(footprints.map(({ file }) => file.id)).size,
		footprints.length,
	);
	for (const { file, category } of footprints) {
		assert.match(file.id, /^[a-z0-9][a-z0-9._-]{0,63}$/);
		assert.equal(file.id, file.name.toLowerCase());
		assert.ok(category.length > 0);
		assert.ok(file.description.length <= 500, file.id);
		assert.deepEqual(
			file.shapes.map(({ id }) => id),
			file.shapes.map((_, index) => index + 1),
		);
		assert.ok(
			file.shapes.some((shape) => "pad" in shape && shape.pad?.number),
			file.id,
		);
	}
});

test("KiCad's Y-down coordinates and degrees become Y-up millimetres and radians", () => {
	const [first, second] = pads("r_0805_2012metric");
	assert.deepEqual(
		{ ...first, id: 0 },
		{
			id: 0,
			kind: "rectangle",
			layer: "F.Cu",
			x: -0.9125,
			y: 0,
			width: 1.025,
			height: 1.4,
			rotation: 0,
			lineWidth: 0.15,
			filled: true,
			pad: { number: "1", type: "smd", paste: true },
		},
	);
	assert.equal(second.x, 0.9125);
	// SOT-23 pad 3 sits below the body in KiCad, so above it here.
	const pad3 = pads("sot-23").find(({ pad }) => pad.number === "3");
	assert.ok(pad3 && pad3.y === 0 && pad3.x > 0);
	const pad1 = pads("sot-23").find(({ pad }) => pad.number === "1");
	assert.ok(pad1 && pad1.y > 0 && pad1.x < 0);
	// Pad 15 starts the bottom row, which KiCad draws below the body.
	const bottom = pads("qfn-56-1ep_7x7mm_p0.4mm_ep3.2x3.2mm").find(
		({ pad }) => pad.number === "15",
	);
	assert.deepEqual(
		bottom && [bottom.x, bottom.y, bottom.width, bottom.height],
		[-2.6, -3.4375, 0.2, 0.875],
	);
});

test("through-hole pads keep their drills and square pad 1", () => {
	const header = pads("pinheader_1x04_p2.54mm_vertical");
	assert.deepEqual(
		header.map(({ pad }) => pad.number),
		["1", "2", "3", "4"],
	);
	assert.equal(header[0].kind, "rectangle");
	assert.ok(header.slice(1).every(({ kind }) => kind === "circle"));
	for (const { pad, width, height } of header) {
		assert.equal(pad.type, "through-hole");
		assert.equal(pad.drill, 1);
		assert.ok((pad.drill ?? 0) < Math.min(width, height));
	}
	assert.deepEqual(
		header.map(({ y }) => y),
		[0, -2.54, -5.08, -7.62],
	);
});

test("exposed pads leave paste to separate openings on the paste layer", () => {
	const file = footprint("qfn-48-1ep_6x6mm_p0.4mm_ep4.6x4.6mm");
	const exposed = pads(file.id).find(({ pad }) => pad.number === "49");
	assert.ok(exposed);
	assert.equal(exposed.pad.paste, undefined);
	assert.equal(exposed.width, 4.6);
	const openings = file.shapes.filter(
		(shape) => shape.layer === "F.Paste" && !("pad" in shape && shape.pad),
	);
	assert.equal(openings.length, 9);
	assert.ok(openings.every((shape) => "filled" in shape && shape.filled));
	assert.deepEqual(
		[...new Set(pads(file.id).map(({ pad }) => pad.number))].length,
		49,
	);
});

test("custom pads become rectangles that share the pad number", () => {
	const tab = pads("sot-89-3").filter(({ pad }) => pad.number === "2");
	assert.equal(tab.length, 2);
	assert.ok(tab.every(({ kind }) => kind === "rectangle"));
	const corners = pads("vqfn-52-1ep_6x6mm_p0.4mm_ep4.7x4.7mm").filter(
		({ pad }) => pad.number === "1",
	);
	assert.equal(corners.length, 1);
	assert.ok(Math.abs(corners[0].width - 0.775) < 1e-9);
	assert.ok(Math.abs(corners[0].height - 0.2) < 1e-9);
});

test("pin 1 markers become filled triangles and arcs become short lines", () => {
	const marker = footprint("sot-23").shapes.find(
		(shape) => shape.kind === "triangle",
	);
	assert.ok(marker && "filled" in marker && marker.filled);
	assert.equal(marker.layer, "F.SilkS");
	// The 5 mm LED body is a 2.9 mm arc closed by a straight flat.
	const body = footprint("led_d5.0mm")
		.shapes.filter((shape) => shape.kind === "line" && shape.layer === "F.Fab")
		.map(({ width }) => width)
		.sort((a, b) => b - a);
	assert.ok(body.length > 10);
	assert.ok(Math.abs(body[0] - 2 * 1.469694) < 1e-6);
	for (const length of body.slice(1))
		assert.ok(length <= (2 * Math.PI * 2.9) / 24 + 1e-3, String(length));
});

test("CLI writes one portable file per footprint with attribution and refuses overwrites", async () => {
	const output = await mkdtemp(join(tmpdir(), "ecad-default-footprints-"));
	const cli = new URL("../scripts/generate.ts", import.meta.url);
	try {
		const run = () =>
			spawnSync(process.execPath, ["--import", "tsx", cli.pathname, output], {
				encoding: "utf8",
			});
		const result = run();
		assert.equal(result.status, 0, result.stderr);
		const files = await readdir(output);
		assert.equal(files.filter((file) => file.endsWith(".ecadfp")).length, 56);
		for (const { file } of generateDefaultFootprints())
			assert.deepEqual(
				JSON.parse(await readFile(join(output, `${file.id}.ecadfp`), "utf8")),
				file,
			);
		for (const filename of ["LICENSE.md", "NOTICE.md", "CC-BY-SA-4.0.txt"])
			assert.ok((await readFile(join(output, filename), "utf8")).length > 100);
		assert.notEqual(run().status, 0);
	} finally {
		await rm(output, { recursive: true, force: true });
	}
});
