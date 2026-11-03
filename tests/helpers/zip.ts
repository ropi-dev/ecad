import { strFromU8 } from "fflate";

/** Rewrites a ZIP entry's central-directory and local headers in place. */
export function patchZipEntry(
	archive: Uint8Array,
	name: string,
	patch: { originalSize?: number; compression?: number; corrupt?: boolean },
) {
	const view = new DataView(archive.buffer, archive.byteOffset);
	for (let entry = 0; entry + 46 <= archive.length; entry++) {
		if (view.getUint32(entry, true) !== 0x02014b50) continue;
		const nameLength = view.getUint16(entry + 28, true);
		if (strFromU8(archive.subarray(entry + 46, entry + 46 + nameLength)) !== name)
			continue;
		const local = view.getUint32(entry + 42, true);
		if (patch.compression !== undefined) {
			view.setUint16(entry + 10, patch.compression, true);
			view.setUint16(local + 8, patch.compression, true);
		}
		if (patch.originalSize !== undefined) {
			view.setUint32(entry + 24, patch.originalSize, true);
			view.setUint32(local + 22, patch.originalSize, true);
		}
		if (patch.corrupt) {
			const data =
				local +
				30 +
				view.getUint16(local + 26, true) +
				view.getUint16(local + 28, true);
			// 0xff starts a deflate block of the reserved type 3, so inflating it throws.
			archive.fill(0xff, data, data + view.getUint32(entry + 20, true));
		}
		return archive;
	}
	throw new Error(`Missing ZIP entry ${name}`);
}
