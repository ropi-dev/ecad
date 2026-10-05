export interface StepModel {
	name: string;
	meshes: {
		id: string;
		name: string;
		color?: [number, number, number];
		attributes: {
			position: { array: number[] };
			normal?: { array: number[] };
		};
		index: { array: number[] };
		brep_faces?: {
			first: number;
			last: number;
			color: [number, number, number] | null;
		}[];
	}[];
}
