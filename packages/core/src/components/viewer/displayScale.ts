export interface DisplayCalibration {
	pixelsPerMm: number;
}

export interface DisplayBridge {
	getCalibration(): Promise<DisplayCalibration | null>;
	onChanged(listener: () => void): () => void;
}

declare global {
	interface Window {
		ecadDisplay?: DisplayBridge;
	}
}

export function cssPixelsPerMm(
	calibration: DisplayCalibration | null,
	devicePixelRatio: number,
): number | null {
	if (
		!calibration ||
		!Number.isFinite(calibration.pixelsPerMm) ||
		calibration.pixelsPerMm <= 0 ||
		!Number.isFinite(devicePixelRatio) ||
		devicePixelRatio <= 0
	)
		return null;
	return calibration.pixelsPerMm / devicePixelRatio;
}
