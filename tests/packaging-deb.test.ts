import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
	cliLauncher,
	controlFile,
	debianArchitecture,
	installDirectory,
	packageVersion,
} from "../scripts/packaging/deb.ts";

test("deb versions sort by commit time", () => {
	const earlier = packageVersion(
		"0.0.0",
		new Date("2026-11-06T09:05:07Z"),
		"fa42a8d",
	);
	assert.equal(earlier, "0.0.0+git20261106090507.fa42a8d");
	const later = packageVersion("0.0.0", new Date("2026-11-06T10:00:00Z"), "0");
	if (spawnSync("dpkg", ["--version"]).status === 0)
		assert.equal(
			spawnSync("dpkg", ["--compare-versions", later, "gt", earlier]).status,
			0,
		);
	else assert.ok(later > earlier);
});

test("deb architectures follow Electron's", () => {
	assert.equal(debianArchitecture("x64"), "amd64");
	assert.equal(debianArchitecture("arm64"), "arm64");
	assert.equal(debianArchitecture("armv7l"), "armhf");
	assert.throws(() => debianArchitecture("ia32"), /Unsupported architecture/);
});

test("deb control file declares the package and its libraries", () => {
	const control = controlFile({
		version: "1.2.3",
		architecture: "amd64",
		installedSize: 42,
		maintainer: "Someone <someone@example.com>",
	});
	assert.match(control, /^Package: ecad\nVersion: 1\.2\.3\n/);
	assert.match(control, /^Architecture: amd64$/m);
	assert.match(control, /^Installed-Size: 42$/m);
	assert.match(control, /^Depends: .*libgtk-3-0t64 \| libgtk-3-0.*libnss3/m);
	// Continuation lines start with a space; blank ones are " .".
	for (const line of control.trimEnd().split("\n"))
		assert.match(line, /^([A-Z][\w-]*: \S| \S)/);
	assert.ok(control.endsWith("\n"));
});

test("the ecad command runs the CLI on the app's bundled Node.js", () => {
	assert.ok(cliLauncher.startsWith("#!/bin/sh\n"));
	assert.ok(
		cliLauncher.includes(
			`ELECTRON_RUN_AS_NODE=1 exec ${installDirectory}/ecad-desktop ${installDirectory}/cli/ecad.js "$@"`,
		),
	);
});
