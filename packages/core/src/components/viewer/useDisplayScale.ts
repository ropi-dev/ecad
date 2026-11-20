import { type Accessor, createEffect, createSignal } from "solid-js";
import { cssPixelsPerMm } from "#/components/viewer/displayScale.ts";
import { measurePerformanceAsync } from "#/performance/runtime.ts";

export function useDisplayScale(
	enabled: Accessor<boolean>,
): Accessor<number | null> {
	const [scale, setScale] = createSignal<number | null>(null);
	createEffect(enabled, (on) => {
		const bridge = on ? window.ecadDisplay : undefined;
		if (!bridge) {
			setScale(null);
			return;
		}
		let disposed = false;
		let request = 0;
		let resolution: MediaQueryList | undefined;
		let pixelRatio = window.devicePixelRatio;
		const update = async () => {
			const current = ++request;
			try {
				const calibration = await measurePerformanceAsync(
					"display.calibration",
					() => bridge.getCalibration(),
				);
				if (!disposed && current === request)
					setScale(cssPixelsPerMm(calibration, window.devicePixelRatio));
			} catch {
				if (!disposed && current === request) setScale(null);
			}
		};
		const watchResolution = () => {
			pixelRatio = window.devicePixelRatio;
			resolution?.removeEventListener("change", watchResolution);
			resolution = window.matchMedia(
				`(resolution: ${window.devicePixelRatio}dppx)`,
			);
			resolution.addEventListener("change", watchResolution);
			void update();
		};
		const onResize = () => {
			if (pixelRatio !== window.devicePixelRatio) watchResolution();
		};
		window.addEventListener("resize", onResize);
		const unsubscribe = bridge.onChanged(() => void update());
		watchResolution();
		return () => {
			disposed = true;
			window.removeEventListener("resize", onResize);
			unsubscribe();
			resolution?.removeEventListener("change", watchResolution);
		};
	});
	return scale;
}
