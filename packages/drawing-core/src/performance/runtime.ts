type PerformanceData = Record<string, number | boolean | string>;

interface PerformanceRecorder {
	measure<T>(name: string, work: () => T, data?: PerformanceData): T;
	measureAsync<T>(
		name: string,
		work: () => Promise<T>,
		data?: PerformanceData,
	): Promise<T>;
}

const getRecorder = () =>
	(globalThis as { window?: { __ecadPerformance?: PerformanceRecorder } })
		.window?.__ecadPerformance;

export function measurePerformance<T>(
	name: string,
	work: () => T,
	data?: PerformanceData,
): T {
	const recorder = getRecorder();
	return recorder ? recorder.measure(name, work, data) : work();
}

export function measurePerformanceAsync<T>(
	name: string,
	work: () => Promise<T>,
	data?: PerformanceData,
): Promise<T> {
	const recorder = getRecorder();
	return recorder ? recorder.measureAsync(name, work, data) : work();
}
