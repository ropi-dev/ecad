/** Millimetres, Cartesian coordinates (+Y up). No file-format concepts belong here. */
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
export type Matrix = [number, number, number, number, number, number];
export type Attributes = Record<string, string[]>;
export type Geometry =
	| { type: "circle"; x: number; y: number; radius: number }
	| { type: "rect"; x: number; y: number; width: number; height: number }
	| { type: "path"; d: string; fill: boolean; strokeWidth?: number }
	| {
			type: "group";
			children: { geometry: Geometry; polarity: "dark" | "clear" }[];
	  };
export interface SceneObject {
	id: string;
	geometry: Geometry;
	bounds: Bounds;
	polarity: "dark" | "clear";
	transform?: Matrix;
	attributes: Attributes;
}
export interface SceneLayer {
	id: string;
	name: string;
	objects: SceneObject[];
	bounds: Bounds;
	color: string;
	visible: boolean;
	opacity: number;
	metadata: Attributes;
}
/** A planar scene object retains its vector primitives and compositing settings. */
export interface PlanarObject extends SceneLayer {
	type: "planar";
}
export interface Diagnostic {
	severity: "warning" | "error";
	message: string;
	line?: number;
}
export interface ParseResult {
	object: PlanarObject;
	diagnostics: Diagnostic[];
	format: string;
	units: "mm" | "in";
}
export interface FormatParser {
	id: string;
	extensions: readonly string[];
	detect(source: string, filename: string): boolean;
	parse(source: string, filename: string): ParseResult;
}
export interface Camera {
	x: number;
	y: number;
	scale: number;
}
