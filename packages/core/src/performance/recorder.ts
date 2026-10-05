export type PerformanceData = Record<string, number | boolean | string>;
export type PerformanceStatus = "ok" | "error" | "cancelled";
export interface PerformanceSample {
	name: string;
	startTime: number;
	duration: number;
	status: PerformanceStatus;
	data?: PerformanceData;
}
export interface PerformanceMetric {
	count: number;
	errors: number;
	total: number;
	max: number;
	p50: number;
	p95: number;
	sampleCount: number;
}
interface MetricState {
	count: number;
	errors: number;
	total: number;
	max: number;
	values: number[];
	cursor: number;
}

export class PerformanceRecorder {
	private events: PerformanceSample[] = [];
	private cursor = 0;
	private metrics = new Map<string, MetricState>();
	private startedAt: number;

	constructor(
		private clock: () => number = () => performance.now(),
		private eventLimit = 512,
		private sampleLimit = 120,
		private metricLimit = 128,
		private onRecord?: (sample: PerformanceSample) => void,
	) {
		this.startedAt = clock();
		if (
			[eventLimit, sampleLimit, metricLimit].some(
				(value) => !Number.isInteger(value) || value < 1,
			)
		)
			throw new Error("Performance limits must be positive integers.");
	}

	record(
		name: string,
		duration: number,
		data?: PerformanceData,
		startTime = this.clock() - duration,
		status: PerformanceStatus = "ok",
	) {
		if (
			!Number.isFinite(duration) ||
			duration < 0 ||
			!Number.isFinite(startTime)
		)
			return;
		let metric = this.metrics.get(name);
		if (!metric) {
			if (this.metrics.size >= this.metricLimit) return;
			metric = { count: 0, errors: 0, total: 0, max: 0, values: [], cursor: 0 };
			this.metrics.set(name, metric);
		}
		metric.count++;
		metric.errors += status === "error" ? 1 : 0;
		metric.total += duration;
		metric.max = Math.max(metric.max, duration);
		metric.values[metric.cursor] = duration;
		metric.cursor = (metric.cursor + 1) % this.sampleLimit;
		this.events[this.cursor] = {
			name,
			duration,
			startTime,
			status,
			...(data ? { data: { ...data } } : {}),
		};
		this.onRecord?.(this.events[this.cursor]);
		this.cursor = (this.cursor + 1) % this.eventLimit;
	}

	start(name: string, data?: PerformanceData) {
		const startTime = this.clock();
		let finished = false;
		return (status: PerformanceStatus = "ok") => {
			if (finished) return;
			finished = true;
			this.record(name, this.clock() - startTime, data, startTime, status);
		};
	}

	measure<T>(name: string, work: () => T, data?: PerformanceData): T {
		const finish = this.start(name, data);
		try {
			const result = work();
			finish();
			return result;
		} catch (error) {
			finish("error");
			throw error;
		}
	}

	async measureAsync<T>(
		name: string,
		work: () => Promise<T>,
		data?: PerformanceData,
	): Promise<T> {
		const finish = this.start(name, data);
		try {
			const result = await work();
			finish();
			return result;
		} catch (error) {
			finish(
				error instanceof Error && error.name === "AbortError"
					? "cancelled"
					: "error",
			);
			throw error;
		}
	}

	reset() {
		this.events = [];
		this.cursor = 0;
		this.metrics.clear();
		this.startedAt = this.clock();
	}

	snapshot() {
		const metrics: Record<string, PerformanceMetric> = {};
		for (const [name, metric] of this.metrics) {
			const sorted = [...metric.values].sort((a, b) => a - b);
			const percentile = (percent: number) =>
				sorted[Math.max(0, Math.ceil(sorted.length * percent) - 1)] ?? 0;
			metrics[name] = {
				count: metric.count,
				errors: metric.errors,
				total: metric.total,
				max: metric.max,
				p50: percentile(0.5),
				p95: percentile(0.95),
				sampleCount: sorted.length,
			};
		}
		const events =
			this.events.length === this.eventLimit
				? [
						...this.events.slice(this.cursor),
						...this.events.slice(0, this.cursor),
					]
				: [...this.events];
		return {
			startedAt: this.startedAt,
			capturedAt: this.clock(),
			metrics,
			events: events.map((event) => ({
				...event,
				...(event.data ? { data: { ...event.data } } : {}),
			})),
		};
	}
}
