declare module "occt-import-js" {
	export default function createImporter(): Promise<{
		ReadStepFile(
			buffer: Uint8Array,
			params: { linearUnit: "millimeter" },
		): { success: boolean; meshes: unknown[] };
	}>;
}
