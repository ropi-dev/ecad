import assert from "node:assert/strict";
import test from "node:test";
import {
	architectures,
	assetChanges,
	channelTags,
	type PackageFile,
	packagesIndex,
	releaseFile,
	signingKey,
	sourcesFile,
} from "../scripts/release/apt.ts";

const release = (tagName: string, isDraft = false) => ({ tagName, isDraft });

function packageFile(name: string, sha256 = "a".repeat(64)): PackageFile {
	return {
		name,
		control: "Package: ecad\nVersion: 0.1.0\nArchitecture: amd64\n",
		size: 10,
		sha256,
	};
}

test("each channel keeps its newest releases and nightly adds the newest stable", () => {
	assert.deepEqual(
		channelTags([
			release("v0.1.0"),
			release("v0.1.1"),
			release("v0.1.10"),
			release("v0.1.9"),
			release("v0.1.11-nightly.20261114"),
			release("v0.1.11-nightly.20261115"),
			release("v0.1.11-nightly.20261116"),
			release("v0.1.10-nightly.20261101"),
			release("v0.1.12", true),
			release("desktop-20261116141352-9e626bf"),
			release("apt-stable"),
		]),
		{
			stable: ["v0.1.10", "v0.1.9", "v0.1.1"],
			nightly: [
				"v0.1.11-nightly.20261116",
				"v0.1.11-nightly.20261115",
				"v0.1.11-nightly.20261114",
				"v0.1.10",
			],
		},
	);
});

test("the packages index points at files next to it", () => {
	assert.equal(
		packagesIndex([packageFile("ecad_0.1.0_amd64.deb")]),
		`Package: ecad\nVersion: 0.1.0\nArchitecture: amd64\nFilename: ./ecad_0.1.0_amd64.deb\nSize: 10\nSHA256: ${"a".repeat(64)}\n`,
	);
	assert.equal(
		packagesIndex([packageFile("a.deb"), packageFile("b.deb")]).split(
			"\n\nPackage:",
		).length,
		2,
	);
});

test("the release file lists each index with its digest and size", () => {
	const text = releaseFile({
		channel: "nightly",
		date: new Date("2026-11-06T08:09:10Z"),
		architectures: ["amd64", "arm64"],
		indexes: [{ name: "Packages", content: Buffer.from("abc") }],
	});
	assert.match(text, /^Suite: nightly$/m);
	assert.match(text, /^Date: Fri, 06 Nov 2026 08:09:10 UTC$/m);
	assert.match(text, /^Architectures: amd64 arm64$/m);
	assert.match(
		text,
		/^SHA256:\n ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad 3 Packages\n$/m,
	);
});

test("architectures come from the packages", () => {
	assert.deepEqual(architectures([]), ["amd64"]);
	assert.deepEqual(
		architectures([
			{ ...packageFile("b.deb"), control: "Architecture: arm64\n" },
			packageFile("a.deb"),
		]),
		["amd64", "arm64"],
	);
});

test("uploads packages that are missing or changed and removes the rest", () => {
	const kept = "b".repeat(64);
	assert.deepEqual(
		assetChanges({
			existing: [
				{ name: "ecad_0.1.0_amd64.deb", digest: `sha256:${kept}` },
				{ name: "ecad_0.1.1-nightly.20261116_amd64.deb", digest: "sha256:old" },
				{ name: "ecad_0.1.1-nightly.20261101_amd64.deb", digest: null },
				{ name: "InRelease", digest: null },
			],
			packages: [
				packageFile("ecad_0.1.0_amd64.deb", kept),
				packageFile("ecad_0.1.1-nightly.20261116_amd64.deb"),
				packageFile("ecad_0.1.2-nightly.20261117_amd64.deb"),
			],
		}),
		{
			upload: [
				"ecad_0.1.1-nightly.20261116_amd64.deb",
				"ecad_0.1.2-nightly.20261117_amd64.deb",
			],
			remove: ["ecad_0.1.1-nightly.20261101_amd64.deb"],
		},
	);
});

test("the sources file names the channel's release as a flat repository", () => {
	assert.equal(
		sourcesFile("stable"),
		"Types: deb\nURIs: https://github.com/ropi-dev/ecad/releases/download/apt-stable/\nSuites: ./\nSigned-By: /usr/share/keyrings/ecad-archive-keyring.gpg\n",
	);
});

const secretKey = (fingerprint: string) =>
	`sec:u:255:22:${fingerprint.slice(-16)}:1763300000:::u:::scESC:::+:::ed25519:::0:\nfpr:::::::::${fingerprint}:\ngrp:::::::::ABCD:\nuid:u::::1763300000::HASH::ECAD apt repository::::::::::0:\n`;

test("signs with the keyring's only secret key", () => {
	const fingerprint = "F39E7F460B2611233681DEFFC723FF591786C814";
	assert.equal(signingKey(secretKey(fingerprint)), fingerprint);
	assert.equal(
		signingKey(
			`${secretKey(fingerprint)}ssb:u:255:22:AAAA:1763300000::::::s:::+:::ed25519::\nfpr:::::::::${"B".repeat(40)}:\n`,
		),
		fingerprint,
	);
});

test("refuses a keyring without exactly one secret key", () => {
	assert.throws(() => signingKey(""));
	assert.throws(
		() => signingKey(secretKey("A".repeat(40)) + secretKey("B".repeat(40))),
		/--key/,
	);
});
