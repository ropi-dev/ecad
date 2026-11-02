export const MM_PER_MIL = 0.0254;
export const fromMils = (mils: number) =>
	Number((mils * MM_PER_MIL).toPrecision(15));
export const toMils = (millimeters: number) =>
	Number((millimeters / MM_PER_MIL).toFixed(4));
export const SCHEMATIC_STEP = fromMils(50);
export const DEFAULT_PIN_LENGTH = fromMils(100);
export const DEFAULT_TEXT_SIZE = fromMils(100);
export const SYMBOL_TEXT_SIZE = DEFAULT_TEXT_SIZE;
export const PIN_NAME_SIZE = fromMils(75);
export const PIN_LABEL_GAP = fromMils(20);
export const PIN_NUMBER_GAP = fromMils(10);
export const PIN_NUMBER_SIZE = fromMils(50);
export const DEFAULT_STROKE_WIDTH = fromMils(5);
export const CONNECTION_RADIUS = fromMils(10);
export const formatMils = (millimeters: number) => `${toMils(millimeters)} mil`;
export const formatInches = (millimeters: number) =>
	`${Number((millimeters / 25.4).toFixed(3))}`;
