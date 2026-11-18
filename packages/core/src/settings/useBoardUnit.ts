import type { LengthUnit } from "@ecad/drawing-core/drawing/units.ts";
import { updateAppSettings, useAppSettings } from "#/settings/store.ts";

export const useBoardUnit = (): LengthUnit =>
	useAppSettings().boardUnit ?? "mm";

export const setBoardUnit = (boardUnit: LengthUnit) =>
	updateAppSettings((current) => ({ ...current, boardUnit })).catch(
		() => undefined,
	);
