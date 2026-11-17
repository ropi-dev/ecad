import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import {
	boardDrawOrder,
	shapeLayers,
} from "@ecad/drawing-core/footprint/shapes.ts";
import { unzlibSync } from "fflate";
import { createBoardAnalysis, createShapesSender } from "#/board/analysis.ts";
import { exportFabrication } from "#/board/gerber.ts";
import { boardDisplay, boardExportShapes } from "#/board/view.ts";
import { exportDrawingSvg } from "#/drawing/export.ts";
import {
	type DrawingPdfOptions,
	exportDrawingPdf,
} from "#/drawing/export-pdf.ts";
import { exampleDesigns } from "#/examples/designs.ts";

const options: DrawingPdfOptions = {
	area: "sheet",
	background: "white",
	sheet: { width: 420, height: 297 },
	title: "RP2350A reference",
};
const fixture: { shapes: EditorShape[] } = JSON.parse(
	readFileSync("tests/fixtures/rp2350a-reference/drawing.ecaddraw", "utf8"),
);
const points = (millimetres: number) =>
	Math.round(((millimetres * 72) / 25.4) * 1e4) / 1e4;

interface ParsedPage {
	dictionary: string;
	content: string;
	text: string[];
}

interface ParsedPdf {
	objects: Map<number, { dictionary: string; stream?: string }>;
	pages: ParsedPage[];
	page: ParsedPage;
	text: string[];
	bookmarks: { title: string; page: number }[];
}

const utf16 = (hex: string) =>
	String.fromCharCode(
		...(hex.match(/.{4}/g) ?? []).map((unit) => Number.parseInt(unit, 16)),
	);

function parsePdf(bytes: Uint8Array): ParsedPdf {
	const source = new TextDecoder("latin1").decode(bytes);
	assert.match(source, /^%PDF-1\.4\n%âãÏÓ\n/);
	const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(source)?.[1]);
	assert.equal(source.slice(startxref, startxref + 5), "xref\n");
	const [, count, table] =
		/^xref\n0 (\d+)\n0000000000 65535 f \n((?:\d{10} 00000 n \n)*)trailer/.exec(
			source.slice(startxref),
		) ?? [];
	const offsets = table.match(/\d{10}/g)?.map(Number) ?? [];
	assert.equal(offsets.length + 1, Number(count));
	const objects: ParsedPdf["objects"] = new Map();
	for (const [index, offset] of offsets.entries()) {
		const id = index + 1;
		const head = `${id} 0 obj\n`;
		assert.equal(source.slice(offset, offset + head.length), head);
		const body = source.slice(
			offset + head.length,
			source.indexOf("\nendobj\n", offset),
		);
		const streamAt = body.indexOf("\nstream\n");
		if (streamAt < 0) {
			objects.set(id, { dictionary: body });
			continue;
		}
		const dictionary = body.slice(0, streamAt);
		const length = Number(/\/Length (\d+)/.exec(dictionary)?.[1]);
		const start = offset + head.length + streamAt + "\nstream\n".length;
		assert.equal(
			source.slice(start + length, start + length + 11),
			"\nendstream\n",
		);
		objects.set(id, {
			dictionary,
			stream: new TextDecoder("latin1").decode(
				unzlibSync(bytes.subarray(start, start + length)),
			),
		});
	}
	const trailer = source.slice(source.lastIndexOf("trailer"));
	const root = Number(/\/Root (\d+) 0 R/.exec(trailer)?.[1]);
	const pages = Number(
		/\/Pages (\d+) 0 R/.exec(objects.get(root)?.dictionary ?? "")?.[1],
	);
	const pageIds = [
		...(/\/Kids \[([^\]]*)\]/
			.exec(objects.get(pages)?.dictionary ?? "")?.[1]
			.matchAll(/(\d+) 0 R/g) ?? []),
	].map(([, id]) => Number(id));
	assert.match(
		objects.get(pages)?.dictionary ?? "",
		new RegExp(`/Count ${pageIds.length} >>`),
	);
	const parsed = pageIds.map((id) => {
		const dictionary = objects.get(id)?.dictionary ?? "";
		const content =
			objects.get(Number(/\/Contents (\d+) 0 R/.exec(dictionary)?.[1]))
				?.stream ?? "";
		const fonts = new Map<string, Map<number, string>>();
		for (const [, name, fontId] of dictionary.matchAll(/\/(F\d+) (\d+) 0 R/g)) {
			const font = objects.get(Number(fontId))?.dictionary ?? "";
			assert.match(font, /\/Subtype \/Type3/);
			const cmap =
				objects.get(Number(/\/ToUnicode (\d+) 0 R/.exec(font)?.[1]))?.stream ??
				"";
			const codes = new Map<number, string>();
			for (const [, code, unicode] of cmap.matchAll(
				/<([0-9a-f]{2})> <([0-9a-f]+)>/g,
			))
				codes.set(Number.parseInt(code, 16), utf16(unicode));
			fonts.set(name, codes);
		}
		const text = content
			.split("\n")
			.filter((line) => line.includes("Tm"))
			.map((line) =>
				[...line.matchAll(/\/(F\d+) [\d.]+ Tf <([0-9a-f]*)> Tj/g)]
					.map(([, font, hex]) =>
						(hex.match(/../g) ?? [])
							.map((code) => fonts.get(font)?.get(Number.parseInt(code, 16)))
							.join(""),
					)
					.join(""),
			);
		return { dictionary, content, text };
	});
	const outlines = /\/Outlines (\d+) 0 R/.exec(
		objects.get(root)?.dictionary ?? "",
	)?.[1];
	const bookmarks: ParsedPdf["bookmarks"] = [];
	let entry = Number(
		/\/First (\d+) 0 R/.exec(
			objects.get(Number(outlines))?.dictionary ?? "",
		)?.[1],
	);
	while (outlines && entry) {
		const dictionary = objects.get(entry)?.dictionary ?? "";
		bookmarks.push({
			title: utf16(/\/Title <feff([0-9a-f]*)>/.exec(dictionary)?.[1] ?? ""),
			page: pageIds.indexOf(
				Number(/\/Dest \[(\d+) 0 R \/Fit\]/.exec(dictionary)?.[1]),
			),
		});
		entry = Number(/\/Next (\d+) 0 R/.exec(dictionary)?.[1]);
	}
	return {
		objects,
		pages: parsed,
		page: parsed[0],
		text: parsed[0].text,
		bookmarks,
	};
}

test("a sheet export is one page the size of the sheet, with the drawing's text searchable", () => {
	const original = JSON.stringify(fixture);
	const pdf = parsePdf(exportDrawingPdf(fixture.shapes, options));
	assert.match(
		pdf.page.dictionary,
		new RegExp(`/MediaBox \\[0 0 ${points(420)} ${points(297)}\\]`),
	);
	for (const label of ["W25Q128JVSIQ", "HOLD_IO3", "12MHz Crystal", "Title:"])
		assert.ok(pdf.text.includes(label), label);
	assert.ok(pdf.text.some((line) => line.startsWith("Size: 420 × 297")));
	assert.doesNotMatch(pdf.page.content, /NaN|Infinity/);
	assert.equal(JSON.stringify(fixture), original);
	const info = [...pdf.objects.values()].find(({ dictionary }) =>
		dictionary.includes("/Producer"),
	);
	assert.match(
		info?.dictionary ?? "",
		/\/Title <feff0052005000320033003500300041[0-9a-f]*>/,
	);
});

test("a drawing-only export prints at 1:1 in millimetres, and a page past 200 inches shrinks to fit", () => {
	const empty = parsePdf(
		exportDrawingPdf([], { ...options, area: "drawing", title: "empty" }),
	);
	assert.match(
		empty.page.dictionary,
		new RegExp(`/MediaBox \\[0 0 ${points(16)} ${points(16)}\\]`),
	);
	const wide = parsePdf(
		exportDrawingPdf([], {
			...options,
			sheet: { width: 10_160, height: 297 },
			title: "wide",
		}),
	);
	assert.match(wide.page.dictionary, /\/MediaBox \[0 0 14400 420.9449\]/);
});

test("text past 255 different characters spreads over more fonts and reads back the same, overbars and all", () => {
	const characters = Array.from({ length: 300 }, (_, index) =>
		String.fromCodePoint(0x100 + index),
	).join("");
	const shapes: EditorShape[] = [
		{
			id: 1,
			kind: "text",
			x: 0,
			y: 0,
			width: 600,
			height: 10,
			lineWidth: 0,
			fontSize: 2,
			rotation: 0,
			text: `${characters}\n~{RESET}`,
		},
	];
	const pdf = parsePdf(
		exportDrawingPdf(shapes, {
			...options,
			area: "drawing",
			background: "transparent",
		}),
	);
	assert.deepEqual(pdf.text, [characters, "RESET"]);
	assert.match(pdf.page.dictionary, /\/F1 \d+ 0 R \/F2 \d+ 0 R/);
	assert.match(pdf.page.content, / re\nf\nQ/);
	assert.doesNotMatch(pdf.page.content, /^[\d. ]+ rg [\d. -]+ re f$/m);
});

test("a board export puts each layer with items on its own page, the same size, with the outline on every page", async () => {
	const design = await exampleDesigns.rp2350a.load();
	const shapes = boardDisplay(
		design.board,
		new Set(),
		new Set(),
		"F.Cu",
	).shapes;
	const pdf = parsePdf(
		exportDrawingPdf(shapes, {
			...options,
			area: "drawing",
			title: design.name,
			layers: true,
		}),
	);
	const labels = [
		"Front copper",
		"Back copper",
		"Front silkscreen",
		"Front solder mask",
		"Back solder mask",
		"Front paste",
		"Front courtyard",
		"Front fabrication",
	];
	assert.deepEqual(
		pdf.pages.map((page) => page.text[0]),
		labels,
	);
	assert.deepEqual(
		pdf.bookmarks,
		labels.map((title, page) => ({ title, page })),
	);
	assert.match(
		[...pdf.objects.values()].find(({ dictionary }) =>
			dictionary.includes("/Type /Catalog"),
		)?.dictionary ?? "",
		/\/PageMode \/UseOutlines/,
	);
	const boxes = new Set(
		pdf.pages.map((page) => /\/MediaBox \[[^\]]+\]/.exec(page.dictionary)?.[0]),
	);
	assert.equal(boxes.size, 1);
	const [, width, height] =
		/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(pdf.page.dictionary) ?? [];
	assert.ok(Number(width) > points(50) && Number(width) < points(70));
	assert.ok(Number(height) > points(50) && Number(height) < points(70));
	const fill = (hex: string) =>
		`${[1, 3, 5].map((at) => String(Math.round((Number.parseInt(hex.slice(at, at + 2), 16) / 255) * 1e4) / 1e4)).join(" ")} rg`;
	for (const page of pdf.pages)
		assert.ok(page.content.includes(fill("#8d8f12")), page.text[0]);
	const [front, back, silk] = pdf.pages;
	assert.ok(front.content.includes(fill("#c83434")));
	assert.ok(!front.content.includes(fill("#c9a23c")));
	assert.ok(back.content.includes(fill("#3b6fb8")));
	for (const reference of ["U1", "C19", "J2", "SW1"]) {
		assert.ok(silk.text.includes(reference), reference);
		assert.ok(!back.text.includes(reference), reference);
	}
	assert.ok(silk.content.includes(fill("#3f3c0f")));
});

test("a schematic stays on one page without bookmarks", () => {
	const pdf = parsePdf(
		exportDrawingPdf(fixture.shapes, { ...options, layers: false }),
	);
	assert.equal(pdf.pages.length, 1);
	assert.deepEqual(pdf.bookmarks, []);
});

test("a footprint smaller than its layer caption gets a page wide enough for the caption", () => {
	const line: EditorShape = {
		id: 1,
		kind: "line",
		x: 0,
		y: 0,
		width: 1,
		height: 1,
		rotation: 0,
		lineWidth: 0.12,
		layer: "F.SilkS",
	};
	const pdf = parsePdf(
		exportDrawingPdf([line], {
			...options,
			area: "drawing",
			title: "Tiny",
			layers: true,
		}),
	);
	assert.deepEqual(
		pdf.pages.map((page) => page.text[0]),
		["Front silkscreen"],
	);
	const caption = "Front silkscreen".length * 0.6 * 2 + 2;
	const [, width, height] =
		/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(pdf.page.dictionary) ?? [];
	assert.equal(Number(width), points(caption));
	assert.ok(Number(height) < points(10));
	const [, tx] = /^[\d.]+ 0 0 [\d.]+ ([\d.]+) /.exec(pdf.page.content) ?? [];
	assert.equal(Number(tx), points(caption / 2));
});

test("a board export draws each zone as its fill, with clearances cut out, in place of its outline", async () => {
	const design = await exampleDesigns.rp2350a.load();
	const analyse = createBoardAnalysis();
	analyse({ type: "board", circuit: design.circuit, rules: design.rules });
	const reply = analyse({
		type: "drawing-fills",
		id: 1,
		shapes: createShapesSender().patch(design.board),
	});
	assert.equal(reply?.type, "drawing-fills");
	const zoneFills = reply.type === "drawing-fills" ? reply.fills : [];
	const zones = design.board.filter(
		(shape) => shape.kind === "rectangle" && shape.zone,
	);
	assert.deepEqual(
		zoneFills.map((fill) => fill.shapeId).sort(),
		zones.map((zone) => zone.id).sort(),
	);
	const shapes = boardExportShapes(design.board);
	const exported = { ...options, area: "drawing" as const, layers: true };
	const pdf = parsePdf(
		exportDrawingPdf(shapes, { ...exported, title: design.name, zoneFills }),
	);
	const bare = parsePdf(
		exportDrawingPdf(shapes, { ...exported, title: design.name }),
	);
	const n = (value: number) => String(Math.round(value * 1e4) / 1e4);
	for (const [page, layer] of [
		[0, "F.Cu"],
		[1, "B.Cu"],
	] as const) {
		const rings = zoneFills
			.filter((fill) => fill.layer === layer)
			.flatMap((fill) => fill.polygons.flat());
		assert.ok(rings.length > 1, `${layer} has a fill with clearance holes`);
		const lines = pdf.pages[page].content.split("\n");
		const painted = lines.flatMap((line, index) => {
			if (line !== "f*") return [];
			let start = index;
			while (start > 0 && lines[start - 1].endsWith(" h")) start--;
			return lines.slice(start, index);
		});
		assert.equal(painted.length, rings.length, layer);
		for (const ring of rings)
			assert.ok(
				pdf.pages[page].content.includes(
					`${n(ring[0][0])} ${n(ring[0][1])} m `,
				),
				layer,
			);
		assert.doesNotMatch(bare.pages[page].content, /\nf\*/);
	}
	for (const page of pdf.pages.slice(2))
		if (!page.text[0].endsWith("solder mask"))
			assert.doesNotMatch(page.content, /\nf\*/, page.text[0]);
	const backOnly = (shape: EditorShape) =>
		!zones.includes(shape) &&
		shapeLayers(shape).length === 1 &&
		shapeLayers(shape)[0] === "B.Cu";
	assert.ok(design.board.some(backOnly));
	for (const board of [
		design.board,
		design.board.filter((shape) => !backOnly(shape)),
	]) {
		const stacked = boardExportShapes(board);
		const svg = exportDrawingSvg(stacked, {
			...options,
			area: "drawing",
			width: 1000,
			height: 1000,
			zoneFills,
		});
		assert.equal(svg.match(/fill-rule="evenodd"/g)?.length, zones.length);
		const names = [...svg.matchAll(/data-name="([^"]*)"/g)].map(
			([, name]) => name,
		);
		const top = (shape: EditorShape) =>
			Math.max(
				-1,
				...shapeLayers(shape).map((layer) => boardDrawOrder.indexOf(layer)),
			);
		for (const fill of zoneFills) {
			assert.ok(!names.includes(`rectangle ${fill.shapeId}`));
			const at = names.indexOf(`zone fill ${fill.shapeId}`);
			const rank = boardDrawOrder.indexOf(fill.layer);
			for (const shape of stacked) {
				if (zones.includes(shape)) continue;
				const index = names.indexOf(`${shape.kind} ${shape.id}`);
				assert.ok(index >= 0, `${shape.kind} ${shape.id}`);
				assert.equal(
					index > at,
					top(shape) >= rank,
					`${shape.kind} ${shape.id} on ${shapeLayers(shape).join(", ")} against the ${fill.layer} fill`,
				);
			}
		}
	}
});

test("a board export opens the solder mask pages at each pad and unplated hole, where the mask Gerber flashes them", async () => {
	const design = await exampleDesigns.rp2350a.load();
	const shapes = boardExportShapes(design.board);
	const openings = (maskMargin: number) => {
		const pdf = parsePdf(
			exportDrawingPdf(shapes, {
				...options,
				area: "drawing",
				title: design.name,
				layers: true,
				maskMargin,
			}),
		);
		return ["Front solder mask", "Back solder mask"].map((label) => {
			const page = pdf.pages.find(({ text }) => text[0] === label);
			assert.ok(page, label);
			const lines = page.content.split("\n");
			return lines.flatMap((line, index) =>
				lines[index + 1] === "f*" && line.endsWith(" h")
					? [
							(line.match(/-?[\d.]+ -?[\d.]+ [ml]/g) ?? []).map((point) =>
								point.split(" ").slice(0, 2).map(Number),
							),
						]
					: [],
			);
		});
	};
	const inside = (ring: number[][], [x, y]: number[]) => {
		let crossings = 0;
		for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
			const [xi, yi] = ring[i];
			const [xj, yj] = ring[j];
			if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
				crossings++;
		}
		return crossings % 2 === 1;
	};
	const extent = (rings: number[][][]) =>
		rings.map((ring) => {
			const xs = ring.map(([x]) => x);
			return Math.max(...xs) - Math.min(...xs);
		});
	const margin = 0.05;
	const sides = openings(margin);
	const files = exportFabrication("rp2350a", design.board, [], margin);
	for (const [side, suffix] of [
		[0, "F_Mask.gts"],
		[1, "B_Mask.gbs"],
	] as const) {
		const flashes = [
			...(files
				.find((file) => file.name.endsWith(suffix))
				?.content.matchAll(/X(-?\d+)Y(-?\d+)D03\*/g) ?? []),
		].map(([, x, y]) => [Number(x) / 1e6, Number(y) / 1e6]);
		assert.ok(flashes.length > 0, suffix);
		assert.equal(sides[side].length, flashes.length, suffix);
		for (const flash of flashes)
			assert.ok(
				sides[side].some((ring) => inside(ring, flash)),
				`${suffix} flash at ${flash}`,
			);
	}
	const bare = openings(0);
	for (const side of [0, 1])
		for (const [index, width] of extent(sides[side]).entries())
			assert.ok(
				Math.abs(width - extent(bare[side])[index] - 2 * margin) < 2e-3,
				`opening ${index} grows by the margin on each side`,
			);
});
