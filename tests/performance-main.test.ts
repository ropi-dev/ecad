import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	nextStep,
	parseMain,
	readState,
	regressions,
	statePath,
	writeState,
} from "../scripts/performance/main.ts";

test("perf:main separates its own options from the ones it forwards", () => {
	assert.deepEqual(parseMain(["--since", "abc", "--grep", "x", "--all"]), {
		since: "abc",
		accept: false,
		args: ["--grep", "x", "--all"],
	});
	assert.equal(parseMain(["--since=v1"]).since, "v1");
	assert.equal(parseMain(["--accept"]).accept, true);
	assert.throws(() => parseMain(["--since"]), /needs a Git ref/);
	assert.throws(() => parseMain(["--base", "x"]), /not --base/);
});

test("perf:main records a starting point, skips an unchanged main and compares a new one", () => {
	const main = { clean: true, onMain: true, baseIsAncestor: true };
	assert.deepEqual(nextStep({ ...main, head: "b", baseIsAncestor: false }), {
		kind: "seed",
	});
	assert.equal(
		nextStep({ ...main, head: "b", clean: false, baseIsAncestor: false }).kind,
		"error",
	);
	assert.equal(
		nextStep({ ...main, head: "b", onMain: false, baseIsAncestor: false }).kind,
		"error",
	);
	assert.deepEqual(nextStep({ ...main, head: "b", base: "b" }), {
		kind: "current",
	});
	assert.deepEqual(nextStep({ ...main, head: "b", base: "b", clean: false }), {
		kind: "compare",
		base: "b",
	});
	assert.deepEqual(nextStep({ ...main, head: "b", base: "a" }), {
		kind: "compare",
		base: "a",
	});
	const diverged = nextStep({
		...main,
		head: "b",
		base: "a",
		baseIsAncestor: false,
	});
	assert.equal(diverged.kind, "error");
	assert.match(
		diverged.kind === "error" ? diverged.message : "",
		/not an ancestor/,
	);
});

test("perf:main reruns only when every failure is a regression verdict", () => {
	const scenarios = {
		"editor-box": { test: "edits a box", verdict: "regression" },
		"editor-box-wide": { test: "edits a box", verdict: "regression" },
		"editor-pan": { test: "pans", verdict: "pass" },
	};
	assert.deepEqual(regressions({ scenarios, failures: ["a", "b"] }), {
		scenarios: ["editor-box", "editor-box-wide"],
		tests: ["edits a box"],
		other: 0,
	});
	assert.equal(
		regressions({ scenarios, failures: ["a", "b", "head failed"] }).other,
		1,
	);
	assert.deepEqual(regressions({}), { scenarios: [], tests: [], other: 0 });
});

test("perf:main keeps the checked commit in the base build cache", () => {
	const directory = mkdtempSync(join(tmpdir(), "ecad-perf-main-"));
	try {
		const path = statePath({ ECAD_PERF_CACHE_DIR: directory });
		assert.equal(path, join(directory, "main-check.json"));
		assert.equal(readState(path), undefined);
		writeState("abc", path);
		assert.equal(readState(path)?.sha, "abc");
		assert.ok(Date.parse(readState(path)?.checkedAt ?? "") > 0);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
