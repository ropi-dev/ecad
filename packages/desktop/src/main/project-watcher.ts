import { type FSWatcher, watch as watchDirectory } from "node:fs";
import { join } from "node:path";
import { PROJECT_FILE } from "@ecad/core/projects/format.ts";

export interface ProjectWatcherOptions {
	/** The project directory's absolute path. */
	directory: string;
	/** The project paths, other than the manifest, whose changes matter. */
	paths(): readonly string[];
	/** Called once a burst of relevant events has settled. */
	onChange(): void;
	watch?: typeof watchDirectory;
	/** Quiet time after the last event before `onChange`, in milliseconds. */
	delay?: number;
	/** Longest wait after the first event of a burst, in milliseconds. */
	maxDelay?: number;
}

export interface ProjectWatcher {
	/**
	 * Watches the directories that hold the current paths, retrying
	 * directories whose watchers failed.
	 */
	sync(): void;
	close(): void;
}

/**
 * Watches the project directory and each directory holding a project file,
 * without recursion, so `.git`, assets and other folders cost nothing.
 * Events are hints: they only start a comparison with the saved files, so
 * missed, duplicate or spurious events cannot change the project. Atomic
 * saves replace files, so directories are watched rather than files.
 */
export function createProjectWatcher({
	directory,
	paths,
	onChange,
	watch = watchDirectory,
	delay = 300,
	maxDelay = 2000,
}: ProjectWatcherOptions): ProjectWatcher {
	const watchers = new Map<string, FSWatcher>();
	// Directories whose watcher failed wait for the next external sync, so a
	// directory that keeps failing cannot start a check every few hundred ms.
	const failed = new Set<string>();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let burstStart: number | undefined;
	let closed = false;

	function directories() {
		const wanted = new Set([""]);
		for (const path of paths()) {
			const parts = path.split("/");
			for (let index = 1; index < parts.length; index++)
				wanted.add(parts.slice(0, index).join("/"));
		}
		return wanted;
	}
	// Temporary, lock and history files never match a listed path.
	function relevant(path: string) {
		return [PROJECT_FILE, ...paths()].some(
			(listed) => listed === path || listed.startsWith(`${path}/`),
		);
	}
	function schedule() {
		if (closed) return;
		const now = Date.now();
		burstStart ??= now;
		clearTimeout(timer);
		timer = setTimeout(
			settle,
			Math.max(0, Math.min(delay, burstStart + maxDelay - now)),
		);
	}
	function settle() {
		timer = undefined;
		burstStart = undefined;
		if (closed) return;
		watchDirectories();
		onChange();
	}
	function forget(key: string) {
		watchers.get(key)?.close();
		watchers.delete(key);
	}
	function watchDirectories() {
		if (closed) return;
		const wanted = directories();
		for (const key of watchers.keys()) if (!wanted.has(key)) forget(key);
		for (const key of wanted) {
			if (watchers.has(key) || failed.has(key)) continue;
			let watcher: FSWatcher;
			try {
				watcher = watch(
					key ? join(directory, ...key.split("/")) : directory,
					{ persistent: false },
					(_event, filename) => {
						if (filename == null) return schedule();
						const path = key ? `${key}/${filename}` : String(filename);
						// A replaced directory needs a new watcher, even if the old one
						// failed.
						if (watchers.has(path)) forget(path);
						failed.delete(path);
						if (relevant(path)) schedule();
					},
				);
			} catch {
				// A missing directory is reported by its parent once it appears.
				continue;
			}
			watcher.on("error", () => {
				if (watchers.get(key) !== watcher) return;
				forget(key);
				failed.add(key);
				schedule();
			});
			watchers.set(key, watcher);
		}
	}
	watchDirectories();
	return {
		sync() {
			failed.clear();
			watchDirectories();
		},
		close() {
			closed = true;
			clearTimeout(timer);
			for (const key of [...watchers.keys()]) forget(key);
		},
	};
}
