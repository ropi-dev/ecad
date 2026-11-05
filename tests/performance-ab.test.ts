import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { type AddressInfo, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	decisionFromEnv,
	defaultDecision,
	floorFor,
	floorScaleFor,
	grepForTitles,
	judgeMetric,
	judgeScenario,
	maxRounds,
	median,
} from "../scripts/performance/ab.ts";
import {
	inUse,
	markInUse,
	prune,
	withDirectoryLock,
} from "../scripts/performance/base-build.ts";
import { parseRun, withoutGrep } from "../scripts/performance/options.ts";
import { portAvailable, ServerRecords } from "../scripts/performance/ports.ts";

const repeat = (value: number, count: number) =>
	Array.from({ length: count }, () => value);

test("median averages the middle pair", () => {
	assert.equal(median([3, 1, 2]), 2);
	assert.equal(median([4, 1, 3, 2]), 2.5);
	assert.ok(Number.isNaN(median([])));
});

test("the limit is the baseline rule: 25% plus the metric's noise floor", () => {
	// interactionP95Ms has a 50 ms floor: limit = 200 × 1.25 + 50 = 300 ms.
	const atLimit = judgeMetric("interactionP95Ms", [200], [300]);
	assert.equal(atLimit.ratio, 1.5);
	assert.equal(atLimit.threshold, 1.5);
	assert.equal(atLimit.score, 1);
	// Unknown metrics use a 50 floor; timing floors scale, others do not.
	assert.equal(floorFor("someNewMs"), 50);
	assert.equal(
		floorFor("interactionP95Ms", { ...defaultDecision, floorScale: 0.25 }),
		12.5,
	);
	assert.equal(
		floorFor("domNodes", { ...defaultDecision, floorScale: 0.25 }),
		50,
	);
});

test("unthrottled runs scale timing floors, except event-loop sampling noise", () => {
	assert.equal(floorScaleFor(1), 0.25);
	assert.equal(floorScaleFor(2), 0.5);
	assert.equal(floorScaleFor(4), 1);
	assert.equal(floorScaleFor(6), 1);
	const unthrottled = { ...defaultDecision, floorScale: floorScaleFor(1) };
	assert.equal(floorFor("interactionP95Ms", unthrottled), 12.5);
	assert.equal(floorFor("eventLoopP95Ms", unthrottled), 100);
	// A 40% regression on a 120 ms interaction over five pairs: the full
	// 50 ms floor puts the limit at ×1.67 and passes it; the scaled floor's
	// limit is ×1.35.
	const base = repeat(120, 5);
	const head = repeat(168, 5);
	assert.equal(judgeMetric("interactionP95Ms", base, head).verdict, "pass");
	assert.equal(
		judgeMetric("interactionP95Ms", base, head, unthrottled).verdict,
		"regression",
	);
});

test("one clearly fast pair passes; a borderline pair stays undecided", () => {
	// Score 220 / 300 = 0.73, below 1 - 0.2.
	assert.equal(judgeMetric("interactionP95Ms", [200], [220]).verdict, "pass");
	// Score 0.9 is within the one-pair band.
	assert.equal(
		judgeMetric("interactionP95Ms", [200], [270]).verdict,
		"undecided",
	);
});

test("a regression needs all five pairs, however large the first ones are", () => {
	for (const pairs of [1, 2, 3, 4])
		assert.equal(
			judgeMetric("interactionP95Ms", repeat(200, pairs), repeat(600, pairs))
				.verdict,
			"undecided",
		);
	const five = judgeMetric("interactionP95Ms", repeat(200, 5), repeat(600, 5));
	assert.equal(five.verdict, "regression");
	assert.equal(five.ratio, 3);
	// With an earlier minimum, a clear regression stops early.
	assert.equal(
		judgeMetric("interactionP95Ms", repeat(200, 3), repeat(600, 3), {
			...defaultDecision,
			minRegressionPairs: 3,
		}).verdict,
		"regression",
	);
});

test("one slow interaction in two of three runs no longer fails identical code", () => {
	// editor-symbol-text in an A == A run: p50 stayed at 57–73 ms, but one
	// interaction in some head runs took 170–210 ms.
	const unthrottled = { ...defaultDecision, floorScale: 0.25 };
	const three = judgeMetric(
		"interactionP95Ms",
		[70, 69, 80],
		[174, 66, 214],
		unthrottled,
	);
	assert.equal(three.verdict, "undecided");
	const five = judgeMetric(
		"interactionP95Ms",
		[70, 69, 80, 78, 87],
		[174, 66, 214, 67, 70],
		unthrottled,
	);
	assert.equal(five.verdict, "pass");
});

test("event-loop p95 is reported but does not decide a scenario", () => {
	const pairs = repeat(0, 5).map(() => ({
		base: { interactionP95Ms: 100, eventLoopP95Ms: 10 },
		head: { interactionP95Ms: 100, eventLoopP95Ms: 600 },
	}));
	const result = judgeScenario(pairs);
	assert.equal(result.verdict, "pass");
	assert.equal(
		result.metrics.find((metric) => metric.metric === "eventLoopP95Ms")
			?.verdict,
		"regression",
	);
	assert.equal(result.worst?.metric, "interactionP95Ms");
});

test("the median pair ignores one outlier", () => {
	const result = judgeMetric(
		"interactionP95Ms",
		[200, 200, 200],
		[1000, 210, 205],
	);
	assert.equal(result.verdict, "pass");
	assert.equal(result.ratio, 1.05);
});

test("a zero base does not divide by zero", () => {
	const zero = judgeMetric("blockingMs", [0], [0]);
	assert.equal(zero.ratio, 1);
	assert.equal(zero.threshold, Infinity);
	assert.equal(zero.verdict, "pass");
	const appeared = judgeMetric("blockingMs", repeat(0, 5), repeat(400, 5));
	assert.equal(appeared.ratio, Infinity);
	assert.equal(appeared.verdict, "regression");
});

test("a scenario regresses on any metric and passes only when all pass", () => {
	const pair = (base: number, head: number) => ({
		base: { interactionP95Ms: 200, domNodes: base },
		head: { interactionP95Ms: 200, domNodes: head },
	});
	assert.equal(judgeScenario([pair(1000, 1000)]).verdict, "pass");
	const grown = judgeScenario(repeat(0, 5).map(() => pair(1000, 2000)));
	assert.equal(grown.verdict, "regression");
	assert.equal(grown.worst?.metric, "domNodes");
	assert.equal(judgeScenario([pair(1000, 1200)]).verdict, "undecided");
	assert.equal(judgeScenario([]).verdict, "undecided");
});

test("metrics only one variant reports are not compared", () => {
	const result = judgeScenario([
		{
			base: { interactionP95Ms: 200, oldMs: 10 },
			head: { interactionP95Ms: 200, newMs: 10_000 },
		},
	]);
	assert.deepEqual(
		result.metrics.map((metric) => metric.metric),
		["interactionP95Ms"],
	);
	assert.equal(result.verdict, "pass");
});

test("a metric missing from some pairs still gets a verdict at the last pair", () => {
	const pairs = Array.from({ length: 5 }, (_, index) => ({
		base: { interactionP95Ms: 200, ...(index < 2 ? { frameP95Ms: 100 } : {}) },
		head: { interactionP95Ms: 200, frameP95Ms: 118 },
	}));
	const result = judgeScenario(pairs);
	assert.equal(result.verdict, "pass");
});

test("title patterns match exact test titles only", () => {
	const pattern = new RegExp(grepForTitles(["editor-pin-wire", "a.b"]));
	const full = (file: string, title: string, tags: string) =>
		`${file} ${title} ${tags}`;
	assert.ok(
		pattern.test(full("editor-pin-wire.spec.ts", "editor-pin-wire", "@editor")),
	);
	assert.ok(
		!pattern.test(
			full("editor-pin-wire.spec.ts", "editor-pin-wires", "@editor"),
		),
	);
	assert.ok(pattern.test(full("x.spec.ts", "a.b", "@core")));
	assert.ok(!pattern.test(full("x.spec.ts", "axb", "@core")));
	assert.ok(
		!pattern.test(full("editor-pin-wire-long.spec.ts", "other", "@editor")),
	);
});

test("perf commands parse into modes", () => {
	assert.equal(parseRun([], {}).mode, "ab");
	assert.equal(parseRun([], {}).baseRef, "origin/main");
	assert.equal(
		parseRun([], { ECAD_PERF_BASE: "upstream/main" }).baseRef,
		"upstream/main",
	);
	const based = parseRun(["--base", "abc123", "--all", "--workers=2"], {});
	assert.equal(based.baseRef, "abc123");
	assert.deepEqual(based.args, ["--all", "--workers=2"]);
	assert.equal(parseRun(["--base=v1"], {}).baseRef, "v1");
	assert.throws(() => parseRun(["--base"], {}), /needs a Git ref/);
	assert.equal(parseRun(["--budgets", "--all"], {}).mode, "budgets");
	assert.deepEqual(parseRun(["--budgets", "--all"], {}).args, []);
	assert.equal(parseRun(["--baseline"], {}).mode, "deprecated-baseline");
	assert.equal(
		parseRun(["--development", "--baseline"], {}).mode,
		"development",
	);
	assert.equal(parseRun(["--all"], { ECAD_PERF_SMOKE: "1" }).mode, "smoke");
	assert.equal(parseRun(["-g", "x"], {}).grep, true);
	assert.deepEqual(
		withoutGrep([
			"--grep",
			"a",
			"-g",
			"b",
			"--grep=c",
			"--grep-invert",
			"d",
			"--workers=1",
		]),
		["--grep-invert", "d", "--workers=1"],
	);
});

test("the base cache keeps recent entries and prunes old or surplus ones", () => {
	const root = mkdtempSync(join(tmpdir(), "ecad-perf-cache-"));
	const now = Date.now();
	const hour = 60 * 60 * 1000;
	const sha = (index: number) => index.toString(16).padStart(40, "0");
	try {
		mkdirSync(join(root, "archives"));
		for (let index = 0; index < 9; index++) {
			const directory = join(root, sha(index));
			mkdirSync(directory);
			writeFileSync(join(directory, ".ecad-perf-ready"), "{}");
			writeFileSync(join(root, "archives", `${sha(index)}.tar`), "");
			writeFileSync(join(root, `${sha(index)}.lock`), "");
			// Entry 0 is newest. 0–2 were used within six hours, 3–7 a day or
			// more ago, and 8 three weeks ago.
			const used = new Date(
				now -
					(index < 3
						? index * hour
						: index === 8
							? 21 * 24 * hour
							: index * 24 * hour),
			);
			utimesSync(join(directory, ".ecad-perf-ready"), used, used);
		}
		prune(root, sha(7), now);
		const left = readdirSync(root)
			.filter((name) => name !== "archives")
			.sort();
		// Keeps the five newest, plus the current entry; drops 5, 6 and 8
		// with their locks.
		const kept = [0, 1, 2, 3, 4, 7].map(sha);
		assert.deepEqual(
			left,
			kept.flatMap((name) => [name, `${name}.lock`]),
		);
		assert.equal(readdirSync(join(root, "archives")).length, 6);
	} finally {
		rmSync(root, { recursive: true });
	}
});

test("decision overrides must be valid numbers", () => {
	const defaults = decisionFromEnv({});
	assert.equal(defaults.cpu, 1);
	assert.equal(defaults.options.maxPairs, 5);
	assert.equal(defaults.options.floorScale, 0.25);
	const set = decisionFromEnv({
		ECAD_PERF_CPU: "2",
		ECAD_PERF_MAX_PAIRS: "9",
		ECAD_PERF_FLOOR_SCALE: "",
	});
	assert.equal(set.options.maxPairs, 9);
	assert.equal(set.options.floorScale, 0.5);
	for (const [name, value] of [
		["ECAD_PERF_MAX_PAIRS", "0"],
		["ECAD_PERF_MAX_PAIRS", "2.5"],
		["ECAD_PERF_MAX_PAIRS", "many"],
		["ECAD_PERF_FLOOR_SCALE", "abc"],
		["ECAD_PERF_FLOOR_SCALE", "-1"],
		["ECAD_PERF_CPU", "0"],
	])
		assert.throws(() => decisionFromEnv({ [name]: value }), new RegExp(name));
});

test("the portable build lock serializes builds of one commit", async () => {
	const root = mkdtempSync(join(tmpdir(), "ecad-perf-lock-"));
	const lock = join(root, "sha.lock.d");
	const events: string[] = [];
	const task = (id: string) => async () => {
		events.push(`${id} start`);
		await new Promise((done) => setTimeout(done, 50));
		events.push(`${id} end`);
	};
	try {
		await Promise.all([
			withDirectoryLock(lock, task("a")),
			withDirectoryLock(lock, task("b")),
		]);
		assert.deepEqual(events, ["a start", "a end", "b start", "b end"]);
		// A lock left by a build that died is taken over.
		mkdirSync(lock);
		const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
		utimesSync(lock, old, old);
		await withDirectoryLock(lock, task("c"));
		assert.deepEqual(events.slice(-2), ["c start", "c end"]);
		assert.deepEqual(readdirSync(root), []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a lost pair leaves a regression undecided, and the spare round decides it", () => {
	const regressed = {
		base: { interactionP95Ms: 200 },
		head: { interactionP95Ms: 600 },
	};
	// The base failed once, so five rounds produced four pairs.
	assert.equal(
		judgeScenario(repeat(0, 4).map(() => regressed)).verdict,
		"undecided",
	);
	assert.equal(maxRounds(), 6);
	assert.equal(maxRounds({ ...defaultDecision, maxPairs: 3 }), 4);
	assert.equal(
		judgeScenario(repeat(0, 5).map(() => regressed)).verdict,
		"regression",
	);
});

test("a metric reported in too few pairs cannot regress on its own", () => {
	const pairs = Array.from({ length: 5 }, (_, index) => ({
		base: { interactionP95Ms: 200, ...(index === 0 ? { sparseMs: 100 } : {}) },
		head: { interactionP95Ms: 200, ...(index === 0 ? { sparseMs: 900 } : {}) },
	}));
	const result = judgeScenario(pairs);
	const sparse = result.metrics.find((metric) => metric.metric === "sparseMs");
	assert.equal(sparse?.pairs, 1);
	assert.equal(sparse?.verdict, "undecided");
	assert.equal(result.verdict, "undecided");
	// With a lower pair limit, the needed pairs follow it, so regressions stay
	// possible.
	assert.equal(
		judgeMetric("interactionP95Ms", repeat(200, 3), repeat(600, 3), {
			...defaultDecision,
			maxPairs: 3,
		}).verdict,
		"regression",
	);
});

test("pruning skips a base build that a live run marks as in use", () => {
	const root = mkdtempSync(join(tmpdir(), "ecad-perf-in-use-"));
	const sha = (index: number) => index.toString(16).padStart(40, "0");
	const old = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000);
	try {
		for (const index of [1, 2]) {
			mkdirSync(join(root, sha(index)));
			writeFileSync(join(root, sha(index), ".ecad-perf-ready"), "{}");
			utimesSync(join(root, sha(index), ".ecad-perf-ready"), old, old);
		}
		const release = markInUse(join(root, sha(1)));
		// A marker from a process that is gone does not protect its entry.
		mkdirSync(join(root, `${sha(2)}.in-use`));
		writeFileSync(join(root, `${sha(2)}.in-use`, "999999999"), "1");
		assert.equal(inUse(root, sha(1)), true);
		assert.equal(inUse(root, sha(2)), false);
		prune(root, "none");
		assert.deepEqual(
			readdirSync(root).filter((name) => /^[0-9a-f]{40}$/.test(name)),
			[sha(1)],
		);
		release();
		assert.equal(inUse(root, sha(1)), false);
		prune(root, "none");
		assert.deepEqual(readdirSync(root), []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("an occupied preview port is detected before a server starts", async () => {
	const server = createServer();
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const { port } = server.address() as AddressInfo;
	try {
		assert.equal(await portAvailable(port), false);
	} finally {
		await new Promise((done) => server.close(done));
	}
	assert.equal(await portAvailable(port), true);
});

test("any run stops a leftover preview server once its owner run is gone", {
	skip: process.platform !== "linux",
}, async () => {
	const directory = mkdtempSync(join(tmpdir(), "ecad-perf-servers-"));
	const server = spawn(
		process.execPath,
		["-e", "setInterval(() => {}, 1000)"],
		{
			detached: true,
			stdio: "ignore",
		},
	);
	const exited = once(server, "exit");
	try {
		assert.ok(server.pid);
		const port = 4999;
		const current = new ServerRecords(directory);
		// Its owner is alive (this process), so another run leaves it alone.
		current.add(server.pid, port);
		assert.equal(new ServerRecords(directory).stopLeftover(port), false);
		// A record from another PID namespace, such as a sandbox container,
		// names PIDs this host cannot match.
		const file = join(directory, `${port}.json`);
		const record = JSON.parse(readFileSync(file, "utf8"));
		writeFileSync(file, JSON.stringify({ ...record, namespace: "pid:[1]" }));
		assert.equal(current.stopLeftover(port), false);
		// The owning run is gone, so the server is stopped and forgotten.
		new ServerRecords(directory, { pid: 999_999_999, start: "gone" }).add(
			server.pid,
			port,
		);
		assert.equal(current.stopLeftover(port), true);
		await exited;
		assert.equal(existsSync(file), false);
		// A record whose server already exited is just removed.
		new ServerRecords(directory, { pid: 999_999_999, start: "gone" }).add(
			process.pid,
			port,
		);
		writeFileSync(
			file,
			JSON.stringify({
				...JSON.parse(readFileSync(file, "utf8")),
				server: { pid: server.pid, start: "reused" },
			}),
		);
		assert.equal(current.stopLeftover(port), false);
		assert.equal(existsSync(file), false);
		// A run forgets only its own record.
		current.add(process.pid, port);
		new ServerRecords(directory, { pid: 999_999_999, start: "gone" }).release(
			port,
		);
		assert.equal(existsSync(file), true);
		current.release(port);
		assert.equal(existsSync(file), false);
	} finally {
		if (server.exitCode === null && server.signalCode === null) server.kill();
		rmSync(directory, { recursive: true, force: true });
	}
});
