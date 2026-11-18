import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { classify, plan, rules } from "../scripts/performance/select.ts";
import { type Area, areas, isArea } from "./performance/tags.ts";

const root = fileURLToPath(new URL("../", import.meta.url));

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
		"packages/core/src/components/ui/Toaster.tsx",
		"packages/core/src/components/ui/toast.ts",
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
	}
	assert.match(
		plan([], { changes: changes("something-new.ts") }).messages.at(-1) ?? "",
		/\bsomething-new\.ts\b/,
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
		["packages/core/src/symbol-library/config.ts", ["@symbols", "@storage"]],
		["packages/core/src/formats/kicad/convert.ts", ["@import"]],
		["packages/core/src/projects/WorkspaceStart.tsx", ["@projects"]],
		["packages/web/src/routes/projects.tsx", ["@startup", "@projects"]],
		["packages/desktop/src/main/projects.ts", ["@storage"]],
		["packages/cli/src/cli.ts", ["@cli"]],
		[
			"packages/core/src/projects/ProjectFilesSidebar.tsx",
			["@projects", "@import", "@editor", "@symbols"],
		],
		[
			"packages/core/src/components/editor/CreateFileDialog.tsx",
			["@editor", "@projects", "@symbols"],
		],
		[
			"packages/core/src/formats/import-limits.ts",
			["@import", "@storage", "@circuit"],
		],
		[
			"packages/core/src/components/viewer/ToolbarGroup.tsx",
			["@editor", "@circuit", "@import"],
		],
		[
			"packages/core/src/drawing/symbols.ts",
			["@editor", "@symbols", "@circuit", "@storage"],
		],
		[
			"packages/core/src/projects/project-editor-files.ts",
			["@editor", "@circuit"],
		],
		[
			"packages/drawing-core/src/drawing/schema.ts",
			["@editor", "@symbols", "@circuit", "@import", "@storage", "@cli"],
		],
		[
			"packages/drawing-core/src/drawing/wire-router.ts",
			["@editor", "@symbols", "@circuit", "@import", "@storage", "@cli"],
		],
	];
	for (const [path, expected] of cases)
		assert.deepEqual(classify(path).target, expected, path);
	assert.deepEqual(
		classify("packages/desktop/src/renderer/main.tsx").target,
		"none",
	);
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
