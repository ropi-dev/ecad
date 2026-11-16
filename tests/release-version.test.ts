import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { nextRelease, nightlyDate } from "../scripts/release/version.ts";

const date = "20261116";

test("the first stable release is 0.1.0", () => {
	assert.deepEqual(
		nextRelease({ channel: "stable", tags: ["desktop-20261116-abc"], date }),
		{
			version: "0.1.0",
			tag: "v0.1.0",
			debianVersion: "0.1.0",
			prerelease: false,
			previousTag: null,
			replaces: false,
		},
	);
});

test("a stable release without a version raises the patch version", () => {
	const release = nextRelease({
		channel: "stable",
		tags: ["v0.1.0", "v0.1.1", "v0.1.10", "v0.1.2-nightly.20261115", "v0.1.9"],
		date,
	});
	assert.equal(release.version, "0.1.11");
	assert.equal(release.previousTag, "v0.1.10");
});

test("a nightly adds the date to the next patch version", () => {
	assert.deepEqual(nextRelease({ channel: "nightly", tags: [], date }), {
		version: "0.1.0-nightly.20261116",
		tag: "v0.1.0-nightly.20261116",
		debianVersion: "0.1.0~nightly.20261116",
		prerelease: true,
		previousTag: null,
		replaces: false,
	});
	const release = nextRelease({
		channel: "nightly",
		tags: ["v0.1.0", "v0.1.1-nightly.20261114", "v0.1.1-nightly.20261115"],
		date,
	});
	assert.equal(release.version, "0.1.1-nightly.20261116");
	assert.equal(release.previousTag, "v0.1.1-nightly.20261115");
});

test("a nightly on the same day replaces the earlier one", () => {
	const release = nextRelease({
		channel: "nightly",
		tags: ["v0.1.0", "v0.1.1-nightly.20261116"],
		date,
	});
	assert.equal(release.replaces, true);
	assert.equal(release.previousTag, "v0.1.0");
});

test("a requested version must be newer than the latest stable release", () => {
	const tags = ["v0.1.0", "v0.2.0"];
	assert.equal(
		nextRelease({ channel: "stable", requested: "v1.0.0", tags, date }).version,
		"1.0.0",
	);
	assert.equal(
		nextRelease({ channel: "nightly", requested: "0.3.0", tags, date }).version,
		"0.3.0-nightly.20261116",
	);
	assert.throws(
		() => nextRelease({ channel: "stable", requested: "0.2.0", tags, date }),
		/not newer than the latest stable release, 0\.2\.0/,
	);
	assert.throws(
		() => nextRelease({ channel: "nightly", requested: "0.1.5", tags, date }),
		/not newer/,
	);
	for (const requested of ["1.0", "01.0.0", "1.0.0-rc.1", "latest"])
		assert.throws(
			() => nextRelease({ channel: "stable", requested, tags, date }),
			/not a version/,
		);
});

test("nightly dates use UTC", () => {
	assert.equal(nightlyDate(new Date("2026-11-16T23:30:00-02:00")), "20261117");
});

test("Debian sorts nightlies between the stable releases around them", (context) => {
	if (spawnSync("dpkg", ["--version"]).status !== 0) {
		context.skip("dpkg is not installed");
		return;
	}
	const order = [
		"0.0.0+git20261116130936.b65cb09",
		"0.1.0~nightly.20261115",
		"0.1.0~nightly.20261116",
		"0.1.0",
		"0.1.1~nightly.20261117",
		"0.1.1",
	];
	for (let i = 1; i < order.length; i++)
		assert.equal(
			spawnSync("dpkg", ["--compare-versions", order[i], "gt", order[i - 1]])
				.status,
			0,
			`${order[i]} > ${order[i - 1]}`,
		);
});
