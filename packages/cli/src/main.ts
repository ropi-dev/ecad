import { runCli } from "./cli.ts";

const controller = new AbortController();
let signalExitCode: number | undefined;
const interrupt = () => {
	signalExitCode = 130;
	controller.abort();
};
const terminate = () => {
	signalExitCode = 143;
	controller.abort();
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", terminate);
try {
	const code = await runCli(process.argv.slice(2), {
		signal: controller.signal,
	});
	process.exitCode = signalExitCode ?? code;
} finally {
	process.off("SIGINT", interrupt);
	process.off("SIGTERM", terminate);
}
// After a signal, exit at once as the default handler would, even while
// output that nobody reads is still queued for stdout.
if (signalExitCode !== undefined) process.exit(signalExitCode);
