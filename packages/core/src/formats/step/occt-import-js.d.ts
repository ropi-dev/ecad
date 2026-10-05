declare module "occt-import-js" {
	export default function createImporter(options?: {
		locateFile?: (path: string) => string;
	}): Promise<{
		ReadStepFile(
			buffer: Uint8Array,
			params: { linearUnit: "millimeter" },
		): {
			success: boolean;
			meshes: Omit<
				import("./types/StepModel").StepModel["meshes"][number],
				"id"
			>[];
		};
	}>;
}
