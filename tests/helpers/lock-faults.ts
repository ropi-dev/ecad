// Preload for CLI tests that injects lock file faults:
// - ECAD_TEST_CRASH_PATTERN: SIGKILL the process as soon as it creates a file
//   whose name matches this regular expression, before any later write.
// - ECAD_TEST_DROP_COPY: remove the first staged lock copy just before it is
//   linked, as recovery does for a copy left incomplete by a paused process.
// - ECAD_TEST_SIGNAL_ON_RELEASE: send this signal, such as SIGTERM, to this
//   process when it starts removing a drawing lock, and finish the removal
//   300 ms later.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { basename } from "node:path";

const pattern = process.env.ECAD_TEST_CRASH_PATTERN;
let dropCopy = !!process.env.ECAD_TEST_DROP_COPY;
let signalOnRelease = process.env.ECAD_TEST_SIGNAL_ON_RELEASE as NodeJS.Signals | undefined;
const { link, open, rm } = fs.promises;
const crash = (path: fs.PathLike) => {
	if (pattern && new RegExp(pattern).test(basename(String(path)))) process.kill(process.pid, "SIGKILL");
};
fs.promises.link = async (existing, path) => {
	if (dropCopy) {
		dropCopy = false;
		await rm(existing);
	}
	await link(existing, path);
	crash(path);
};
fs.promises.open = async (path, flags, mode) => {
	const handle = await open(path, flags, mode);
	if (flags === "wx") crash(path);
	return handle;
};
fs.promises.rm = async (path, options) => {
	if (signalOnRelease && String(path).endsWith(".ecaddraw.lock")) {
		process.kill(process.pid, signalOnRelease);
		signalOnRelease = undefined;
		await new Promise((resolve) => setTimeout(resolve, 300));
	}
	return rm(path, options);
};
syncBuiltinESMExports();
