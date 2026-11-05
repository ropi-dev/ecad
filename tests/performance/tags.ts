/**
 * Areas a performance scenario measures. Every test in this directory needs at
 * least one of these tags; `scripts/performance/select.ts` maps changed paths
 * to them so `pnpm run perf` runs only the affected scenarios.
 */
export const areas = {
	"@core": "Cheap, broad scenarios that run on every selection.",
	"@startup": "Loading the app without a project.",
	"@projects": "Project storage, the project list and the files sidebar.",
	"@editor": "The 2D schematic and drawing editor.",
	"@symbols": "Symbol libraries, the picker and symbol definitions.",
	"@circuit": "The circuit graph, ERC and linked schematic synchronization.",
	"@import": "Gerber, STEP and KiCad imports.",
	"@storage": "Desktop native project and library storage.",
	"@cli": "The command-line interface and its stdio MCP server.",
} as const;

export type Area = keyof typeof areas;

export const isArea = (tag: string): tag is Area => Object.hasOwn(areas, tag);
