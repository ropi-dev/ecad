import type { Quaternion } from "three";

export interface AxisIndicatorHandle {
	update: (rotation: Quaternion) => void;
}
