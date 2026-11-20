import { readFileSync } from "node:fs";

process.stdout.write(JSON.stringify(JSON.parse(readFileSync(0, "utf8"))));
