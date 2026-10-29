import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generateDefaultSymbols } from "../src/index.ts";

const args = process.argv.slice(2);
if (args.length > 1) throw new Error("Usage: pnpm run generate [output-directory]");
const output = resolve(args[0] ?? "generated");
await mkdir(output, { recursive: true });
const symbols = generateDefaultSymbols();
// Exclusive writes protect user-edited files and make collisions visible.
for (const { file } of symbols) {
	await writeFile(resolve(output, `${file.id}.ecadsym`), `${JSON.stringify(file, null, 2)}\n`, { flag: "wx" });
}
for (const filename of ["LICENSE.md", "NOTICE.md", "CC-BY-SA-4.0.txt"]) {
	await writeFile(resolve(output, filename), await readFile(new URL(`../${filename}`, import.meta.url)), { flag: "wx" });
}
console.log(`Generated ${symbols.length} symbols in ${output}`);
