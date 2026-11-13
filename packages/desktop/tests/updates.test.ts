import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	utimes,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { DesktopUpdateState } from "#/bridge.ts";
import {
	compareDebianVersions,
	DesktopUpdater,
	releaseChanges,
	removeStaleDownloads,
	selectReleasePackage,
} from "#/main/updates.ts";
import { describeVersion } from "#/renderer/UpdateButton.tsx";

const current = "0.0.0+git20261106090507.fa42a8d";
const next = "0.0.0+git20261112101500.cc12657";
const bytes = new Uint8Array(250_000).map((_, index) => index % 251);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const notes = `## What's Changed
* Orbit the Gerber 3D view by @rolaca11 in https://github.com/ropi-dev/ecad/pull/164
* Bump actions by @dependabot[bot] in https://github.com/ropi-dev/ecad/pull/165

## New Contributors
* @someone made their first contribution in https://github.com/ropi-dev/ecad/pull/165

**Full Changelog**: https://github.com/ropi-dev/ecad/compare/a...b`;
const changes = ["Orbit the Gerber 3D view (#164)", "Bump actions (#165)"];

function release(overrides: Record<string, unknown> = {}) {
	return {
		body: notes,
		assets: [
			{
				name: `ecad_${next}_arm64.deb`,
				browser_download_url: "https://github.com/ropi-dev/ecad/arm64.deb",
				size: bytes.length,
				digest: `sha256:${sha256}`,
			},
			{
				name: `ecad_${next}_amd64.deb`,
				browser_download_url: "https://github.com/ropi-dev/ecad/amd64.deb",
				size: bytes.length,
				digest: `sha256:${sha256}`,
				...overrides,
			},
		],
	};
}

test("Debian versions compare like dpkg", () => {
	const ordered = [
		"0.0.0~rc1",
		"0.0.0",
		"0.0.0+git20261106090507.fa42a8d",
		"0.0.0+git20261112101500.0",
		"0.0.1",
		"0.0.10",
		"1.0-1",
		"1.0-1ubuntu1",
		"1.0-2",
		"1:0.0.1",
	];
	for (const [index, earlier] of ordered.entries())
		for (const later of ordered.slice(index + 1)) {
			assert.ok(
				compareDebianVersions(later, earlier) > 0,
				`${later} > ${earlier}`,
			);
			assert.ok(
				compareDebianVersions(earlier, later) < 0,
				`${earlier} < ${later}`,
			);
		}
	assert.equal(compareDebianVersions("1.00", "1.0"), 0);
	if (spawnSync("dpkg", ["--version"]).status !== 0) return;
	for (const [index, earlier] of ordered.entries())
		for (const later of ordered.slice(index + 1))
			assert.equal(
				spawnSync("dpkg", ["--compare-versions", later, "gt", earlier]).status,
				0,
			);
});

test("the release package matches the architecture and needs a checksum", () => {
	assert.deepEqual(selectReleasePackage(release(), "amd64", current), {
		version: next,
		url: "https://github.com/ropi-dev/ecad/amd64.deb",
		size: bytes.length,
		sha256,
		changes,
	});
	const missing = /no package for armhf/;
	assert.throws(
		() => selectReleasePackage(release(), "armhf", current),
		missing,
	);
	for (const overrides of [
		{ digest: null },
		{ name: "ecad_$(id)_amd64.deb" },
		{ browser_download_url: "http://example.com/amd64.deb" },
	])
		assert.throws(
			() => selectReleasePackage(release(overrides), "amd64", current),
			/no package for amd64/,
		);
	assert.throws(
		() => selectReleasePackage({ message: "Not Found" }, "amd64", current),
		/unexpected response/,
	);
	assert.equal(
		selectReleasePackage(
			{ ...release(), body: "x".repeat(200_000) },
			"amd64",
			current,
		).version,
		next,
	);
});

test("the changes cover only the releases newer than the installed one", () => {
	const middle = "0.0.0+git20261109120000.ab12cd3";
	const build = (version: string, body: string, extra = {}) => ({
		...release({ name: `ecad_${version}_amd64.deb` }),
		body,
		...extra,
	});
	const feed = [
		build(middle, "* Middle change"),
		build(next, "* Newest change\n* Middle change"),
		build(current, "* Installed change"),
		build("0.0.0+git20261101000000.0", "* Old change"),
		build("0.0.0+git20261113000000.0", "* Draft change", { draft: true }),
		build("0.0.0+git20261113000001.0", "* Beta change", { prerelease: true }),
	];
	const selected = selectReleasePackage(feed, "amd64", current);
	assert.equal(selected.version, next);
	assert.deepEqual(selected.changes, ["Newest change", "Middle change"]);
	assert.deepEqual(selectReleasePackage(feed, "amd64", next).changes, []);
	assert.deepEqual(selectReleasePackage(feed, "amd64", middle).changes, [
		"Newest change",
		"Middle change",
	]);
});

test("release notes become a list of changes", () => {
	assert.deepEqual(releaseChanges(notes), changes);
	assert.deepEqual(releaseChanges("- Plain item\r\nText"), ["Plain item"]);
	assert.deepEqual(releaseChanges(null), []);
});

test("build versions read as their date and commit", () => {
	assert.match(describeVersion(next), /^the .*2026.* build \(cc12657\)$/);
	assert.equal(describeVersion("1.2.3"), "version 1.2.3");
});

interface Feed {
	body: unknown;
	download: Uint8Array<ArrayBuffer>;
	fail?: boolean;
	redirect?: string;
	stall?: boolean;
}

async function withUpdater(
	run: (context: {
		updater: DesktopUpdater;
		states: DesktopUpdateState[];
		installed: string[];
		directory: string;
		feed: Feed;
	}) => Promise<void>,
) {
	const directory = await mkdtemp(join(tmpdir(), "ecad-updates-"));
	const states: DesktopUpdateState[] = [];
	const installed: string[] = [];
	const feed: Feed = { body: release(), download: bytes };
	const updater = new DesktopUpdater({
		currentVersion: current,
		architecture: "amd64",
		temporaryDirectory: directory,
		timeout: 100,
		fetch: async (url, init) => {
			if (feed.fail) throw new Error("offline");
			if (url.endsWith(".deb") && feed.stall)
				return new Response(
					new ReadableStream({
						start(controller) {
							init?.signal?.addEventListener("abort", () =>
								controller.error(init.signal?.reason),
							);
						},
					}),
				);
			if (url.endsWith(".deb")) {
				const response = new Response(feed.download);
				if (feed.redirect)
					Object.defineProperty(response, "url", { value: feed.redirect });
				return response;
			}
			return Response.json(feed.body);
		},
		onChange: (state) => states.push(state),
		install: async (path) => {
			assert.equal((await stat(join(path, ".."))).mode & 0o777, 0o755);
			assert.deepEqual(new Uint8Array(await readFile(path)), bytes);
			installed.push(path);
		},
	});
	try {
		await run({ updater, states, installed, directory, feed });
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

test("an update downloads, verifies and installs, then waits for a restart", () =>
	withUpdater(async ({ updater, states, installed, directory }) => {
		const latest = { version: next, changes };
		await updater.check();
		assert.deepEqual(updater.state, { status: "available", latest });
		await Promise.all([updater.install(), updater.install()]);
		assert.deepEqual(updater.state, { status: "installed", latest });
		assert.equal(installed.length, 1);
		const statuses = states.map(({ status }) => status);
		assert.deepEqual(statuses.slice(0, 2), ["checking", "available"]);
		assert.ok(statuses.includes("downloading"));
		assert.deepEqual(statuses.slice(-2), ["installing", "installed"]);
		const progress = states.flatMap((state) =>
			state.status === "downloading" ? [state.progress] : [],
		);
		assert.deepEqual(
			progress,
			[...progress].sort((a, b) => a - b),
		);
		assert.equal(progress.at(-1), 1);
		assert.deepEqual(await readdir(directory), []);
		await updater.check();
		assert.deepEqual(updater.state, { status: "installed", latest });
	}));

test("a corrupt download fails without installing and can be retried", () =>
	withUpdater(async ({ updater, installed, feed }) => {
		await updater.check();
		feed.download = bytes.map((byte) => byte ^ 1);
		await updater.install();
		assert.equal(updater.state.status, "failed");
		assert.match(
			(updater.state as { message: string }).message,
			/does not match its checksum/,
		);
		assert.equal(installed.length, 0);
		feed.download = bytes.slice(0, 1000);
		await updater.install();
		assert.match((updater.state as { message: string }).message, /ended early/);
		feed.download = bytes;
		await updater.install();
		assert.equal(updater.state.status, "installed");
	}));

test("checks report failures, current releases and newer ones", () =>
	withUpdater(async ({ updater, feed }) => {
		const status = (): string => updater.state.status;
		feed.fail = true;
		await updater.check();
		assert.deepEqual(updater.state, {
			status: "idle",
			latest: undefined,
			checkError: "offline",
		});
		feed.fail = false;
		feed.body = release({ name: `ecad_${current}_amd64.deb` });
		await updater.check();
		assert.deepEqual(updater.state, {
			status: "idle",
			latest: { version: current, changes: [] },
		});
		feed.body = release();
		await updater.check();
		assert.equal(status(), "available");
		feed.body = release({ name: `ecad_${current}_amd64.deb` });
		await updater.check();
		assert.equal(status(), "idle");
		await updater.install();
		assert.equal(status(), "idle");
		feed.body = { ...release(), assets: release().assets.slice(0, 1) };
		await updater.check();
		assert.match(
			(updater.state as { checkError?: string }).checkError ?? "",
			/no package for amd64/,
		);
	}));

test("a retry after a failure reads the release again", () =>
	withUpdater(async ({ updater, installed, feed }) => {
		feed.body = release({ digest: `sha256:${"0".repeat(64)}` });
		await updater.check();
		await updater.install();
		assert.match(
			(updater.state as { message: string }).message,
			/does not match its checksum/,
		);
		feed.body = release();
		await updater.install();
		assert.equal(updater.state.status, "installed");
		assert.equal(installed.length, 1);
	}));

test("a download redirected to plain HTTP is rejected", () =>
	withUpdater(async ({ updater, installed, feed }) => {
		await updater.check();
		feed.redirect = "http://example.com/amd64.deb";
		await updater.install();
		assert.match(
			(updater.state as { message: string }).message,
			/redirected to an insecure URL/,
		);
		assert.equal(installed.length, 0);
	}));

test("startup removes the user's day-old update downloads only", async () => {
	const directory = await mkdtemp(join(tmpdir(), "ecad-stale-"));
	try {
		for (const name of ["ecad-update-old", "ecad-update-new", "other-old"])
			await mkdir(join(directory, name));
		const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
		for (const name of ["ecad-update-old", "other-old"])
			await utimes(join(directory, name), old, old);
		await removeStaleDownloads(directory);
		assert.deepEqual((await readdir(directory)).sort(), [
			"ecad-update-new",
			"other-old",
		]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("a stalled download fails instead of waiting forever", () =>
	withUpdater(async ({ updater, installed, feed }) => {
		await updater.check();
		feed.stall = true;
		await updater.install();
		assert.match(
			(updater.state as { message: string }).message,
			/download stalled/,
		);
		assert.equal(installed.length, 0);
	}));
