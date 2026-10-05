import { spawn } from "node:child_process";
import electron from "electron";
import { createServer } from "vite";
import { buildElectron } from "./electron-build.mjs";

await buildElectron();
const server = await createServer();
await server.listen();
server.printUrls();
const rendererUrl = server.resolvedUrls.local[0];
const environment = { ...process.env, ECAD_RENDERER_URL: rendererUrl };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [".", ...process.argv.slice(2)], {
	stdio: "inherit",
	env: environment,
});
const close = async () => {
	child.kill();
	await server.close();
};
process.on("SIGINT", close);
process.on("SIGTERM", close);
child.on("error", async (error) => {
	console.error(error);
	await server.close();
	process.exitCode = 1;
});
child.on("exit", async (code) => {
	await server.close();
	process.exitCode = code ?? 0;
});
