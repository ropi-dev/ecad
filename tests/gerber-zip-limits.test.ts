import assert from "node:assert/strict";
import test from "node:test";
import { strFromU8, strToU8, zipSync } from "fflate";
import {
	expandGerberFile,
	MAX_GERBER_ARCHIVE_LENGTH,
} from "#/formats/expandGerberFile.ts";
import {
	GERBER_EXTENSIONS,
	hasGerberExtension,
	MAX_GERBER_SOURCE_LENGTH,
} from "#/formats/gerber/detect.ts";
import { gerberParser } from "#/formats/gerber/index.ts";
import { ArchiveError } from "#/formats/import-effects.ts";
import { patchZipEntry } from "./helpers/zip";

const MiB = 1024 * 1024;
const gerber = (fileFunction: string) =>
	strToU8(
		`%TF.FileFunction,${fileFunction}*%%FSLAX46Y46*%%MOMM*%%ADD10C,1*%D10*X0Y0D03*M02*`,
	);

const expand = (archive: Uint8Array) =>
	expandGerberFile(
		new File([new Uint8Array(archive)], "board.zip"),
		new AbortController().signal,
	);

test("a ZIP entry declaring a huge size is skipped without inflating it", async () => {
	const archive = zipSync(
		{
			"board/top.gtl": gerber("Copper,L1,Top"),
			"board/bomb.gbr": new Uint8Array(64 * 1024),
		},
		{ level: 9 },
	);
	patchZipEntry(archive, "board/bomb.gbr", {
		originalSize: 0xf000_0000,
		corrupt: true,
	});
	assert.ok(archive.length < 1024, "the bomb compresses to a few bytes");
	const { files, messages } = await expand(archive);
	assert.deepEqual(
		files.map((file) => file.name),
		["board/top.gtl"],
	);
	assert.deepEqual(messages, [
		"Skipped board/bomb.gbr (larger than the 64 MiB Gerber file limit).",
	]);
});

test("large entries inflate without fflate workers, which would each copy the whole archive", async (t) => {
	const workers = t.mock.fn();
	process.on("worker", workers);
	t.after(() => process.off("worker", workers));
	// Over 512 KiB and highly compressible: fflate's async unzip sends these to workers.
	const source = `%TF.FileFunction,Copper,L1,Top*%%FSLAX46Y46*%%MOMM*%%ADD10C,1*%${"G04 padding*\n".repeat(80 * 1024)}D10*X0Y0D03*M02*`;
	const archive = zipSync({
		"top.gtl": strToU8(source),
		"bottom.gbl": strToU8(source.replace("L1,Top", "L2,Bot")),
		"manual.pdf": [new Uint8Array(8 * MiB), { level: 0 }],
	});
	const { files, messages } = await expand(archive);
	assert.deepEqual(
		files.map((file) => [file.name, file.size]),
		[
			["bottom.gbl", source.length],
			["top.gtl", source.length],
		],
	);
	assert.deepEqual(messages, []);
	assert.equal(workers.mock.callCount(), 0);
});

test("the archive limit counts declared sizes and reports each overflowing entry", async () => {
	const count = Math.floor(MAX_GERBER_ARCHIVE_LENGTH / (60 * MiB)) + 2;
	const names = Array.from({ length: count }, (_, index) => `layer-${index}.gbr`);
	const archive = zipSync(
		Object.fromEntries(names.map((name) => [name, gerber("Other,Comment")])),
		{ level: 0 },
	);
	// Stored entries copy only their real bytes, so the declared sizes cost nothing here.
	for (const name of names)
		patchZipEntry(archive, name, { originalSize: 60 * MiB });
	const { files, messages } = await expand(archive);
	assert.deepEqual(
		files.map((file) => file.name),
		names.slice(0, count - 2),
	);
	assert.deepEqual(messages, [
		`Skipped ${names.slice(-2).join(", ")} (over the 256 MiB limit for one ZIP archive).`,
	]);
});

test("many skipped entries are summarized in one message", async () => {
	const names = Array.from({ length: 6 }, (_, index) => `huge-${index}.gbr`);
	const archive = zipSync(
		{
			"top.gtl": gerber("Copper,L1,Top"),
			...Object.fromEntries(names.map((name) => [name, gerber("Other")])),
		},
		{ level: 0 },
	);
	for (const name of names)
		patchZipEntry(archive, name, { originalSize: MAX_GERBER_SOURCE_LENGTH + 1 });
	assert.deepEqual((await expand(archive)).messages, [
		"Skipped huge-0.gbr, huge-1.gbr, huge-2.gbr and 3 more files (larger than the 64 MiB Gerber file limit).",
	]);
});

test("an unsupported compression method skips only that entry", async () => {
	const archive = zipSync({
		"top.gtl": gerber("Copper,L1,Top"),
		"bottom.gbl": gerber("Copper,L2,Bot"),
	});
	patchZipEntry(archive, "bottom.gbl", { compression: 12 });
	const { files, messages } = await expand(archive);
	assert.deepEqual(
		files.map((file) => file.name),
		["top.gtl"],
	);
	assert.deepEqual(messages, [
		"Skipped bottom.gbl (unsupported ZIP compression method).",
	]);
});

test("binary and non-Gerber entries are skipped and only file headers are decoded", async (t) => {
	const binary = new Uint8Array(4096);
	binary.set(strToU8("%FSLAX46Y46*%%MOMM*%"), 16);
	const archive = zipSync({
		"board/top.gtl": gerber("Copper,L1,Top"),
		"board/bottom.txt": gerber("Copper,L2,Bot"),
		"board/blob": binary,
		"board/notes.txt": strToU8("Assembly notes\n".repeat(64 * 1024)),
		"board/fab.pdf": strToU8("%PDF-1.7 %MOMM*%"),
		"board/board.gbrjob": strToU8('{"Header":{}}'),
	});
	// Inflating either of these would fail the archive or allocate 3.75 GiB.
	patchZipEntry(archive, "board/fab.pdf", {
		originalSize: 0xf000_0000,
		corrupt: true,
	});
	patchZipEntry(archive, "board/board.gbrjob", { corrupt: true });
	const decode = t.mock.method(TextDecoder.prototype, "decode");
	const { files, messages } = await expand(archive);
	assert.deepEqual(
		files.map((file) => file.name),
		["board/bottom.txt", "board/top.gtl"],
	);
	assert.deepEqual(messages, []);
	assert.ok(decode.mock.calls.length > 0);
	for (const call of decode.mock.calls)
		assert.ok((call.arguments[0] as Uint8Array).byteLength <= 8 * 1024);
	decode.mock.restore();
	assert.equal(await files[0].text(), strFromU8(gerber("Copper,L2,Bot")));
});

test("archives without importable Gerber files fail with the skipped entries", async () => {
	const oversized = zipSync({ "bomb.gbr": new Uint8Array(1024) });
	patchZipEntry(oversized, "bomb.gbr", { originalSize: 0xf000_0000 });
	await assert.rejects(
		expand(oversized),
		(error) =>
			error instanceof ArchiveError &&
			error.message ===
				"This ZIP archive contains no Gerber files within the import limits. Skipped bomb.gbr (larger than the 64 MiB Gerber file limit).",
	);
	await assert.rejects(
		expand(zipSync({ "fab.pdf": strToU8("%PDF-1.7") })),
		(error) =>
			error instanceof ArchiveError &&
			error.message === "This ZIP archive contains no Gerber files.",
	);
});

test("the parser and ZIP expander share Gerber extension detection", async () => {
	assert.equal(gerberParser.extensions, GERBER_EXTENSIONS);
	for (const extension of GERBER_EXTENSIONS)
		assert.ok(hasGerberExtension(`board.${extension.toUpperCase()}`));
	const cases: Record<string, boolean> = {
		"board.gbr": true,
		"board.GTL": true,
		"board.gbx": true,
		"board.gta": true,
		"board.gko": true,
		"board.gm15": true,
		"board.g2": true,
		"board.gl10": true,
		"board.pho": true,
		"board.sts": true,
		"board.drl": false,
		"board.txt": false,
		"board.gbrjob": false,
		"board.pdf": false,
		"board.g": false,
		"board.gmx": false,
		"gbr.d/README": false,
	};
	// Legacy data without format headers is accepted only through its extension.
	const legacy = "G04 legacy*\nD10*X0Y0D03*\nM02*";
	const accepted = Object.keys(cases).filter((name) => cases[name]);
	for (const [name, expected] of Object.entries(cases)) {
		assert.equal(hasGerberExtension(name), expected, name);
		assert.equal(gerberParser.detect(legacy, name), expected, name);
	}
	const { files } = await expand(
		zipSync(
			Object.fromEntries(
				Object.keys(cases).map((name) => [name, strToU8(legacy)]),
			),
		),
	);
	assert.deepEqual(files.map((file) => file.name).sort(), accepted.sort());
});
