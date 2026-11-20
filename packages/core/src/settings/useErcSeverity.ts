import type { ErcOptions } from "@ecad/drawing-core/erc/engine.ts";
import { type Accessor, createMemo } from "solid-js";
import { useProjectSelection } from "#/projects/ProjectProvider.tsx";
import { useAppSettings } from "#/settings/store.ts";

export function useErcSeverity(): Accessor<ErcOptions["severity"]> {
	const settings = useAppSettings();
	const project = useProjectSelection(
		(value) => value.project?.manifest.settings?.ercSeverity,
	);
	const key = createMemo(() => {
		const merged = { ...settings().ercSeverity, ...project() };
		return JSON.stringify(merged, Object.keys(merged).sort());
	});
	return createMemo(() => JSON.parse(key()));
}
