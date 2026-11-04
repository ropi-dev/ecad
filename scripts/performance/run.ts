import { fileURLToPath } from "node:url";
import { run, runLocked } from "../development/common.ts";

const args = [
	"--import",
	"tsx",
	fileURLToPath(new URL("./worker.ts", import.meta.url)),
	...process.argv.slice(2),
];
const env = { ...process.env, ECAD_PERF_LOCK_HELD: "1" };
const alreadyLocked = process.env.ECAD_PERF_LOCK_HELD === "1";
if (process.platform !== "linux" && !alreadyLocked)
	console.warn(
		"[ecad] The host benchmark queue is Linux-only. Running native perf without the shared queue.",
	);
process.exitCode = await (alreadyLocked || process.platform !== "linux"
	? run(process.execPath, args, env)
	: runLocked("perf", process.execPath, args, env));
