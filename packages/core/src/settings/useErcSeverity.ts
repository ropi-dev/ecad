import type { ErcOptions } from "@ecad/drawing-core/erc/engine.ts";
import { useMemo } from "react";
import { useProjectSelection } from "#/projects/ProjectProvider.tsx";
import { useAppSettings } from "#/settings/store.ts";

export function useErcSeverity(): ErcOptions["severity"] {
	const global = useAppSettings().ercSeverity;
	const project = useProjectSelection(
		(value) => value.project?.manifest.settings?.ercSeverity,
	);
	const merged = { ...global, ...project };
	const key = JSON.stringify(merged, Object.keys(merged).sort());
	return useMemo(() => JSON.parse(key), [key]);
}
