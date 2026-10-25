export const lineStyles = [
	"solid",
	"dashed",
	"dotted",
	"dash-dot",
	"dash-dot-dot",
] as const;

export type LineStyle = (typeof lineStyles)[number];

export const lineStyleLabels: Record<LineStyle, string> = {
	solid: "Solid",
	dashed: "Dashed",
	dotted: "Dotted",
	"dash-dot": "Dash-dot",
	"dash-dot-dot": "Dash-dot-dot",
};
