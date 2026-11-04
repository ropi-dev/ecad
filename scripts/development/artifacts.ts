import { lstatSync, mkdirSync, readlinkSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { worktreeId } from "./common.ts";

export function prepareArtifacts(): string {
	const alias = resolve("perf-artifacts");
	let directory = resolve(
		process.env.ECAD_ARTIFACT_DIR ??
			join(tmpdir(), "ecad", worktreeId(), "perf-artifacts"),
	);
	let exists = false;
	try {
		const entry = lstatSync(alias);
		if (!entry.isSymbolicLink())
			throw new Error(
				"Move perf-artifacts under /tmp and replace it with a symlink before running checks.",
			);
		directory = resolve(dirname(alias), readlinkSync(alias));
		exists = true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const fromTemp = relative(resolve(tmpdir()), directory);
	if (
		!fromTemp ||
		fromTemp === ".." ||
		fromTemp.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
		isAbsolute(fromTemp)
	)
		throw new Error("Performance artifacts must be under /tmp.");
	if (
		process.env.ECAD_ARTIFACT_DIR &&
		directory !== resolve(process.env.ECAD_ARTIFACT_DIR)
	)
		throw new Error(
			"perf-artifacts points to a different ECAD_ARTIFACT_DIR. Remove the symlink before changing artifact directories.",
		);
	mkdirSync(directory, { recursive: true });
	if (!exists) {
		try {
			symlinkSync(
				directory,
				alias,
				process.platform === "win32" ? "junction" : "dir",
			);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			return prepareArtifacts();
		}
	}
	return directory;
}
