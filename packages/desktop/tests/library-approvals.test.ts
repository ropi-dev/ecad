import assert from "node:assert/strict";
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { configPaths } from "#/main/config-directory.ts";
import {
	ExternalLibraryApprovals,
	type ExternalLibraryRequest,
} from "#/main/library-approvals.ts";

async function withHome(run: (home: string) => Promise<void>) {
	const home = await mkdtemp(join(tmpdir(), "ecad-approvals-"));
	try {
		await run(home);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
}

test("approvals are remembered per project in the user's config directory", async () =>
	withHome(async (home) => {
		const asked: ExternalLibraryRequest[] = [];
		let answer = true;
		const confirm = async (request: ExternalLibraryRequest) => {
			asked.push(request);
			return answer;
		};
		const approvals = new ExternalLibraryApprovals({
			homeDirectory: home,
			confirm,
		});
		const request = {
			project: join(home, "project"),
			directory: join(home, "parts"),
		};
		assert.equal(await approvals.approve(request), true);
		assert.equal(await approvals.approve(request), true);
		assert.deepEqual(asked, [request]);
		assert.equal(
			approvals.path,
			join(configPaths(home).directory, "approved-libraries.json"),
		);
		assert.deepEqual(JSON.parse(await readFile(approvals.path, "utf8")), {
			version: 1,
			approvals: [request],
		});

		const restarted = new ExternalLibraryApprovals({
			homeDirectory: home,
			confirm,
		});
		assert.equal(await restarted.approve(request), true);
		assert.deepEqual(asked, [request]);

		// Another project that names the same directory is asked separately.
		answer = false;
		const other = {
			project: join(home, "downloaded"),
			directory: request.directory,
		};
		assert.equal(await restarted.approve(other), false);
		assert.equal(await restarted.approve(other), false);
		assert.deepEqual(asked, [request, other, other]);
		assert.deepEqual(
			JSON.parse(await readFile(approvals.path, "utf8")).approvals,
			[request],
		);
	}));

test("directories chosen in a native dialog are approved without asking again", async () =>
	withHome(async (home) => {
		const chosen = join(home, "chosen");
		const approvals = new ExternalLibraryApprovals({
			homeDirectory: home,
			chosen: (directory) => directory === chosen,
			confirm: async () =>
				assert.fail("The chosen directory should not need confirmation."),
		});
		assert.equal(
			await approvals.approve({
				project: join(home, "project"),
				directory: chosen,
			}),
			true,
		);
		assert.equal(
			await new ExternalLibraryApprovals({ homeDirectory: home }).approve({
				project: join(home, "project"),
				directory: chosen,
			}),
			true,
		);
		assert.equal(
			await new ExternalLibraryApprovals({ homeDirectory: home }).approve({
				project: join(home, "project"),
				directory: join(home, "other"),
			}),
			false,
		);
	}));

test("approvals without a prompt accept only stored and chosen directories", async () =>
	withHome(async (home) => {
		const chosen = new Set<string>();
		const approvals = new ExternalLibraryApprovals({
			homeDirectory: home,
			chosen: (directory) => chosen.has(directory),
			confirm: async () => assert.fail("prompt: false must not ask the user."),
		});
		const request = {
			project: join(home, "project"),
			directory: join(home, "parts"),
		};
		assert.equal(await approvals.approve(request, { prompt: false }), false);
		chosen.add(request.directory);
		assert.equal(await approvals.approve(request, { prompt: false }), true);
		assert.equal(
			await new ExternalLibraryApprovals({ homeDirectory: home }).approve(
				request,
				{ prompt: false },
			),
			true,
		);
	}));

test("unsaved projects keep approvals for the session only", async () =>
	withHome(async (home) => {
		const approvals = new ExternalLibraryApprovals({
			homeDirectory: home,
			confirm: async () => true,
		});
		const request = { project: "memory:1234", directory: join(home, "parts") };
		assert.equal(await approvals.approve(request), true);
		await assert.rejects(readFile(approvals.path), { code: "ENOENT" });
		assert.equal(
			await new ExternalLibraryApprovals({ homeDirectory: home }).approve(
				request,
			),
			false,
		);
	}));

test("damaged or unwritable approvals never approve a directory by themselves", async () =>
	withHome(async (home) => {
		const request = {
			project: join(home, "project"),
			directory: join(home, "parts"),
		};
		const directory = configPaths(home).directory;
		await mkdir(directory, { recursive: true });
		const path = join(directory, "approved-libraries.json");
		for (const contents of [
			"{",
			JSON.stringify({ version: 2, approvals: [request] }),
			JSON.stringify({ version: 1, approvals: [{ ...request, extra: true }] }),
		]) {
			await writeFile(path, contents);
			assert.equal(
				await new ExternalLibraryApprovals({ homeDirectory: home }).approve(
					request,
				),
				false,
			);
		}
		await rm(path);
		await chmod(directory, 0o555);
		try {
			const approvals = new ExternalLibraryApprovals({
				homeDirectory: home,
				confirm: async () => true,
			});
			assert.equal(await approvals.approve(request), true);
			assert.equal(
				await new ExternalLibraryApprovals({ homeDirectory: home }).approve(
					request,
				),
				false,
			);
		} finally {
			await chmod(directory, 0o755);
		}
	}));

test("approvals saved by older versions in ~/.ecad still apply", async () =>
	withHome(async (home) => {
		const request = {
			project: join(home, "project"),
			directory: join(home, "parts"),
		};
		await mkdir(join(home, ".ecad"));
		await writeFile(
			join(home, ".ecad", "approved-libraries.json"),
			JSON.stringify({ version: 1, approvals: [request] }),
		);
		assert.equal(
			await new ExternalLibraryApprovals({ homeDirectory: home }).approve(
				request,
				{ prompt: false },
			),
			true,
		);
	}));
