import type { JSX } from "@solidjs/web";
import { createEffect } from "solid-js";
import { getAppPerformance } from "#/performance/runtime.ts";

export function PerformanceBoundary(props: {
	name: string;
	path: string;
	children: JSX.Element;
}) {
	createEffect(
		() => props.path,
		(path) => {
			getAppPerformance()?.workspaceReady(path);
		},
	);
	return props.children;
}
