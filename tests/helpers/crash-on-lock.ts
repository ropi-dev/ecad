// Preload for CLI tests: kills the process with SIGKILL as soon as it creates a
// file whose name matches the ECAD_TEST_CRASH_PATTERN regular expression,
// before any later write.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { basename } from "node:path";

const pattern = process.env.ECAD_TEST_CRASH_PATTERN;
const { link, open } = fs.promises;
const crash = (path: fs.PathLike) => {
	if (pattern && new RegExp(pattern).test(basename(String(path)))) process.kill(process.pid, "SIGKILL");
};
fs.promises.link = async (existing, path) => {
	await link(existing, path);
	crash(path);
};
fs.promises.open = async (path, flags, mode) => {
	const handle = await open(path, flags, mode);
	if (flags === "wx") crash(path);
	return handle;
};
syncBuiltinESMExports();
