import { spawn } from "node:child_process";
import electron from "electron";

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.ECAD_RENDERER_URL;
const child = spawn(electron, [".", ...process.argv.slice(2)], {
	stdio: "inherit",
	env: environment,
});
process.on("SIGINT", () => child.kill());
process.on("SIGTERM", () => child.kill());
child.on("error", (error) => {
	console.error(error);
	process.exitCode = 1;
});
child.on("exit", (code) => {
	process.exitCode = code ?? 0;
});
