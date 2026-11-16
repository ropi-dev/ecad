import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { parseArgs } from "node:util";

export type Channel = "stable" | "nightly";

export interface Release {
	version: string;
	tag: string;
	debianVersion: string;
	prerelease: boolean;
	previousTag: string | null;
	replaces: boolean;
}

export const firstVersion = "0.1.0";

const versionPattern =
	/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-nightly\.(\d{8}))?$/;

export interface Parsed {
	numbers: [number, number, number];
	nightly: string | null;
}

export function parse(version: string): Parsed | null {
	const match = versionPattern.exec(version);
	if (!match) return null;
	return {
		numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
		nightly: match[4] ?? null,
	};
}

export function compare(a: Parsed, b: Parsed) {
	for (let i = 0; i < 3; i++) {
		const difference = a.numbers[i] - b.numbers[i];
		if (difference) return difference;
	}
	if (a.nightly === b.nightly) return 0;
	if (a.nightly === null) return 1;
	if (b.nightly === null) return -1;
	return a.nightly < b.nightly ? -1 : 1;
}

function format(numbers: [number, number, number]) {
	return numbers.join(".");
}

export function nightlyDate(now: Date) {
	return now.toISOString().slice(0, 10).replaceAll("-", "");
}

export function nextRelease(options: {
	channel: Channel;
	requested?: string;
	tags: string[];
	date: string;
}): Release {
	const released = options.tags
		.filter((tag) => tag.startsWith("v"))
		.flatMap((tag) => {
			const parsed = parse(tag);
			return parsed ? [{ tag, parsed }] : [];
		})
		.sort((a, b) => compare(a.parsed, b.parsed));
	const stable = released.filter(({ parsed }) => parsed.nightly === null);
	const latestStable = stable.at(-1)?.parsed ?? null;

	let base: [number, number, number];
	const requested = options.requested?.trim();
	if (requested) {
		const parsed = parse(requested);
		if (!parsed || parsed.nightly !== null)
			throw new Error(
				`${requested} is not a version. Give it as MAJOR.MINOR.PATCH, such as 0.2.0.`,
			);
		if (latestStable && compare(parsed, latestStable) <= 0)
			throw new Error(
				`${format(parsed.numbers)} is not newer than the latest stable release, ${format(latestStable.numbers)}.`,
			);
		base = parsed.numbers;
	} else if (latestStable) {
		const [major, minor, patch] = latestStable.numbers;
		base = [major, minor, patch + 1];
	} else {
		const parsed = parse(firstVersion);
		if (!parsed) throw new Error(`${firstVersion} is not a version.`);
		base = parsed.numbers;
	}

	if (options.channel === "nightly" && !/^\d{8}$/.test(options.date))
		throw new Error(`${options.date} is not a date in YYYYMMDD form.`);
	const nightly = options.channel === "nightly" ? options.date : null;
	const parsed: Parsed = { numbers: base, nightly };
	const version = nightly ? `${format(base)}-nightly.${nightly}` : format(base);
	const tag = `v${version}`;
	const replaces = released.some(({ tag: existing }) => existing === tag);
	if (replaces && !nightly)
		throw new Error(`The ${tag} release already exists.`);
	const previous = (nightly ? released : stable).filter(
		(release) => compare(release.parsed, parsed) < 0,
	);
	return {
		version,
		tag,
		debianVersion: nightly
			? `${format(base)}~nightly.${nightly}`
			: format(base),
		prerelease: nightly !== null,
		previousTag: previous.at(-1)?.tag ?? null,
		replaces,
	};
}

function main() {
	const { values } = parseArgs({
		options: {
			channel: { type: "string", default: "stable" },
			version: { type: "string" },
			date: { type: "string" },
		},
	});
	if (values.channel !== "stable" && values.channel !== "nightly")
		throw new Error(
			`Unknown channel ${values.channel}. Use stable or nightly.`,
		);
	const tags = execFileSync("git", ["tag", "--list", "v*"], {
		encoding: "utf8",
	})
		.split("\n")
		.filter(Boolean);
	const release = nextRelease({
		channel: values.channel,
		requested: values.version,
		tags,
		date: values.date ?? nightlyDate(new Date()),
	});
	const lines = [
		`version=${release.version}`,
		`tag=${release.tag}`,
		`debian_version=${release.debianVersion}`,
		`prerelease=${release.prerelease}`,
		`previous_tag=${release.previousTag ?? ""}`,
		`replaces=${release.replaces}`,
	];
	const text = `${lines.join("\n")}\n`;
	if (process.env.GITHUB_OUTPUT)
		appendFileSync(process.env.GITHUB_OUTPUT, text);
	process.stdout.write(text);
}

if (import.meta.main) main();
