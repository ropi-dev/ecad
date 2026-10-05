import {
	Profiler,
	type ProfilerOnRenderCallback,
	type ReactNode,
	useEffect,
} from "react";
import { getAppPerformance } from "#/performance/runtime.ts";

const onRender: ProfilerOnRenderCallback = (
	id,
	phase,
	actualDuration,
	baseDuration,
	startTime,
) => {
	getAppPerformance()?.record(
		`react.${id}`,
		actualDuration,
		{ phase, baseDuration },
		startTime,
	);
};

export function PerformanceBoundary({
	name,
	path,
	children,
}: {
	name: string;
	path: string;
	children: ReactNode;
}) {
	useEffect(() => {
		getAppPerformance()?.workspaceReady(path);
	}, [path]);
	if (!getAppPerformance()) return children;
	return (
		<Profiler id={name} onRender={onRender}>
			{children}
		</Profiler>
	);
}
