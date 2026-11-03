// Preload for CLI tests: kills the process with SIGKILL as soon as it creates a
// file whose name ends with ECAD_TEST_CRASH_SUFFIX, before any later write.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const suffix = process.env.ECAD_TEST_CRASH_SUFFIX;
const { link, open } = fs.promises;
const crash = (path: fs.PathLike) => {
	if (suffix && String(path).endsWith(suffix)) process.kill(process.pid, "SIGKILL");
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
