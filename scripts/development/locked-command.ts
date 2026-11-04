import { processStart, run } from "./common.ts";

const [owner, start, command, ...args] = process.argv.slice(2);
const alive = () => Boolean(start) && processStart(Number(owner)) === start;
if (!alive()) process.exit(143);
const timer = setInterval(() => {
	if (!alive()) process.kill(process.pid, "SIGTERM");
}, 250);
timer.unref();
try {
	process.exitCode = await run(command, args);
} finally {
	clearInterval(timer);
}
