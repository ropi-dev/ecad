import "@ecad/core/performance/initialize.ts";
import { startTelemetry } from "@ecad/core/telemetry/telemetry.ts";
import { hydrate } from "@solidjs/web";
import { hydrateStart, StartClient } from "@tanstack/solid-start/client";

startTelemetry();

void hydrateStart().then((router) => {
	hydrate(() => <StartClient router={router} />, document);
});
