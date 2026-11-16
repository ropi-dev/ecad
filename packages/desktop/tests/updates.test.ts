import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
	chmod,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	readlink,
	rm,
	stat,
	symlink,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { DesktopUpdateState } from "#/bridge.ts";
import { parsePackageManifest } from "#/main/update-files.ts";
import {
	compareDebianVersions,
	DesktopUpdater,
	relaunchAfterExit,
	releaseChanges,
	removeStaleDownloads,
	selectReleasePackage,
} from "#/main/updates.ts";
import { describeVersion } from "#/renderer/UpdateButton.tsx";
import {
	controlFile,
	writeUpdateFiles,
} from "../../../scripts/packaging/deb.ts";

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

test("the nightly channel adds nightly pre-releases and skips the apt releases", () => {
	const nightly = "0.1.1~nightly.20261116";
	const build = (version: string, body: string, extra = {}) => ({
		...release({ name: `ecad_${version}_amd64.deb` }),
		body,
		...extra,
	});
	const feed = [
		build("0.1.0", "* Stable change", { tag_name: "v0.1.0" }),
		build("0.1.1-nightly.20261116", "* Nightly change", {
			tag_name: "v0.1.1-nightly.20261116",
			prerelease: true,
		}),
		build("0.1.2", "* Apt copy", { tag_name: "apt-nightly", prerelease: true }),
		build("0.1.3", "* Beta change", {
			tag_name: "v0.1.3-beta",
			prerelease: true,
		}),
	];
	assert.equal(selectReleasePackage(feed, "amd64", "0.0.9").version, "0.1.0");
	const selected = selectReleasePackage(
		feed,
		"amd64",
		"0.0.9",
		undefined,
		"nightly",
	);
	assert.equal(selected.version, nightly);
	assert.deepEqual(selected.changes, ["Nightly change", "Stable change"]);
	assert.equal(selectReleasePackage(feed, "amd64", nightly).version, "0.1.0");
	const installed = selectReleasePackage(
		feed,
		"amd64",
		nightly,
		undefined,
		"nightly",
	);
	assert.equal(installed.version, nightly);
	assert.deepEqual(installed.changes, []);
	const asset = (name: string) => ({
		name,
		browser_download_url: `https://github.com/ropi-dev/ecad/${name}`,
		size: 10,
		digest: `sha256:${sha256}`,
	});
	const tagged = "ecad_0.1.1-nightly.20261116_amd64";
	const files = selectReleasePackage(
		{
			tag_name: "v0.1.1-nightly.20261116",
			prerelease: true,
			assets: [
				asset(`${tagged}.deb`),
				asset(`${tagged}.files.json`),
				asset(`${tagged}.files.zst`),
			],
		},
		"amd64",
		"0.1.0",
		undefined,
		"nightly",
	);
	assert.equal(files.version, nightly);
	assert.equal(
		files.files?.manifest.url,
		`https://github.com/ropi-dev/ecad/${tagged}.files.json`,
	);
	const stable = build("0.1.1", "* Release", { tag_name: "v0.1.1" });
	assert.equal(
		selectReleasePackage(
			[...feed, stable],
			"amd64",
			nightly,
			undefined,
			"nightly",
		).version,
		"0.1.1",
	);
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

test("switching the channel checks the release feed again", () =>
	withUpdater(async ({ updater, feed }) => {
		const status = (): string => updater.state.status;
		feed.body = {
			...release(),
			tag_name: "v0.1.1-nightly.20261116",
			prerelease: true,
		};
		await updater.check();
		assert.match(
			(updater.state as { checkError?: string }).checkError ?? "",
			/no package for amd64/,
		);
		await updater.setChannel("nightly");
		assert.deepEqual(updater.state, {
			status: "available",
			latest: { version: next, changes },
		});
		await updater.setChannel("stable");
		assert.equal(status(), "idle");
		assert.match(
			(updater.state as { checkError?: string }).checkError ?? "",
			/no package for amd64/,
		);
		feed.body = [feed.body, release({ name: `ecad_${current}_amd64.deb` })];
		await Promise.all([updater.check(), updater.setChannel("nightly")]);
		assert.equal(status(), "available");
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

test("a restart starts the app again only after the old process exits, without no_new_privs", async () => {
	const directory = await mkdtemp(join(tmpdir(), "ecad-relaunch-"));
	const marker = join(directory, "started");
	const old = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"]);
	const exited = new Promise((resolve) => old.once("exit", resolve));
	try {
		relaunchAfterExit(
			"/bin/sh",
			["-c", 'grep NoNewPrivs /proc/self/status > "$0"', marker],
			old.pid,
		);
		await new Promise((resolve) => setTimeout(resolve, 500));
		await assert.rejects(stat(marker));
		old.kill();
		await exited;
		for (let i = 0; i < 50; i++) {
			const text = await readFile(marker, "utf8").catch(() => "");
			if (text) {
				assert.match(text, /^NoNewPrivs:\s+0$/m);
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		assert.fail("The app was not started again.");
	} finally {
		old.kill();
		await rm(directory, { recursive: true, force: true });
	}
});

const hasDpkgDeb = spawnSync("dpkg-deb", ["--version"]).status === 0;

interface TreeFile {
	content: string | Uint8Array;
	mode: number;
}

async function writeTree(
	tree: string,
	version: string,
	files: Record<string, TreeFile>,
) {
	const sums = [];
	for (const [path, { content, mode }] of Object.entries(files)) {
		await mkdir(dirname(join(tree, path)), { recursive: true });
		await writeFile(join(tree, path), content);
		await chmod(join(tree, path), mode);
		sums.push(`${createHash("md5").update(content).digest("hex")}  ${path}`);
	}
	await mkdir(join(tree, "usr/bin"), { recursive: true });
	await symlink("../lib/ecad/ecad-desktop", join(tree, "usr/bin/ecad-desktop"));
	await mkdir(join(tree, "usr/share/empty"), { recursive: true });
	await mkdir(join(tree, "DEBIAN"));
	await writeFile(
		join(tree, "DEBIAN/control"),
		controlFile({
			version,
			architecture: "amd64",
			installedSize: 1,
			maintainer: "Test <test@example.com>",
		}),
	);
	await writeFile(join(tree, "DEBIAN/md5sums"), `${sums.join("\n")}\n`);
}

async function withIncrementalRelease(
	run: (context: {
		updater: DesktopUpdater;
		requests: string[];
		installed: string[];
		built: { listing: string; version: string; out: string }[];
		packed: Record<string, TreeFile>;
		server: { ignoreRanges: boolean; hangThenCorrupt: boolean };
		directory: string;
	}) => Promise<void>,
) {
	const directory = await mkdtemp(join(tmpdir(), "ecad-delta-"));
	const electron = randomBytes(300_000);
	const installedFiles: Record<string, TreeFile> = {
		"usr/lib/ecad/ecad-desktop": { content: electron, mode: 0o755 },
		"usr/lib/ecad/chrome-sandbox": { content: "sandbox", mode: 0o4755 },
		"usr/lib/ecad/resources/app/main.js": { content: "old main", mode: 0o644 },
		"usr/lib/ecad/notes.txt": { content: "edited", mode: 0o644 },
	};
	const packed: Record<string, TreeFile> = {
		...installedFiles,
		"usr/lib/ecad/resources/app/main.js": { content: "new main", mode: 0o644 },
		"usr/lib/ecad/notes.txt": { content: "packed", mode: 0o644 },
		"usr/lib/ecad/resources/app/chunk-a.js": { content: "chunk", mode: 0o644 },
		"usr/lib/ecad/resources/app/chunk-b.js": { content: "chunk", mode: 0o644 },
	};
	await writeTree(join(directory, "installed"), current, installedFiles);
	await writeTree(join(directory, "next"), next, packed);
	const base = join(directory, `ecad_${next}_amd64`);
	await writeUpdateFiles(
		join(directory, "next"),
		{ version: next, architecture: "amd64" },
		{ manifest: `${base}.files.json`, pack: `${base}.files.zst` },
		3,
	);
	const manifest = await readFile(`${base}.files.json`);
	const pack = await readFile(`${base}.files.zst`);
	const deb = new Uint8Array(randomBytes(1_000_000));
	const asset = (name: string, bytes: Uint8Array) => ({
		name,
		browser_download_url: `https://github.com/ropi-dev/ecad/${name}`,
		size: bytes.length,
		digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
	});
	const feed = {
		body: notes,
		assets: [
			asset(`ecad_${next}_amd64.deb`, deb),
			asset(`ecad_${next}_amd64.files.json`, manifest),
			asset(`ecad_${next}_amd64.files.zst`, pack),
		],
	};
	const requests: string[] = [];
	const installed: string[] = [];
	const built: { listing: string; version: string; out: string }[] = [];
	const server = { ignoreRanges: false, hangThenCorrupt: false };
	let ranges = 0;
	const dpkgDeb = (...args: string[]) => {
		const result = spawnSync("dpkg-deb", args, { encoding: "utf8" });
		assert.equal(result.status, 0, result.stderr);
		return result.stdout;
	};
	const updater = new DesktopUpdater({
		currentVersion: current,
		architecture: "amd64",
		temporaryDirectory: directory,
		installedRoot: join(directory, "installed"),
		timeout: 10_000,
		fetch: async (url, init) => {
			const range = new Headers(init?.headers).get("range");
			const name = url.split("/").at(-1) ?? "";
			if (!url.includes("releases")) requests.push(`${name} ${range ?? ""}`);
			if (name.endsWith(".deb")) return new Response(deb);
			if (name.endsWith(".files.json")) return new Response(manifest);
			if (name.endsWith(".files.zst")) {
				const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(range ?? "") ?? [];
				if (server.ignoreRanges || !start || !end) return new Response(pack);
				const headers = {
					"content-range": `bytes ${start}-${end}/${pack.length}`,
				};
				ranges++;
				if (server.hangThenCorrupt && ranges === 1)
					return new Response(
						new ReadableStream({
							start(controller) {
								init?.signal?.addEventListener("abort", () =>
									controller.error(init.signal?.reason),
								);
							},
						}),
						{ status: 206, headers },
					);
				if (server.hangThenCorrupt)
					return new Response(new Uint8Array(Number(end) - Number(start) + 1), {
						status: 206,
						headers,
					});
				return new Response(pack.subarray(Number(start), Number(end) + 1), {
					status: 206,
					headers: {
						"content-range": `bytes ${start}-${end}/${pack.length}`,
					},
				});
			}
			return Response.json(feed);
		},
		onChange: () => undefined,
		install: async (path) => {
			installed.push(path);
			if (!path.includes("/incremental/")) {
				assert.deepEqual(new Uint8Array(await readFile(path)), deb);
				return;
			}
			const out = join(directory, `extracted-${installed.length}`);
			dpkgDeb("-x", path, out);
			built.push({
				listing: dpkgDeb("-c", path),
				version: dpkgDeb("-f", path, "Version").trim(),
				out,
			});
		},
	});
	try {
		await run({
			updater,
			requests,
			installed,
			built,
			packed,
			server,
			directory,
		});
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

test(
	"an update downloads only the files that differ from the installed ones",
	{ skip: !hasDpkgDeb && "dpkg-deb is not installed" },
	() =>
		withIncrementalRelease(
			async ({ updater, requests, built, packed, directory }) => {
				await updater.check();
				await updater.install();
				assert.deepEqual(updater.state, {
					status: "installed",
					latest: { version: next, changes },
				});
				assert.equal(requests[0], `ecad_${next}_amd64.files.json `);
				assert.equal(requests.length, 4, requests.join("\n"));
				assert.ok(
					requests.slice(1).every((request) => request.includes(".zst bytes=")),
				);
				assert.equal(built.length, 1);
				const [{ listing, version, out }] = built as [(typeof built)[number]];
				assert.equal(version, next);
				for (const [file, { content }] of Object.entries(packed))
					assert.deepEqual(
						new Uint8Array(await readFile(join(out, file))),
						new Uint8Array(Buffer.from(content)),
						file,
					);
				assert.equal(
					await readlink(join(out, "usr/bin/ecad-desktop")),
					"../lib/ecad/ecad-desktop",
				);
				assert.ok((await stat(join(out, "usr/share/empty"))).isDirectory());
				for (const [mode, file] of [
					["-rwsr-xr-x", "chrome-sandbox"],
					["-rwxr-xr-x", "ecad-desktop"],
					["-rw-r--r--", "notes.txt"],
				])
					assert.match(
						listing,
						new RegExp(`^${mode} root/root .* \\./usr/lib/ecad/${file}$`, "m"),
					);
				assert.deepEqual(
					(await readdir(directory)).filter((name) =>
						name.startsWith("ecad-update-"),
					),
					[],
				);
			},
		),
);

test(
	"a server that ignores byte ranges gets the whole package downloaded instead",
	{ skip: !hasDpkgDeb && "dpkg-deb is not installed" },
	(t) =>
		withIncrementalRelease(async ({ updater, requests, installed, server }) => {
			const warn = t.mock.method(console, "warn", () => undefined);
			server.ignoreRanges = true;
			await updater.check();
			await updater.install();
			assert.equal(updater.state.status, "installed");
			assert.equal(installed.length, 1);
			assert.ok(!installed[0]?.includes("/incremental/"));
			assert.equal(requests.at(-1), `ecad_${next}_amd64.deb `);
			assert.match(
				String(warn.mock.calls[0]?.arguments[0]),
				/ignored the byte range/,
			);
		}),
);

test("the update manifest keeps every path inside usr", () => {
	const file = {
		path: "usr/lib/ecad/ecad-desktop",
		mode: 0o755,
		size: 1,
		sha256: "0".repeat(64),
		offset: 0,
		length: 10,
	};
	const manifest = {
		format: 1,
		version: next,
		architecture: "amd64",
		control: "Package: ecad\n",
		md5sums: "",
		directories: ["usr", "usr/lib", "usr/lib/ecad", "usr/bin"],
		files: [file],
		links: [
			{ path: "usr/bin/ecad-desktop", target: "../lib/ecad/ecad-desktop" },
		],
	};
	const expected = { version: next, architecture: "amd64", packSize: 10 };
	assert.equal(parsePackageManifest(manifest, expected).files.length, 1);
	for (const change of [
		{ files: [{ ...file, path: "usr/lib/../../etc/passwd" }] },
		{ files: [{ ...file, path: "etc/passwd" }] },
		{ files: [{ ...file, mode: 0o6755 }] },
		{ files: [{ ...file, length: 11 }] },
		{ files: [file, file] },
		{ links: [{ path: "usr/bin/x", target: "/etc/passwd" }] },
		{ links: [{ path: "usr/bin/x", target: "../../etc/passwd" }] },
		{ version: current },
	])
		assert.throws(() =>
			parsePackageManifest({ ...manifest, ...change }, expected),
		);
});

test(
	"a failed range download cancels the others and falls back at once",
	{ skip: !hasDpkgDeb && "dpkg-deb is not installed" },
	(t) =>
		withIncrementalRelease(async ({ updater, installed, server }) => {
			t.mock.method(console, "warn", () => undefined);
			server.hangThenCorrupt = true;
			await updater.check();
			const started = Date.now();
			await updater.install();
			assert.equal(updater.state.status, "installed");
			assert.ok(!installed[0]?.includes("/incremental/"));
			assert.ok(Date.now() - started < 5000, "it did not wait for the stall");
		}),
);
