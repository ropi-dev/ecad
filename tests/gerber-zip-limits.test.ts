import assert from "node:assert/strict";
import test, { after } from "node:test";
import { strFromU8, strToU8, zipSync } from "fflate";
import { expandGerberFile } from "#/formats/expandGerberFile.ts";
import { ArchiveError } from "#/formats/import-effects.ts";
import { installArchiveWorker } from "./helpers/archive-worker";
import { patchZipEntry } from "./helpers/zip";

const archiveWorker = installArchiveWorker();
after(archiveWorker.restore);
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
	assert.equal(messages.length, 1);
	assert.match(messages[0], /board\/bomb\.gbr/);
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
		(error) => error instanceof ArchiveError && /bomb\.gbr/.test(error.message),
	);
	await assert.rejects(
		expand(zipSync({ "fab.pdf": strToU8("%PDF-1.7") })),
		ArchiveError,
	);
});
