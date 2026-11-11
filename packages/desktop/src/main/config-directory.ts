import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export interface ConfigPaths {
	directory: string;
	legacyDirectory: string;
}

export function configPaths(
	home?: string,
	platform: NodeJS.Platform = process.platform,
): ConfigPaths {
	const env: Record<string, string | undefined> =
		home === undefined ? process.env : {};
	const base = home ?? homedir();
	const xdg = env.XDG_CONFIG_HOME;
	const directory =
		platform === "win32"
			? join(env.APPDATA ?? join(base, "AppData", "Roaming"), "ecad")
			: platform === "darwin"
				? join(base, "Library", "Application Support", "ecad")
				: join(xdg && isAbsolute(xdg) ? xdg : join(base, ".config"), "ecad");
	return { directory, legacyDirectory: join(base, ".ecad") };
}
