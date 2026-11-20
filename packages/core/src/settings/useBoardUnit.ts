import type { LengthUnit } from "@ecad/drawing-core/drawing/units.ts";
import type { Accessor } from "solid-js";
import { updateAppSettings, useAppSettings } from "#/settings/store.ts";

export function useBoardUnit(): Accessor<LengthUnit> {
	const settings = useAppSettings();
	return () => settings().boardUnit ?? "mm";
}

export const setBoardUnit = (boardUnit: LengthUnit) =>
	updateAppSettings((current) => ({ ...current, boardUnit })).catch(
		() => undefined,
	);
