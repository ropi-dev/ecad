import { catalog } from "./catalog.ts";
import type { DefaultModel } from "./types.ts";

export type { DefaultModel } from "./types.ts";

export function defaultModels(): DefaultModel[] {
	return catalog.map((model) => ({ ...model }));
}
