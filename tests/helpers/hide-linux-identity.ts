// Preload for CLI tests: makes the Linux identity files named in
// ECAD_TEST_HIDE_IDENTITY (pidNamespace, bootId, ownProc) unreadable, as in a
// restricted container. Hiding /proc/self acts like a PID namespace that kept
// its parent's /proc.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const hidden = new Set((process.env.ECAD_TEST_HIDE_IDENTITY ?? "").split(","));
const paths = new Map([
	["/proc/self/ns/pid", "pidNamespace"],
	["/proc/sys/kernel/random/boot_id", "bootId"],
	["/proc/self", "ownProc"],
]);
const blocked = (path: unknown) => {
	const name = paths.get(String(path));
	return name !== undefined && hidden.has(name);
};
const denied = (path: unknown) =>
	Object.assign(new Error(`EACCES: permission denied, '${path}'`), {
		code: "EACCES",
	});
const { readFile, readlink } = fs.promises;
fs.promises.readFile = ((
	path: Parameters<typeof readFile>[0],
	...rest: unknown[]
) =>
	blocked(path)
		? Promise.reject(denied(path))
		: (readFile as (...args: unknown[]) => unknown)(
				path,
				...rest,
			)) as typeof readFile;
fs.promises.readlink = ((
	path: Parameters<typeof readlink>[0],
	...rest: unknown[]
) =>
	blocked(path)
		? Promise.reject(denied(path))
		: (readlink as (...args: unknown[]) => unknown)(
				path,
				...rest,
			)) as typeof readlink;
syncBuiltinESMExports();
