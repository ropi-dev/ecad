import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { chmod, lstat, mkdtemp, open, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import { z } from "zod";
import type { DesktopRelease, DesktopUpdateState } from "#/bridge.ts";

export const releaseFeedUrl =
	"https://api.github.com/repos/ropi-dev/ecad/releases?per_page=50";
const firstCheckDelay = 10_000;
const checkInterval = 6 * 60 * 60 * 1000;
const staleDownloadAge = 24 * 60 * 60 * 1000;
const networkTimeout = 60_000;

const distributionSchema = z.object({
	updates: z.object({
		format: z.literal("deb"),
		architecture: z.string().regex(/^[a-z0-9]+$/),
	}),
});

/** @return null when the app was not installed from the Debian package. */
export function readPackagedDistribution(appPath: string) {
	try {
		const result = distributionSchema.safeParse(
			JSON.parse(readFileSync(join(appPath, "package.json"), "utf8")),
		);
		return result.success ? result.data.updates : null;
	} catch {
		return null;
	}
}

const releaseSchema = z.object({
	draft: z.boolean().optional(),
	prerelease: z.boolean().optional(),
	body: z.string().nullish(),
	assets: z.array(
		z.object({
			name: z.string(),
			browser_download_url: z.string(),
			size: z.number().int().positive(),
			digest: z.string().nullish(),
		}),
	),
});

const versionPattern = /^(?:\d+:)?\d[A-Za-z0-9.+~-]*$/;

function characterOrder(character: string | undefined) {
	if (character === undefined || /\d/.test(character)) return 0;
	if (character === "~") return -1;
	if (/[A-Za-z]/.test(character)) return character.charCodeAt(0);
	return character.charCodeAt(0) + 256;
}

function isDigit(character: string | undefined) {
	return character !== undefined && character >= "0" && character <= "9";
}

function compareFragment(a: string, b: string) {
	let i = 0;
	let j = 0;
	while (i < a.length || j < b.length) {
		while (
			(i < a.length && !isDigit(a[i])) ||
			(j < b.length && !isDigit(b[j]))
		) {
			const difference = characterOrder(a[i]) - characterOrder(b[j]);
			if (difference) return difference;
			i++;
			j++;
		}
		while (a[i] === "0") i++;
		while (b[j] === "0") j++;
		let first = 0;
		while (isDigit(a[i]) && isDigit(b[j])) {
			if (!first) first = a.charCodeAt(i) - b.charCodeAt(j);
			i++;
			j++;
		}
		if (isDigit(a[i])) return 1;
		if (isDigit(b[j])) return -1;
		if (first) return first;
	}
	return 0;
}

function splitVersion(version: string) {
	const colon = version.indexOf(":");
	const epoch = colon < 0 ? 0 : Number(version.slice(0, colon));
	const rest = colon < 0 ? version : version.slice(colon + 1);
	const hyphen = rest.lastIndexOf("-");
	return hyphen < 0
		? { epoch, upstream: rest, revision: "" }
		: {
				epoch,
				upstream: rest.slice(0, hyphen),
				revision: rest.slice(hyphen + 1),
			};
}

export function compareDebianVersions(a: string, b: string) {
	const left = splitVersion(a);
	const right = splitVersion(b);
	if (left.epoch !== right.epoch) return left.epoch - right.epoch;
	return (
		compareFragment(left.upstream, right.upstream) ||
		compareFragment(left.revision, right.revision)
	);
}

export interface ReleasePackage {
	version: string;
	url: string;
	size: number;
	sha256: string;
	changes: string[];
}

export function releaseChanges(body: string | null | undefined) {
	return (body ?? "").split(/\r?\n/).flatMap((line) => {
		const item = /^\s*[*-]\s+(.+)$/.exec(line)?.[1];
		if (!item || item.includes("made their first contribution")) return [];
		return [
			item
				.replace(
					/ by @[\w-]+(?:\[bot\])? in https:\/\/github\.com\/\S+\/pull\/(\d+)$/,
					" (#$1)",
				)
				.trim(),
		];
	});
}

function releasePackage(
	release: z.infer<typeof releaseSchema>,
	architecture: string,
	feedUrl: string,
) {
	const suffix = `_${architecture}.deb`;
	for (const asset of release.assets) {
		if (!asset.name.startsWith("ecad_") || !asset.name.endsWith(suffix))
			continue;
		const version = asset.name.slice("ecad_".length, -suffix.length);
		const sha256 = /^sha256:([0-9a-f]{64})$/.exec(asset.digest ?? "")?.[1];
		if (!versionPattern.test(version) || !sha256) continue;
		const url = new URL(asset.browser_download_url, feedUrl);
		if (!isAllowedDownload(url.href, feedUrl)) continue;
		return { version, url: url.href, size: asset.size, sha256 };
	}
	return null;
}

export function selectReleasePackage(
	value: unknown,
	architecture: string,
	currentVersion: string,
	feedUrl = releaseFeedUrl,
): ReleasePackage {
	const parsed = z
		.union([
			releaseSchema.transform((release) => [release]),
			z.array(releaseSchema),
		])
		.safeParse(value);
	if (!parsed.success)
		throw new Error("The release feed sent an unexpected response.");
	const releases = parsed.data
		.filter((release) => !release.draft && !release.prerelease)
		.flatMap((release) => {
			const found = releasePackage(release, architecture, feedUrl);
			return found ? [{ found, body: release.body }] : [];
		})
		.sort((a, b) => compareDebianVersions(b.found.version, a.found.version));
	const newest = releases[0]?.found;
	if (!newest)
		throw new Error(`The releases have no package for ${architecture}.`);
	const changes = releases
		.filter(
			({ found }) => compareDebianVersions(found.version, currentVersion) > 0,
		)
		.flatMap(({ body }) => releaseChanges(body));
	return { ...newest, changes: [...new Set(changes)] };
}

function isAllowedDownload(url: string, feedUrl: string) {
	const parsed = new URL(url);
	return (
		parsed.protocol === "https:" || parsed.origin === new URL(feedUrl).origin
	);
}

export async function removeStaleDownloads(directory: string) {
	for (const name of await readdir(directory)) {
		if (!name.startsWith("ecad-update-")) continue;
		const path = join(directory, name);
		const metadata = await lstat(path);
		if (
			metadata.isDirectory() &&
			metadata.uid === process.getuid?.() &&
			Date.now() - metadata.mtimeMs > staleDownloadAge
		)
			await rm(path, { recursive: true, force: true });
	}
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface DesktopUpdaterOptions {
	currentVersion: string;
	architecture: string;
	temporaryDirectory: string;
	fetch: Fetch;
	onChange: (state: DesktopUpdateState) => void;
	feedUrl?: string;
	install?: (path: string) => Promise<void>;
	timeout?: number;
}

export class DesktopUpdater {
	state: DesktopUpdateState = { status: "idle" };
	private available: ReleasePackage | null = null;
	private readonly feedUrl: string;

	constructor(private readonly options: DesktopUpdaterOptions) {
		this.feedUrl = options.feedUrl ?? releaseFeedUrl;
	}

	private status(): DesktopUpdateState["status"] {
		return this.state.status;
	}

	start() {
		void removeStaleDownloads(this.options.temporaryDirectory).catch(
			() => undefined,
		);
		setTimeout(() => {
			void this.check();
			setInterval(() => void this.check(), checkInterval);
		}, firstCheckDelay);
	}

	async check() {
		const before = this.status();
		if (before !== "idle" && before !== "available" && before !== "failed")
			return;
		if (before === "idle")
			this.set({ status: "checking", latest: this.state.latest });
		let found: ReleasePackage;
		try {
			const response = await this.options.fetch(this.feedUrl, {
				headers: {
					Accept: "application/vnd.github+json",
					"X-GitHub-Api-Version": "2022-11-28",
				},
				signal: AbortSignal.timeout(this.options.timeout ?? networkTimeout),
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			found = selectReleasePackage(
				await response.json(),
				this.options.architecture,
				this.options.currentVersion,
				this.feedUrl,
			);
		} catch (cause) {
			const message = errorMessage(cause, "unknown error");
			console.warn(`The update check failed: ${message}`);
			if (this.status() === "checking")
				this.set({
					status: "idle",
					latest: this.state.latest,
					checkError: message,
				});
			else if (this.state.status === "failed")
				this.set({
					...this.state,
					message: `The update check failed: ${message}`,
				});
			return;
		}
		const after = this.status();
		if (after !== "checking" && after !== "available" && after !== "failed")
			return;
		const latest = { version: found.version, changes: found.changes };
		const newer =
			compareDebianVersions(found.version, this.options.currentVersion) > 0;
		this.available = newer ? found : null;
		this.set({ status: newer ? "available" : "idle", latest });
	}

	async install() {
		if (this.state.status === "failed") await this.check();
		const release = this.available;
		if (!release || this.state.status !== "available") return;
		const { latest } = this.state;
		this.set({ status: "downloading", latest, progress: 0 });
		let directory: string | undefined;
		try {
			directory = await mkdtemp(
				join(this.options.temporaryDirectory, "ecad-update-"),
			);
			await chmod(directory, 0o755);
			const path = join(directory, `ecad_${release.version}.deb`);
			await this.download(release, latest, path);
			this.set({ status: "installing", latest });
			await (this.options.install ?? installWithPkexec)(path);
			this.set({ status: "installed", latest });
		} catch (cause) {
			this.set({
				status: "failed",
				latest,
				message: errorMessage(cause, "The update could not be installed."),
			});
		} finally {
			if (directory) await rm(directory, { recursive: true, force: true });
		}
	}

	private async download(
		release: ReleasePackage,
		latest: DesktopRelease,
		path: string,
	) {
		const controller = new AbortController();
		let stall: ReturnType<typeof setTimeout> | undefined;
		const expectData = () => {
			clearTimeout(stall);
			stall = setTimeout(
				() => controller.abort(new Error("The update download stalled.")),
				this.options.timeout ?? networkTimeout,
			);
		};
		const hash = createHash("sha256");
		const file = await open(path, "wx", 0o644);
		let received = 0;
		let reported = 0;
		try {
			expectData();
			const response = await this.options.fetch(release.url, {
				signal: controller.signal,
			});
			if (!response.ok || !response.body)
				throw new Error(
					`The update download failed with HTTP ${response.status}.`,
				);
			if (!isAllowedDownload(response.url || release.url, this.feedUrl))
				throw new Error(
					"The update download was redirected to an insecure URL.",
				);
			const reader = response.body.getReader();
			for (;;) {
				const { done, value: chunk } = await reader.read();
				if (done) break;
				expectData();
				received += chunk.byteLength;
				if (received > release.size)
					throw new Error("The update download is larger than expected.");
				hash.update(chunk);
				await file.appendFile(chunk);
				const progress = received / release.size;
				if (progress - reported >= 0.01) {
					reported = progress;
					this.set({ status: "downloading", latest, progress });
				}
			}
		} finally {
			clearTimeout(stall);
			controller.abort();
			await file.close();
		}
		if (received !== release.size)
			throw new Error("The update download ended early.");
		if (hash.digest("hex") !== release.sha256)
			throw new Error("The downloaded update does not match its checksum.");
	}

	private set(state: DesktopUpdateState) {
		this.state = state;
		this.options.onChange(state);
	}
}

const waitThenStart =
	'i=0; while [ "$i" -lt 100 ] && kill -0 "$1" 2>/dev/null; do sleep 0.1; i=$((i + 1)); done; shift; exec "$0" "$@"';

export function relaunchAfterExit(
	executable: string,
	args: string[],
	pid = process.pid,
) {
	spawn("/bin/sh", ["-c", waitThenStart, executable, String(pid), ...args], {
		detached: true,
		stdio: "ignore",
	}).unref();
}

export function installWithPkexec(path: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(
			"/usr/bin/pkexec",
			[
				"/usr/bin/apt-get",
				"install",
				"--yes",
				"--no-remove",
				"-o",
				"DPkg::Lock::Timeout=120",
				path,
			],
			{ stdio: ["ignore", "ignore", "pipe"] },
		);
		let output = "";
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => {
			output = (output + chunk).slice(-4000);
		});
		child.on("error", (cause: NodeJS.ErrnoException) =>
			reject(
				cause.code === "ENOENT"
					? new Error(
							"Installing updates needs pkexec. Download the package from the release page and install it with apt.",
						)
					: cause,
			),
		);
		child.on("close", (code) => {
			if (code === 0) return resolve();
			if (code === 126)
				return reject(
					new Error(
						"The update was not installed. The password prompt was closed.",
					),
				);
			if (code === 127)
				return reject(
					new Error(
						"ECAD did not get permission to install the update. Check that a polkit authentication agent is running.",
					),
				);
			const detail = output
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => line.startsWith("E:"))
				.at(-1);
			reject(
				new Error(
					`apt-get could not install the update (exit code ${code}).${detail ? ` ${detail}` : ""}`,
				),
			);
		});
	});
}
