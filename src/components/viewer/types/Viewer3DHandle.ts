export interface Viewer3DHandle {
	fit: () => void;
	zoom: (factor: number) => void;
	view: (direction: "iso" | "top" | "front") => void;
}
