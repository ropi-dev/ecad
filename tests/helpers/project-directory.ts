import type { ProjectDirectory } from "#/projects/repository.ts";

export function memoryDirectory(name = "Circuit project") {
	const files = new Map<string, Uint8Array>();
	let failPath = "";
	const directory: ProjectDirectory = {
		name,
		async read(path) {
			const bytes = files.get(path);
			if (!bytes) throw new DOMException("Missing file", "NotFoundError");
			return bytes;
		},
		async write(path, bytes) {
			if (path === failPath) throw new Error("Disk full");
			files.set(path, bytes);
		},
		async remove(path) {
			for (const key of files.keys())
				if (key === path || key.startsWith(`${path}/`)) files.delete(key);
		},
	};
	return {
		directory,
		files,
		fail(path: string) {
			failPath = path;
		},
	};
}
