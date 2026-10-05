export const budgets = {
	"desktop-storage": {
		legacySaveMs: 2000,
		migrationMs: 3000,
		saveMs: 2000,
		importAssetsMs: 3000,
		loadMs: 2000,
	},
	"projects-empty": {
		startupMs: 5000,
		blockingMs: 1000,
		scriptBytes: 2_500_000,
		domNodes: 1000,
		eventLoopP95Ms: 300,
	},
	"projects-large": {
		startupMs: 5000,
		interactionP95Ms: 750,
		blockingMs: 2000,
		domNodes: 1000,
		eventLoopP95Ms: 500,
	},
	"editor-imports": {
		navigationP95Ms: 5000,
		importGerberMs: 10000,
		importStepMs: 30000,
		frameP95Ms: 500,
		eventLoopP95Ms: 1500,
	},
} as const;
export type Scenario = keyof typeof budgets;
export const regressionFloors: Record<string, number> = {
	startupMs: 100,
	interactionP95Ms: 50,
	navigationP95Ms: 100,
	importGerberMs: 100,
	importStepMs: 250,
	blockingMs: 100,
	frameP95Ms: 20,
	eventLoopP95Ms: 100,
	scriptBytes: 100_000,
	heapBytes: 5_000_000,
	domNodes: 50,
};
