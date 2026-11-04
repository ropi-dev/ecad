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
				import("#/formats/step/types/StepModel.ts").StepModel["meshes"][number],
				"id"
			>[];
		};
	}>;
}
