/** Drawing coordinates use millimetres with positive Y pointing up. */
export interface Point {
	x: number;
	y: number;
}

export interface Bounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}
