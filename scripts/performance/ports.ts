import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { processStart } from "../development/common.ts";

/** Whether nothing listens on `127.0.0.1:port`. */
export function portAvailable(port: number): Promise<boolean> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once("error", (error: NodeJS.ErrnoException) => {
			if (error.code === "EADDRINUSE" || error.code === "EACCES")
				resolve(false);
			else reject(error);
		});
		server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
	});
}

interface Recorded {
	pid: number;
	start: string;
	port: number;
}

/**
 * Preview servers this checkout started, recorded by PID and process start
 * time so a reused PID is never mistaken for one of them.
 */
export class ServerRecord {
	constructor(private readonly file: string) {}

	private read(): Recorded[] {
		if (!existsSync(this.file)) return [];
		try {
			return JSON.parse(readFileSync(this.file, "utf8"));
		} catch {
			return [];
		}
	}

	add(pid: number, port: number): void {
		const start = processStart(pid);
		if (start)
			writeFileSync(
				this.file,
				JSON.stringify([...this.read(), { pid, start, port }]),
			);
	}

	/** Stops servers left by an earlier run of this checkout that was killed. */
	stopLeftovers(): number[] {
		const stopped: number[] = [];
		for (const server of this.read()) {
			if (processStart(server.pid) !== server.start) continue;
			try {
				process.kill(-server.pid, "SIGTERM");
				stopped.push(server.port);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
			}
		}
		rmSync(this.file, { force: true });
		return stopped;
	}

	clear(): void {
		rmSync(this.file, { force: true });
	}
}
