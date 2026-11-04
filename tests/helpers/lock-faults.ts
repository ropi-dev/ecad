// Preload for CLI tests that injects lock file faults:
// - ECAD_TEST_CRASH_PATTERN: SIGKILL the process as soon as it creates a file
//   whose name matches this regular expression, before any later write.
// - ECAD_TEST_DROP_COPY: remove the first staged lock copy just before it is
//   linked, as recovery does for a copy left incomplete by a paused process.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { basename } from "node:path";

const pattern = process.env.ECAD_TEST_CRASH_PATTERN;
let dropCopy = !!process.env.ECAD_TEST_DROP_COPY;
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
syncBuiltinESMExports();
