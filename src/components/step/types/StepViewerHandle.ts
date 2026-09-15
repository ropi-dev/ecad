export interface StepViewerHandle {
	fit: () => void;
	zoom: (factor: number) => void;
	view: (direction: "iso" | "top" | "front") => void;
}
