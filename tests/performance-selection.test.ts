import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	classify,
	plan,
	rules,
	select,
} from "../scripts/performance/select.ts";
import {
	missingFromBaseline,
	profileBrowser,
	type Summary,
} from "./performance/comparison.ts";
import { type Area, areas, isArea } from "./performance/tags.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const performance = join(root, "tests/performance");

const changes =
	(...paths: string[]) =>
	() => ({ mergeBase: "0123456789abcdef", paths });
const grep = (args: string[]) => {
	const index = args.indexOf("--grep");
	return index < 0 ? undefined : args[index + 1];
};

test("an editor change selects the core set and editor scenarios", () => {
	const result = plan([], {
		changes: changes("packages/core/src/components/editor/Editor2D.tsx"),
	});
	assert.equal(grep(result.args), "@core|@editor");
	assert.equal(result.all, false);
	assert.ok(
		result.messages.some((line) =>
			line.includes("components/editor/Editor2D.tsx → @editor"),
		),
		result.messages.join("\n"),
	);
});

test("docs, workflows and unit tests select only the core set", () => {
	const result = plan([], {
		changes: changes(
			"docs/performance.md",
			"AGENTS.md",
			"packages/default-symbols/README.md",
			".github/workflows/ci.yml",
			"tests/editor-commands.test.ts",
			"tests/browser/editor.spec.ts",
			"packages/desktop/tests/projects.test.ts",
		),
	});
	assert.equal(grep(result.args), "@core");
});

test("shared, build and unknown paths fall back to the full suite", () => {
	for (const path of [
		"pnpm-lock.yaml",
		"package.json",
		"packages/web/package.json",
		"packages/web/vite.config.ts",
		"packages/web/src/routes/__root.tsx",
		"tsconfig.base.json",
		"tests/performance/reporter.ts",
		"tests/performance/playwright.config.ts",
		"scripts/performance/select.ts",
		"scripts/development/common.ts",
		"packages/core/src/lib/keyboard.ts",
		"packages/core/src/performance/runtime.ts",
		"packages/core/src/projects/ProjectSession.ts",
		"packages/core/src/projects/ProjectShell.tsx",
		"packages/web/src/projects/AppProjects.tsx",
		"packages/drawing-core/src/lib/union-find.ts",
		"packages/new-package/src/index.ts",
		"something-new.ts",
	]) {
		const result = plan([], {
			changes: changes("docs/performance.md", path),
		});
		assert.equal(result.all, true, path);
		assert.equal(grep(result.args), undefined, path);
		assert.match(result.messages.at(-1) ?? "", /Running every scenario/, path);
	}
	assert.match(
		plan([], { changes: changes("something-new.ts") }).messages.at(-1) ?? "",
		/something-new\.ts matches no selection rule/,
	);
});

test("feature paths map to their areas", () => {
	const cases: [string, Area[]][] = [
		["packages/core/src/components/circuit/CircuitEditor.tsx", ["@circuit"]],
		["packages/drawing-core/src/erc/rules.ts", ["@circuit"]],
		[
			"packages/core/src/components/editor/SymbolPicker.tsx",
			["@editor", "@symbols", "@circuit"],
		],
		["packages/core/src/symbol-library/config.ts", ["@symbols"]],
		["packages/core/src/formats/kicad/convert.ts", ["@import"]],
		["packages/core/src/projects/ProjectFilesSidebar.tsx", ["@projects"]],
		["packages/web/src/routes/projects.tsx", ["@startup", "@projects"]],
		["packages/desktop/src/main/projects.ts", ["@storage"]],
		["packages/cli/src/cli.ts", ["@cli"]],
		[
			"packages/core/src/components/viewer/ToolbarGroup.tsx",
			["@editor", "@circuit", "@import"],
		],
		[
			"packages/core/src/drawing/symbols.ts",
			["@editor", "@symbols", "@circuit"],
		],
		[
			"packages/core/src/projects/project-editor-files.ts",
			["@editor", "@circuit"],
		],
		[
			"packages/drawing-core/src/drawing/schema.ts",
			["@editor", "@symbols", "@circuit", "@import", "@cli"],
		],
		[
			"packages/drawing-core/src/drawing/wire-router.ts",
			["@editor", "@symbols", "@circuit", "@import", "@cli"],
		],
	];
	for (const [path, expected] of cases)
		assert.deepEqual(classify(path).target, expected, path);
	assert.deepEqual(
		classify("packages/desktop/src/renderer/main.tsx").target,
		"none",
	);
});

test("a changed performance spec selects only its own tests", () => {
	const result = plan([], {
		changes: changes(
			"tests/performance/editor-box.spec.ts",
			"tests/performance/budgets.ts",
		),
		exists: () => true,
	});
	assert.equal(
		grep(result.args),
		String.raw`@core|(?<![\w-])editor-box\.spec\.ts`,
	);
	assert.match(
		result.messages.at(-1) ?? "",
		/Running @core editor-box\.spec\.ts\./,
	);
	const pattern = new RegExp(grep(result.args) ?? "");
	assert.ok(pattern.test("editor-box.spec.ts editor-box"));
	assert.ok(!pattern.test("other-editor-box.spec.ts other"));
	assert.ok(!pattern.test("editor-boxXspec.ts"));
	const removed = plan([], {
		changes: changes("tests/performance/removed.spec.ts"),
		exists: () => false,
	});
	assert.equal(grep(removed.args), "@core");
});

test("--all, --grep, baselines and smoke runs skip selection", () => {
	const throws = () => {
		throw new Error("selection must not read changes");
	};
	const all = plan(["--all", "--workers=2"], { changes: throws });
	assert.deepEqual(all.args, ["--workers=2"]);
	assert.equal(all.all, true);
	for (const args of [
		["--grep", "editor-box"],
		["-g", "editor-box"],
		["--grep=editor-box"],
	])
		assert.deepEqual(plan(args, { changes: throws }).args, args);
	assert.deepEqual(plan([], { baseline: true, changes: throws }).args, []);
	assert.deepEqual(
		plan(["--grep-invert", "editor-box"], { baseline: true, changes: throws })
			.args,
		["--grep-invert", "editor-box"],
	);
	assert.deepEqual(
		plan(["--forbid-only"], { smoke: true, changes: throws }).args,
		["--forbid-only"],
	);
	// --grep-invert is not an explicit selection; it narrows the affected set.
	assert.deepEqual(
		plan(["--grep-invert", "editor-box"], {
			changes: changes("packages/cli/src/cli.ts"),
		}).args,
		["--grep-invert", "editor-box", "--grep", "@core|@cli"],
	);
});

test("a failed change listing runs every scenario and says why", () => {
	const result = plan([], {
		base: "origin/missing",
		changes: () => {
			throw new Error("fatal: Not a valid object name origin/missing");
		},
	});
	assert.equal(result.all, true);
	assert.match(
		result.messages[0],
		/cannot list changes against origin\/missing/,
	);
});

test("selections always include the core set", () => {
	assert.deepEqual(select([]).tags, ["@core"]);
	assert.deepEqual(select(["docs/erc.md"]).tags, ["@core"]);
});

test("mapping rules only name known areas and every area is selectable", () => {
	const mapped = new Set<string>();
	for (const [pattern, target] of rules) {
		if (!Array.isArray(target)) continue;
		assert.ok(target.length, pattern);
		for (const tag of target) {
			assert.ok(isArea(tag), `${pattern}: ${tag}`);
			mapped.add(tag);
		}
	}
	for (const area of Object.keys(areas))
		if (area !== "@core") assert.ok(mapped.has(area), `${area} has no rule`);
	// Tags are joined into a regular expression, so none may prefix another.
	for (const a of Object.keys(areas))
		for (const b of Object.keys(areas))
			assert.ok(a === b || !b.startsWith(a), `${a} prefixes ${b}`);
});

test("harness files select only the core set unless they change measurement", () => {
	const helpers = new Set<string>();
	for (const file of readdirSync(performance).filter((name) =>
		name.endsWith(".ts"),
	)) {
		if (!file.endsWith(".spec.ts")) helpers.add(`tests/performance/${file}`);
		for (const [, specifier] of readFileSync(
			join(performance, file),
			"utf8",
		).matchAll(/from\s+"(\.\.?\/[^"]+)"/g)) {
			let target = relative(
				root,
				resolve(dirname(join(performance, file)), specifier),
			);
			// Product code under packages/ has its own mapping rows.
			if (!target.startsWith("tests/") || target.endsWith(".spec.ts")) continue;
			if (!/\.[a-z]+$/.test(target)) target += ".ts";
			helpers.add(target);
		}
	}
	const measurement = new Set([
		"tests/performance/reporter.ts",
		"tests/performance/comparison.ts",
		"tests/performance/playwright.config.ts",
	]);
	assert.ok(helpers.has("tests/browser/toolbar.ts"));
	assert.ok(helpers.has("tests/performance/budgets.ts"));
	for (const path of helpers)
		assert.deepEqual(
			classify(path).target,
			measurement.has(path) ? "all" : "none",
			path,
		);
	for (const path of [
		"tests/fixtures/circuit.ts",
		"tests/fixtures/kicad/RPI-RP2350A-MINIMAL_R4-S1.kicad_sch",
		"tests/helpers/required.ts",
	])
		assert.equal(classify(path).target, "none", path);
	assert.equal(
		grep(plan([], { changes: changes("tests/performance/budgets.ts") }).args),
		"@core",
	);
});

test("every performance test has a known area tag and the core set stays small", () => {
	const list = spawnSync(
		process.execPath,
		[
			join(root, "node_modules/@playwright/test/cli.js"),
			"test",
			"--config",
			"tests/performance/playwright.config.ts",
			"--list",
			"--reporter=json",
		],
		{
			cwd: root,
			encoding: "utf8",
			env: { ...process.env, ECAD_PERF_RUNS: "1" },
		},
	);
	assert.equal(list.status, 0, list.stderr);
	interface Spec {
		title: string;
		tags: string[];
	}
	interface ListedSuite {
		specs?: Spec[];
		suites?: ListedSuite[];
	}
	const specs: Spec[] = [];
	const walk = (suite: ListedSuite) => {
		specs.push(...(suite.specs ?? []));
		for (const child of suite.suites ?? []) walk(child);
	};
	for (const suite of JSON.parse(list.stdout).suites as ListedSuite[])
		walk(suite);
	assert.ok(specs.length > 50, `listed ${specs.length} tests`);
	const used = new Set<string>();
	for (const spec of specs) {
		// The JSON reporter lists tags without their leading @.
		const tags = spec.tags.map((tag) => `@${tag}`);
		assert.ok(tags.some(isArea), `${spec.title} has no area tag`);
		for (const tag of tags) {
			assert.ok(isArea(tag), `${spec.title} has unknown tag ${tag}`);
			used.add(tag);
		}
	}
	for (const area of Object.keys(areas))
		assert.ok(used.has(area), `no test is tagged ${area}`);
	const core = specs.filter((spec) => spec.tags.includes("core"));
	assert.ok(
		core.length >= 2 && core.length <= 3,
		core.map((s) => s.title).join(),
	);
});

test("a scenario missing from the baseline is reported", () => {
	const summary = (...scenarios: string[]): Summary => ({
		version: 1,
		profile: { mode: "production", cpu: 4, platform: "linux", browser: "x" },
		scenarios: Object.fromEntries(
			scenarios.map((scenario) => [
				scenario,
				{ interactionP95Ms: { median: 1, p95: 1, samples: 1 } },
			]),
		),
	});
	assert.deepEqual(
		missingFromBaseline(
			summary("projects-empty", "editor-box", "editor-toolbar"),
			summary("projects-empty", "editor-toolbar"),
		),
		[],
	);
	const warnings = missingFromBaseline(
		summary("projects-empty"),
		summary("projects-empty", "editor-box"),
	);
	assert.equal(warnings.length, 1);
	assert.match(warnings[0], /^editor-box is not in the baseline/);
});

test("the profile browser ignores Node-only scenarios that ran first", () => {
	const run = (userAgent: string) => ({
		report: { environment: { userAgent } },
	});
	assert.equal(
		profileBrowser([
			run("Node/24.22.1"),
			run("HeadlessChrome/153"),
			run("Node/24.22.1"),
		]),
		"HeadlessChrome/153",
	);
	assert.equal(profileBrowser([run("Node/24.22.1")]), "Node/24.22.1");
	assert.equal(profileBrowser([]), "unavailable");
});
