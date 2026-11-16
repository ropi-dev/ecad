import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { type Channel, compare, parse } from "./version.ts";

export const aptChannels: Channel[] = ["stable", "nightly"];
export const keptStableReleases = 3;
export const keptNightlies = 3;
export const keyringName = "ecad-archive-keyring.gpg";
export const repositoryUrl = "https://github.com/ropi-dev/ecad";

export interface ListedRelease {
	tagName: string;
	isDraft: boolean;
}

export interface PackageFile {
	name: string;
	control: string;
	size: number;
	sha256: string;
}

export interface Asset {
	name: string;
	digest: string | null;
}

export function channelTag(channel: Channel) {
	return `apt-${channel}`;
}

export function channelTags(
	releases: ListedRelease[],
): Record<Channel, string[]> {
	const versions = releases
		.filter((release) => !release.isDraft && release.tagName.startsWith("v"))
		.flatMap((release) => {
			const parsed = parse(release.tagName);
			return parsed ? [{ tag: release.tagName, parsed }] : [];
		})
		.sort((a, b) => compare(b.parsed, a.parsed));
	const stable = versions
		.filter(({ parsed }) => parsed.nightly === null)
		.slice(0, keptStableReleases)
		.map(({ tag }) => tag);
	const nightly = versions
		.filter(({ parsed }) => parsed.nightly !== null)
		.slice(0, keptNightlies)
		.map(({ tag }) => tag);
	return { stable, nightly: [...nightly, ...stable.slice(0, 1)] };
}

export function packagesIndex(files: PackageFile[]) {
	return files
		.map(
			(file) =>
				`${file.control.trimEnd()}\nFilename: ./${file.name}\nSize: ${file.size}\nSHA256: ${file.sha256}\n`,
		)
		.join("\n");
}

export function architectures(files: PackageFile[]) {
	const found = new Set(
		files.flatMap((file) => {
			const match = /^Architecture: (\S+)$/m.exec(file.control);
			return match ? [match[1]] : [];
		}),
	);
	return found.size ? [...found].sort() : ["amd64"];
}

function sha256(content: Buffer | string) {
	return createHash("sha256").update(content).digest("hex");
}

export function releaseFile(options: {
	channel: Channel;
	date: Date;
	architectures: string[];
	indexes: { name: string; content: Buffer }[];
}) {
	const lines = [
		"Origin: ECAD",
		"Label: ECAD",
		`Suite: ${options.channel}`,
		`Codename: ${options.channel}`,
		`Date: ${options.date.toUTCString().replace(/GMT$/, "UTC")}`,
		`Architectures: ${options.architectures.join(" ")}`,
		`Description: ECAD ${options.channel} releases`,
		"SHA256:",
		...options.indexes.map(
			({ name, content }) => ` ${sha256(content)} ${content.length} ${name}`,
		),
	];
	return `${lines.join("\n")}\n`;
}

export function sourcesFile(channel: Channel) {
	return [
		"Types: deb",
		`URIs: ${repositoryUrl}/releases/download/${channelTag(channel)}/`,
		"Suites: ./",
		`Signed-By: /usr/share/keyrings/${keyringName}`,
		"",
	].join("\n");
}

export function releaseNotes(channel: Channel) {
	const keyringUrl = `${repositoryUrl}/releases/download/${channelTag(channel)}/${keyringName}`;
	return [
		`The apt repository for ECAD ${channel} releases. The Release workflow replaces these files on every release, so link to the files rather than this page's contents.`,
		"",
		"```bash",
		`sudo curl -fsSLo /usr/share/keyrings/${keyringName} ${keyringUrl}`,
		`sudo tee /etc/apt/sources.list.d/ecad.sources <<'EOF'`,
		sourcesFile(channel).trimEnd(),
		"EOF",
		"sudo apt update && sudo apt install ecad",
		"```",
		"",
	].join("\n");
}

export function assetChanges(options: {
	existing: Asset[];
	packages: PackageFile[];
}) {
	const digests = new Map(
		options.existing.map((asset) => [asset.name, asset.digest]),
	);
	const wanted = new Set(options.packages.map((file) => file.name));
	return {
		upload: options.packages
			.filter((file) => digests.get(file.name) !== `sha256:${file.sha256}`)
			.map((file) => file.name),
		remove: options.existing
			.map((asset) => asset.name)
			.filter((name) => name.endsWith(".deb") && !wanted.has(name)),
	};
}

function run(command: string, args: string[]) {
	return execFileSync(command, args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
		maxBuffer: 64 * 1024 * 1024,
	});
}

function signingArgs(key: string | undefined) {
	return key ? ["--local-user", key] : [];
}

function downloadPackages(tag: string, directory: string): PackageFile[] {
	mkdirSync(directory, { recursive: true });
	run("gh", [
		"release",
		"download",
		tag,
		"--pattern",
		"*.deb",
		"--dir",
		directory,
		"--clobber",
	]);
	return readdirSync(directory)
		.filter((name) => name.endsWith(".deb"))
		.sort()
		.map((name) => {
			const path = join(directory, name);
			const content = readFileSync(path);
			return {
				name,
				control: run("dpkg-deb", ["--field", path]),
				size: content.length,
				sha256: sha256(content),
			};
		});
}

function buildChannel(options: {
	channel: Channel;
	directory: string;
	packages: PackageFile[];
	keyring: Buffer;
	key: string | undefined;
	date: Date;
}) {
	const { directory } = options;
	rmSync(directory, { recursive: true, force: true });
	mkdirSync(directory, { recursive: true });
	const packages = Buffer.from(packagesIndex(options.packages));
	const compressed = gzipSync(packages, { level: 9 });
	writeFileSync(join(directory, "Packages"), packages);
	writeFileSync(join(directory, "Packages.gz"), compressed);
	writeFileSync(join(directory, keyringName), options.keyring);
	writeFileSync(
		join(directory, "Release"),
		releaseFile({
			channel: options.channel,
			date: options.date,
			architectures: architectures(options.packages),
			indexes: [
				{ name: "Packages", content: packages },
				{ name: "Packages.gz", content: compressed },
			],
		}),
	);
	const gpg = ["--batch", "--yes", "--digest-algo", "SHA512"];
	run("gpg", [
		...gpg,
		...signingArgs(options.key),
		"--clearsign",
		"--output",
		join(directory, "InRelease"),
		join(directory, "Release"),
	]);
	run("gpg", [
		...gpg,
		...signingArgs(options.key),
		"--armor",
		"--detach-sign",
		"--output",
		join(directory, "Release.gpg"),
		join(directory, "Release"),
	]);
}

function existingAssets(tag: string): Asset[] | null {
	try {
		const release = JSON.parse(
			execFileSync("gh", ["api", `repos/{owner}/{repo}/releases/tags/${tag}`], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			}),
		) as { assets: { name: string; digest?: string | null }[] };
		return release.assets.map((asset) => ({
			name: asset.name,
			digest: asset.digest ?? null,
		}));
	} catch (error) {
		const stderr = String((error as { stderr?: unknown }).stderr ?? "");
		if (stderr.includes("404")) return null;
		throw error;
	}
}

function publishChannel(options: {
	channel: Channel;
	directory: string;
	packages: { file: PackageFile; path: string }[];
}) {
	const tag = channelTag(options.channel);
	let existing = existingAssets(tag);
	if (!existing) {
		const notes = join(options.directory, "notes.md");
		writeFileSync(notes, releaseNotes(options.channel));
		run("gh", [
			"release",
			"create",
			tag,
			"--prerelease",
			"--latest=false",
			"--title",
			`ECAD apt repository (${options.channel})`,
			"--notes-file",
			notes,
		]);
		existing = [];
	}
	const changes = assetChanges({
		existing,
		packages: options.packages.map(({ file }) => file),
	});
	const paths = new Map(
		options.packages.map(({ file, path }) => [file.name, path]),
	);
	const uploads = changes.upload.map((name) => paths.get(name) ?? name);
	if (uploads.length)
		run("gh", ["release", "upload", tag, ...uploads, "--clobber"]);
	const metadata = (names: string[]) =>
		names.map((name) => join(options.directory, name));
	run("gh", [
		"release",
		"upload",
		tag,
		...metadata([
			"Packages",
			"Packages.gz",
			keyringName,
			"Release",
			"Release.gpg",
		]),
		"--clobber",
	]);
	run("gh", [
		"release",
		"upload",
		tag,
		...metadata(["InRelease"]),
		"--clobber",
	]);
	for (const name of changes.remove)
		run("gh", ["release", "delete-asset", tag, name, "--yes"]);
	process.stdout.write(
		`${tag}: ${options.packages.map(({ file }) => file.name).join(", ") || "no packages"}\n`,
	);
}

function main() {
	const { values } = parseArgs({
		options: {
			directory: { type: "string", default: "dist/apt" },
			key: { type: "string" },
			"no-publish": { type: "boolean", default: false },
		},
	});
	const directory = values.directory;
	const key = values.key || undefined;
	const keyring = execFileSync("gpg", ["--export", ...(key ? [key] : [])]);
	if (!keyring.length)
		throw new Error(
			"The GnuPG keyring has no key to sign the repository with.",
		);

	const releases = JSON.parse(
		run("gh", [
			"release",
			"list",
			"--limit",
			"200",
			"--json",
			"tagName,isDraft",
		]),
	) as ListedRelease[];
	const tags = channelTags(releases);
	const downloaded = new Map<string, { file: PackageFile; path: string }[]>();
	for (const tag of new Set(aptChannels.flatMap((channel) => tags[channel]))) {
		const tagDirectory = join(directory, "packages", tag);
		downloaded.set(
			tag,
			downloadPackages(tag, tagDirectory).map((file) => ({
				file,
				path: join(tagDirectory, file.name),
			})),
		);
	}

	const date = new Date();
	for (const channel of aptChannels) {
		const packages = tags[channel].flatMap((tag) => downloaded.get(tag) ?? []);
		const channelDirectory = join(directory, channel);
		buildChannel({
			channel,
			directory: channelDirectory,
			packages: packages.map(({ file }) => file),
			keyring,
			key,
			date,
		});
		if (values["no-publish"]) {
			for (const { file, path } of packages)
				copyFileSync(path, join(channelDirectory, file.name));
			process.stdout.write(`${channel}: built in ${channelDirectory}\n`);
		} else publishChannel({ channel, directory: channelDirectory, packages });
	}
}

if (import.meta.main) main();
