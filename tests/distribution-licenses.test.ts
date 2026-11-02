import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stepSourceAssets } from "../scripts/distribution-licenses.ts";

test("distribution rejects corrupt cached STEP source without fetching a replacement", async () => {
	const directory = await mkdtemp(join(tmpdir(), "ecad-license-integrity-"));
	const manifest = JSON.parse(
		await readFile(
			new URL("../licenses/step-sources.json", import.meta.url),
			"utf8",
		),
	);
	await writeFile(
		join(directory, manifest.archives[0].filename),
		"corrupt source archive",
	);
	const previousCache = process.env.ECAD_LICENSE_CACHE;
	const originalFetch = globalThis.fetch;
	process.env.ECAD_LICENSE_CACHE = directory;
	globalThis.fetch = async () => {
		throw new Error("Unexpected network request");
	};
	try {
		await assert.rejects(stepSourceAssets(), /Source checksum mismatch/);
	} finally {
		globalThis.fetch = originalFetch;
		if (previousCache === undefined) delete process.env.ECAD_LICENSE_CACHE;
		else process.env.ECAD_LICENSE_CACHE = previousCache;
		await rm(directory, { recursive: true, force: true });
	}
});
