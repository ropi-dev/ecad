import "@ecad/core/performance/initialize.ts";
import { startTelemetry } from "@ecad/core/telemetry/telemetry.ts";
import { StartClient } from "@tanstack/react-start/client";
import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";

startTelemetry();

startTransition(() => {
	hydrateRoot(
		document,
		<StrictMode>
			<StartClient />
		</StrictMode>,
	);
});
