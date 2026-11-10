import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Area, areas } from "../../tests/performance/tags.ts";

/**
 * What a changed path selects: performance areas, every scenario (`"all"`),
 * no scenarios beyond the core set (`"none"`), or, for a performance spec,
 * the tags written in that spec (`"spec"`).
 */
export type Target = readonly Area[] | "all" | "none" | "spec";

/**
 * Changed path → scenarios. The first matching row wins, so specific rows come
 * before the directories that contain them. `*` matches within one path
 * segment and `**` matches any number of segments. A path that no row matches
 * runs every scenario.
 */
export const rules: readonly (readonly [pattern: string, target: Target])[] = [
	// Cannot change what the scenarios measure.
	["**/*.md", "none"],
	["docs/**", "none"],
	[".github/**", "none"],
	[".vscode/**", "none"],
	["deploy/**", "none"],
	["licenses/**", "none"],
	["LICENSE", "none"],
	[".gitignore", "none"],
	["biome.json", "none"],
	["packages/*/tests/**", "none"],

	// The performance harness. Code that decides how runs are measured,
	// summarized and compared runs every scenario. A spec runs its own tags.
	// Budgets, the fixture, helpers and the test fixtures and helpers they
	// import do not change the app being measured, so they select only the
	// core set; the CI smoke job runs every scenario against them.
	["tests/performance/reporter.ts", "all"],
	["tests/performance/comparison.ts", "all"],
	["tests/performance/playwright.config.ts", "all"],
	["scripts/performance/**", "all"],
	["tests/performance/*.spec.ts", "spec"],
	["tests/**", "none"],

	// Web app shell, routes and storage.
	["packages/web/src/routes/projects.tsx", ["@startup", "@projects"]],
	["packages/web/src/routes/index.tsx", ["@startup"]],
	["packages/web/src/routes/editor.tsx", ["@editor", "@symbols"]],
	["packages/web/src/routes/gerber.tsx", ["@import"]],
	["packages/web/src/routes/step.tsx", ["@import"]],
	["packages/web/src/routes/api.*", ["@editor"]],
	["packages/web/src/routes/mcp.*", ["@editor"]],
	["packages/web/src/projects/storage.ts", "all"],
	// Mounted around every route.
	["packages/web/src/projects/AppProjects.tsx", "all"],
	["packages/web/src/projects/**", ["@projects"]],
	["packages/web/src/symbol-library/**", ["@symbols"]],
	["packages/web/public/examples/symbols/**", ["@symbols"]],

	// Core: shared project session, storage and measurement code. The
	// collector, recorder and boundaries produce every browser scenario's
	// metrics, and the storage wrapper is on every save, so they run every
	// scenario.
	["packages/core/src/performance/**", "all"],
	["packages/core/src/lib/**", "all"],
	["packages/core/src/styles.css", "all"],
	["packages/core/src/projects/ProjectProvider.tsx", "all"],
	["packages/core/src/projects/ProjectShell.tsx", "all"],
	// ProjectShell mounts the toaster on every route, and editor export,
	// imports and project actions raise toasts.
	["packages/core/src/components/ui/**", "all"],
	["packages/core/src/projects/ProjectSession.ts", "all"],
	["packages/core/src/projects/project-session-state.ts", "all"],
	["packages/core/src/projects/project-autosave.ts", "all"],
	["packages/core/src/projects/repository.ts", "all"],
	["packages/core/src/projects/storage.ts", "all"],
	["packages/core/src/projects/save-assembly.ts", "all"],
	["packages/core/src/projects/format.ts", "all"],
	["packages/core/src/projects/document-registry.ts", "all"],
	["packages/core/src/projects/EditorDocument.tsx", ["@editor", "@circuit"]],
	["packages/core/src/projects/EditorHeader.tsx", ["@editor", "@circuit"]],
	["packages/core/src/projects/EditorViewSwitch.tsx", ["@editor", "@circuit"]],
	[
		"packages/core/src/projects/project-editor-files.ts",
		["@editor", "@circuit"],
	],
	["packages/core/src/projects/linked-pcb.ts", ["@circuit"]],
	["packages/core/src/projects/pcb.ts", ["@circuit", "@storage"]],
	["packages/core/src/projects/project-symbol-storage.ts", ["@symbols"]],
	// Import, editor and symbol scenarios open and add files in the sidebar.
	[
		"packages/core/src/projects/ProjectFilesSidebar.tsx",
		["@projects", "@import", "@editor", "@symbols"],
	],
	[
		"packages/core/src/projects/project-file-actions.ts",
		["@projects", "@import", "@editor", "@symbols"],
	],
	["packages/core/src/projects/errors.ts", ["@projects", "@storage"]],
	["packages/core/src/projects/SymbolLibrarySettings.tsx", ["@symbols"]],
	["packages/core/src/projects/**", ["@projects"]],

	// Core: feature areas.
	// The circuit editor reuses the symbol picker and library hooks.
	[
		"packages/core/src/components/editor/Symbol*",
		["@editor", "@symbols", "@circuit"],
	],
	["packages/core/src/components/editor/CreateSymbolDialog.tsx", ["@symbols"]],
	[
		"packages/core/src/components/editor/CreateFileDialog.tsx",
		["@editor", "@projects", "@symbols"],
	],
	[
		"packages/core/src/components/editor/symbol*",
		["@editor", "@symbols", "@circuit", "@storage"],
	],
	[
		"packages/core/src/components/editor/use*Symbol*",
		["@editor", "@symbols", "@circuit"],
	],
	["packages/core/src/components/editor/**", ["@editor"]],
	["packages/core/src/components/circuit/**", ["@circuit"]],
	["packages/core/src/components/gerber/**", ["@import"]],
	["packages/core/src/components/step/**", ["@import"]],
	[
		"packages/core/src/components/viewer/**",
		["@editor", "@circuit", "@import"],
	],
	["packages/core/src/engine/**", ["@editor", "@circuit", "@import"]],
	// Project storage parses, persists and resolves symbols.
	[
		"packages/core/src/drawing/symbol*",
		["@editor", "@symbols", "@circuit", "@storage"],
	],
	["packages/core/src/drawing/text.ts", ["@editor", "@circuit"]],
	["packages/core/src/drawing/diagonal-wires.ts", ["@editor", "@import"]],
	["packages/core/src/drawing/**", ["@editor"]],
	["packages/core/src/circuit/symbol-components.ts", ["@circuit", "@symbols"]],
	["packages/core/src/circuit/**", ["@circuit"]],
	// Project storage and linked documents check imported asset formats.
	[
		"packages/core/src/formats/import-limits.ts",
		["@import", "@storage", "@circuit"],
	],
	[
		"packages/core/src/formats/import-effects.ts",
		["@import", "@storage", "@circuit"],
	],
	[
		"packages/core/src/formats/gerber/detect.ts",
		["@import", "@storage", "@circuit"],
	],
	["packages/core/src/formats/**", ["@import"]],
	["packages/core/src/mcp/**", ["@editor"]],
	["packages/core/src/services/**", ["@editor"]],
	["packages/core/src/symbol-library/**", ["@symbols", "@storage"]],

	// Drawing core is shared by the editor, symbols, the circuit, imports,
	// project storage and the CLI.
	["packages/drawing-core/src/lib/**", "all"],
	["packages/drawing-core/src/performance/**", "all"],
	["packages/drawing-core/src/circuit/model.ts", ["@circuit", "@storage"]],
	["packages/drawing-core/src/circuit/**", ["@circuit"]],
	["packages/drawing-core/src/erc/**", ["@circuit"]],
	["packages/drawing-core/src/mcp/**", ["@editor", "@cli"]],
	[
		"packages/drawing-core/src/commands/**",
		["@editor", "@symbols", "@circuit", "@import", "@storage", "@cli"],
	],
	[
		"packages/drawing-core/src/drawing/**",
		["@editor", "@symbols", "@circuit", "@import", "@storage", "@cli"],
	],

	// Built-in symbols appear in editor and circuit placement scenarios and in
	// project storage.
	[
		"packages/default-symbols/src/**",
		["@symbols", "@editor", "@circuit", "@storage"],
	],
	[
		"packages/default-symbols/scripts/**",
		["@symbols", "@editor", "@circuit", "@storage"],
	],
	["packages/cli/src/**", ["@cli"]],
	["packages/cli/bin/**", ["@cli"]],
	["packages/cli/scripts/**", ["@cli"]],
	["packages/desktop/src/main/**", ["@storage"]],
	// No scenario runs the desktop renderer or its build scripts.
	["packages/desktop/src/**", "none"],
	["packages/desktop/scripts/**", "none"],
	["packages/desktop/index.html", "none"],
	["packages/desktop/vite.config.ts", "none"],

	// Shared dependencies, build configuration and the app shell.
	["package.json", "all"],
	["pnpm-lock.yaml", "all"],
	["pnpm-workspace.yaml", "all"],
	[".npmrc", "all"],
	[".nvmrc", "all"],
	["tsconfig*.json", "all"],
	["packages/*/package.json", "all"],
	["packages/*/tsconfig.json", "all"],
	["packages/*/vite.config.ts", "all"],
	["packages/web/src/*", "all"],
	["packages/web/src/routes/**", "all"],
	["scripts/**", "all"],
	// Any other path, such as a new package, also runs every scenario.
];

/** Scenarios that every selection runs; tag them `@core`. */
export const coreTag = "@core" satisfies Area;

const patternCache = new Map<string, RegExp>();
function glob(pattern: string): RegExp {
	let expression = patternCache.get(pattern);
	if (!expression) {
		const source = pattern
			.split(/(\*\*\/|\*\*|\*)/)
			.map((part) =>
				part === "**/"
					? "(?:.*/)?"
					: part === "**"
						? ".*"
						: part === "*"
							? "[^/]*"
							: part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"),
			)
			.join("");
		expression = new RegExp(`^${source}$`);
		patternCache.set(pattern, expression);
	}
	return expression;
}

export interface Reason {
	path: string;
	/** The matching rule pattern, or `undefined` when no rule matched. */
	rule?: string;
	/** `"itself"`: a changed performance spec runs its own tests. */
	target: readonly Area[] | "all" | "none" | "itself";
}

const root = fileURLToPath(new URL("../../", import.meta.url));
const present = (path: string) => existsSync(resolve(root, path));

export function classify(
	path: string,
	exists: (path: string) => boolean = present,
): Reason {
	const rule = rules.find(([pattern]) => glob(pattern).test(path));
	if (!rule) return { path, target: "all" };
	const [pattern, target] = rule;
	if (target !== "spec") return { path, rule: pattern, target };
	// A deleted spec leaves nothing to run.
	return { path, rule: pattern, target: exists(path) ? "itself" : "none" };
}

export interface Selection {
	/** Why the full suite runs, or `undefined` for an affected selection. */
	full?: string;
	/** Tags to run, always including `@core`, when `full` is unset. */
	tags: Area[];
	/** File names of changed performance specs, whose tests all run. */
	specs: string[];
	reasons: Reason[];
}

export function select(
	paths: readonly string[],
	exists?: (path: string) => boolean,
): Selection {
	const reasons = [...new Set(paths)]
		.sort()
		.map((path) => classify(path, exists));
	const broad = reasons.find((reason) => reason.target === "all");
	const tags = new Set<Area>([coreTag]);
	for (const reason of reasons)
		if (Array.isArray(reason.target))
			for (const tag of reason.target) tags.add(tag);
	return {
		...(broad
			? {
					full: `${broad.path} ${broad.rule ? "affects shared code" : "matches no selection rule"}`,
				}
			: {}),
		tags: (Object.keys(areas) as Area[]).filter((tag) => tags.has(tag)),
		specs: reasons
			.filter((reason) => reason.target === "itself")
			.map((reason) => basename(reason.path)),
		reasons,
	};
}

/**
 * A Playwright `--grep` pattern for the selected tags and spec files.
 * Playwright matches it against each test's file path, titles and tags.
 */
export const grepFor = (tags: readonly Area[], specs: readonly string[] = []) =>
	[
		...tags,
		...specs.map(
			(spec) => `(?<![\\w-])${spec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
		),
	].join("|");

const git = (args: string[]) =>
	execFileSync("git", args, {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
const lines = (output: string) => output.split("\n").filter(Boolean);

/**
 * Paths changed since the merge base with `base`, including staged, unstaged
 * and untracked files. Renames count as both the old and new path.
 */
export function changedPaths(base: string) {
	const mergeBase = git(["merge-base", base, "HEAD"]).trim();
	return {
		mergeBase,
		paths: [
			...new Set([
				...lines(
					git(["diff", "--name-only", "--no-renames", mergeBase, "HEAD"]),
				),
				...lines(git(["diff", "--name-only", "--no-renames", "HEAD"])),
				...lines(git(["ls-files", "--others", "--exclude-standard"])),
			]),
		],
	};
}

const describe = (target: Reason["target"]) =>
	target === "all"
		? "every scenario"
		: target === "none"
			? "no scenarios"
			: target === "itself"
				? "this spec"
				: target.join(" ");

export interface Plan {
	/** Arguments for Playwright. */
	args: string[];
	/** True when the run has no `--grep`, so every scenario runs. */
	all: boolean;
	/** Selection report, one line per entry. */
	messages: string[];
}

const explicitGrep = (arg: string) =>
	arg === "--grep" || arg === "-g" || arg.startsWith("--grep=");

/**
 * Decides which scenarios a performance run benchmarks. `--all`, an explicit
 * `--grep`, a baseline capture and a smoke run use the full suite or the
 * user's filter; otherwise the run selects the scenarios the change affects.
 */
export function plan(
	args: readonly string[],
	options: {
		baseline?: boolean;
		smoke?: boolean;
		base?: string;
		/** Lists changed paths; `mergeBase` is unset for paths given directly. */
		changes?: (base: string) => { mergeBase?: string; paths: string[] };
		/** Whether a changed path still exists; a deleted spec runs nothing. */
		exists?: (path: string) => boolean;
	} = {},
): Plan {
	const forwarded = args.filter((arg) => arg !== "--all");
	const full = (reason: string) => ({
		args: forwarded,
		all: true,
		messages: [`[perf] Running every scenario: ${reason}.`],
	});
	if (args.some(explicitGrep))
		return {
			args: forwarded,
			all: false,
			messages: ["[perf] Running the scenarios that match --grep."],
		};
	if (args.includes("--all")) return full("--all");
	if (options.smoke) return full("smoke runs check every scenario");
	if (options.baseline)
		return full("a baseline covers the whole suite (pass --grep to narrow it)");
	const base = options.base ?? "origin/main";
	let changes: { mergeBase?: string; paths: string[] };
	try {
		changes = (options.changes ?? changedPaths)(base);
	} catch (error) {
		return full(
			`cannot list changes against ${base} (${error instanceof Error ? error.message.split("\n")[0] : String(error)})`,
		);
	}
	const selection = select(changes.paths, options.exists);
	const messages = [
		`[perf] ${changes.paths.length} changed path${changes.paths.length === 1 ? "" : "s"}${changes.mergeBase ? ` since ${base} (merge base ${changes.mergeBase.slice(0, 12)})` : ""}:`,
		...selection.reasons
			.slice(0, 60)
			.map(
				(reason) =>
					`[perf]   ${reason.path} → ${describe(reason.target)}${reason.rule ? ` (${reason.rule})` : " (no rule)"}`,
			),
		...(selection.reasons.length > 60
			? [`[perf]   … and ${selection.reasons.length - 60} more`]
			: []),
	];
	if (selection.full)
		return {
			args: forwarded,
			all: true,
			messages: [
				...messages,
				`[perf] Running every scenario: ${selection.full}. Pass --grep to narrow it.`,
			],
		};
	return {
		args: [...forwarded, "--grep", grepFor(selection.tags, selection.specs)],
		all: false,
		messages: [
			...messages,
			`[perf] Running ${[...selection.tags, ...selection.specs].join(" ")}. Pass --all for every scenario.`,
		],
	};
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	// `tsx scripts/performance/select.ts [path …]` prints the selection for the
	// given paths, or for the current change when no paths are given.
	const paths = process.argv.slice(2);
	const result = plan([], {
		base: process.env.ECAD_PERF_BASE,
		...(paths.length ? { changes: () => ({ paths }) } : {}),
	});
	for (const message of result.messages) console.log(message);
	const grep = result.args.indexOf("--grep");
	console.log(grep < 0 ? "--all" : `--grep ${result.args[grep + 1]}`);
}
