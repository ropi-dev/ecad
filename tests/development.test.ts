import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runLocked } from "../scripts/development/common.ts";

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
