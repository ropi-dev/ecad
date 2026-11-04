import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
	appendFileSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runLocked, worktreeId } from "../scripts/development/common.ts";
import { compareBaseline, type Summary } from "./performance/comparison.ts";

test("worktree identities separate checkouts and resolve symlinks", () => {
	const first = mkdtempSync(join(tmpdir(), "ecad-identity-"));
	const second = mkdtempSync(join(tmpdir(), "ecad-identity-"));
	try {
		symlinkSync(first, join(second, "alias"));
		assert.notEqual(worktreeId(first), worktreeId(second));
		assert.equal(worktreeId(first), worktreeId(join(second, "alias")));
	} finally {
		rmSync(first, { recursive: true });
		rmSync(second, { recursive: true });
	}
});

test("separate processes queue on the same host lock and release it after failure", {
	skip: process.platform !== "linux",
	timeout: 10000,
}, async () => {
	const directory = mkdtempSync(join(tmpdir(), "ecad-lock-test-"));
	const events = join(directory, "events");
	appendFileSync(events, "");
	const env = { ...process.env, ECAD_LOCK_DIR: directory };
	const child = `const fs=require('node:fs'); const [file,id,status]=process.argv.slice(1); fs.appendFileSync(file,id+' start\\n'); setTimeout(()=>{ fs.appendFileSync(file,id+' end\\n'); process.exit(Number(status)); },150);`;
	try {
		assert.deepEqual(
			await Promise.all([
				runLocked(
					"perf",
					process.execPath,
					["-e", child, events, "a", "7"],
					env,
				),
				runLocked(
					"perf",
					process.execPath,
					["-e", child, events, "b", "0"],
					env,
				),
			]),
			[7, 0],
		);
		const lines = readFileSync(events, "utf8").trim().split("\n");
		assert.equal(lines.length, 4);
		assert.equal(lines[1], lines[0].replace("start", "end"));
		assert.equal(lines[3], lines[2].replace("start", "end"));
		assert.notEqual(lines[0][0], lines[2][0]);
	} finally {
		rmSync(directory, { recursive: true });
	}
});

test("native and container baseline profiles cannot cross in either direction", () => {
	const native: Summary = {
		version: 1,
		profile: {
			mode: "production",
			cpu: 4,
			platform: "linux",
			browser: "chromium",
		},
		scenarios: {},
	};
	const container = structuredClone(native);
	container.profile.environment = "image-a";
	assert.equal(compareBaseline(native, container).length, 1);
	assert.equal(compareBaseline(container, native).length, 1);
	const otherImage = structuredClone(container);
	otherImage.profile.environment = "image-b";
	assert.equal(compareBaseline(container, otherImage).length, 1);
	assert.deepEqual(compareBaseline(container, structuredClone(container)), []);
});

test("shared validation jobs can overlap while a benchmark waits", {
	skip: process.platform !== "linux",
	timeout: 10000,
}, async () => {
	const directory = mkdtempSync(join(tmpdir(), "ecad-shared-lock-"));
	const events = join(directory, "events");
	appendFileSync(events, "");
	const env = { ...process.env, ECAD_LOCK_DIR: directory };
	const reader = `const fs=require('node:fs'); const [file,id]=process.argv.slice(1); fs.appendFileSync(file,id+' start\\n'); const timer=setInterval(()=>{ if(fs.readFileSync(file,'utf8').includes('release')) { clearInterval(timer); fs.appendFileSync(file,id+' end\\n'); } },10);`;
	try {
		const readers = ["a", "b"].map((id) =>
			runLocked(
				"perf",
				process.execPath,
				["-e", reader, events, id],
				env,
				true,
			),
		);
		const deadline = Date.now() + 3000;
		while (readFileSync(events, "utf8").split("start").length !== 3) {
			assert.ok(
				Date.now() < deadline,
				"both readers must acquire the lock together",
			);
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		const writer = runLocked(
			"perf",
			process.execPath,
			[
				"-e",
				"require('node:fs').appendFileSync(process.argv[1],'benchmark\\n')",
				events,
			],
			env,
		);
		appendFileSync(events, "release\n");
		assert.deepEqual(await Promise.all([...readers, writer]), [0, 0, 0]);
		assert.equal(
			readFileSync(events, "utf8").trim().split("\n").at(-1),
			"benchmark",
		);
	} finally {
		rmSync(directory, { recursive: true });
	}
});

for (const signal of ["SIGTERM", "SIGHUP"] as const) {
	test(`cancelling with ${signal} releases the lock and terminates its worker`, {
		skip: process.platform !== "linux",
		timeout: 10000,
	}, async () => {
		const directory = mkdtempSync(join(tmpdir(), "ecad-cancel-lock-"));
		const ready = join(directory, "ready");
		const env = { ...process.env, ECAD_LOCK_DIR: directory };
		const helper = new URL("../scripts/development/common.ts", import.meta.url)
			.href;
		const worker =
			"require('node:fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)";
		const program = `import {runLocked} from ${JSON.stringify(helper)}; process.exitCode=await runLocked('perf',process.execPath,['-e',${JSON.stringify(worker)},${JSON.stringify(ready)}]);`;
		const child = spawn(
			process.execPath,
			["--input-type=module", "-e", program],
			{ env, stdio: "ignore" },
		);
		const exited = new Promise<number | null>((resolve) =>
			child.once("exit", resolve),
		);
		try {
			const deadline = Date.now() + 3000;
			let pid = 0;
			while (!pid) {
				try {
					pid = Number(readFileSync(ready, "utf8"));
				} catch {}
				assert.ok(Date.now() < deadline, "worker must acquire the lock");
				if (!pid) await new Promise((resolve) => setTimeout(resolve, 10));
			}
			child.kill(signal);
			assert.equal(await exited, signal === "SIGHUP" ? 129 : 143);
			assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
			assert.equal(
				await runLocked("perf", process.execPath, ["-e", ""], env),
				0,
			);
		} finally {
			child.kill("SIGKILL");
			rmSync(directory, { recursive: true });
		}
	});
}

test("a queued command cannot run after its launcher is killed", {
	skip: process.platform !== "linux",
	timeout: 10000,
}, async () => {
	const directory = mkdtempSync(join(tmpdir(), "ecad-abandoned-lock-"));
	const ready = join(directory, "ready");
	const release = join(directory, "release");
	const unexpected = join(directory, "unexpected");
	const env = { ...process.env, ECAD_LOCK_DIR: directory };
	const holderCode = `const fs=require('node:fs');fs.writeFileSync(process.argv[1],'ready');const timer=setInterval(()=>{if(fs.existsSync(process.argv[2])){clearInterval(timer);}},10);`;
	const holder = runLocked(
		"perf",
		process.execPath,
		["-e", holderCode, ready, release],
		env,
		true,
	);
	const waitFor = async (predicate: () => boolean) => {
		const deadline = Date.now() + 3000;
		while (!predicate()) {
			assert.ok(Date.now() < deadline);
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	};
	await waitFor(() => existsSync(ready));
	const helper = new URL("../scripts/development/common.ts", import.meta.url)
		.href;
	const code = `import {runLocked} from ${JSON.stringify(helper)};process.exitCode=await runLocked('perf',process.execPath,['-e',"require('node:fs').writeFileSync(process.argv[1],'unexpected')",${JSON.stringify(unexpected)}]);`;
	const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
		env,
		stdio: ["ignore", "pipe", "pipe"],
	});
	const queued = new Promise<void>((resolve) =>
		child.stdout.once("data", () => resolve()),
	);
	const exited = new Promise((resolve) => child.once("exit", resolve));
	try {
		await queued;
		await new Promise((resolve) => setTimeout(resolve, 150));
		child.kill("SIGKILL");
		await exited;
		writeFileSync(release, "release");
		assert.equal(await holder, 0);
		assert.equal(await runLocked("perf", process.execPath, ["-e", ""], env), 0);
		assert.equal(existsSync(unexpected), false);
	} finally {
		child.kill("SIGTERM");
		writeFileSync(release, "release");
		await holder;
		rmSync(directory, { recursive: true });
	}
});

test("native lock overrides create fresh nested directories", {
	skip: process.platform !== "linux",
}, async () => {
	const directory = mkdtempSync(join(tmpdir(), "ecad-fresh-lock-"));
	const locks = join(directory, "nested/locks");
	try {
		assert.equal(
			await runLocked("perf", process.execPath, ["-e", ""], {
				...process.env,
				ECAD_LOCK_DIR: locks,
			}),
			0,
		);
		assert.equal(statSync(locks).isDirectory(), true);
		assert.equal(statSync(locks).mode & 0o777, 0o700);
	} finally {
		rmSync(directory, { recursive: true });
	}
});
