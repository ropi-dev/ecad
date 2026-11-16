import { type Color, ModelMesh } from "./mesh.ts";

const moulding: Color = [0.1, 0.1, 0.1];
const marking: Color = [0.55, 0.55, 0.55];
const tin: Color = [0.82, 0.82, 0.8];
const gold: Color = [0.86, 0.74, 0.49];
const trimmerBody: Color = [0.16, 0.3, 0.68];
const trimmerScrew: Color = [0.93, 0.9, 0.8];
const insulator: Color = [0.12, 0.12, 0.12];

function qfn({
	size,
	pins,
	pitch,
	exposedPad,
	height = 0.9,
}: {
	size: number;
	pins: number;
	pitch: number;
	exposedPad: number;
	height?: number;
}) {
	const mesh = new ModelMesh();
	const half = size / 2;
	mesh.box(moulding, [-half, -half, 0.02], [half, half, height]);
	const perSide = pins / 4;
	const terminalWidth = pitch / 2;
	const terminalLength = 0.4;
	const overhang = 0.02;
	for (let index = 0; index < perSide; index++) {
		const along = ((perSide - 1) / 2 - index) * pitch;
		const w = terminalWidth / 2;
		mesh.box(
			tin,
			[-half - overhang, along - w, 0],
			[-half + terminalLength, along + w, 0.2],
		);
		mesh.box(
			tin,
			[half - terminalLength, -along - w, 0],
			[half + overhang, -along + w, 0.2],
		);
		mesh.box(
			tin,
			[-along - w, -half - overhang, 0],
			[-along + w, -half + terminalLength, 0.2],
		);
		mesh.box(
			tin,
			[along - w, half - terminalLength, 0],
			[along + w, half + overhang, 0.2],
		);
	}
	const pad = exposedPad / 2;
	mesh.box(tin, [-pad, -pad, 0], [pad, pad, 0.02]);
	mesh.cylinder(
		marking,
		[-half + 0.6, half - 0.6],
		0.25,
		height,
		height + 0.005,
	);
	return mesh;
}

function bournsTrimmer() {
	const mesh = new ModelMesh();
	mesh.box(trimmerBody, [-4.78, -2.225, 0.5], [4.75, 7.305, 4.83]);
	for (const [x0, y0] of [
		[-4.78, -2.225],
		[3.95, -2.225],
		[-4.78, 6.505],
		[3.95, 6.505],
	] as const)
		mesh.box(trimmerBody, [x0, y0, 0], [x0 + 0.8, y0 + 0.8, 0.5]);
	mesh.cylinder(trimmerScrew, [-0.89, 2.54], 1.575, 4.83, 5.1, 32);
	mesh.box(insulator, [-2.1, 2.39, 5.1], [0.32, 2.69, 5.11]);
	for (const [x, y] of [
		[0, 0],
		[2.54, 2.54],
		[0, 5.08],
	] as const)
		mesh.cylinder(tin, [x, y], 0.25, -3, 0.5, 12);
	return mesh;
}

function molexMicroB() {
	const mesh = new ModelMesh();
	const [left, right, front, back] = [-3.75, 3.75, -2.65, 2.6];
	const [bottom, top, wall] = [0, 2.6, 0.15];
	mesh.box(tin, [left, front, top - wall], [right, back, top]);
	mesh.box(tin, [left, front, bottom], [right, back, bottom + wall]);
	mesh.box(tin, [left, front, bottom], [left + wall, back, top]);
	mesh.box(tin, [right - wall, front, bottom], [right, back, top]);
	mesh.box(tin, [left, back - wall, bottom], [right, back, top]);
	mesh.box(
		insulator,
		[left + wall, 0.6, bottom + wall],
		[right - wall, back - wall, top - wall],
	);
	mesh.box(insulator, [-1.8, front + 0.45, 1.1], [1.8, 0.6, 1.6]);
	for (const x of [-1.3, -0.65, 0, 0.65, 1.3]) {
		mesh.box(gold, [x - 0.125, front + 0.6, 1.05], [x + 0.125, 0.6, 1.1]);
		mesh.box(gold, [x - 0.15, back, 0], [x + 0.15, 3.2, 0.1]);
	}
	for (const [x, y] of [
		[-2.5, 2.475],
		[2.5, 2.475],
		[-3.5, -0.225],
		[3.5, -0.225],
	] as const)
		mesh.box(tin, [x - 0.25, y - 0.15, -0.8], [x + 0.25, y + 0.15, 0]);
	return mesh;
}

export const ecadModels: Readonly<Record<string, () => ModelMesh>> = {
	potentiometer_bourns_3386p_vertical: bournsTrimmer,
	"qfn-48-1ep_6x6mm_p0.4mm_ep4.6x4.6mm": () =>
		qfn({ size: 6, pins: 48, pitch: 0.4, exposedPad: 4.6 }),
	"qfn-60-1ep_7x7mm_p0.4mm_ep3.4x3.4mm": () =>
		qfn({ size: 7, pins: 60, pitch: 0.4, exposedPad: 3.4 }),
	"qfn-80-1ep_10x10mm_p0.4mm_ep3.4x3.4mm": () =>
		qfn({ size: 10, pins: 80, pitch: 0.4, exposedPad: 3.4 }),
	"usb_micro-b_molex-105017-0001": molexMicroB,
};
