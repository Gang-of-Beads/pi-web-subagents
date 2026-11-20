/**
 * Copy the agents, skills and prompts of the pinned `@gang-of-beads/pi-subagents` into this package.
 *
 * pi resolves those paths inside the package that declares them, and a dependency's files sit in
 * `node_modules` rather than in this tarball, so the three trees are copies. `--check` verifies they
 * match the dependency and exits non-zero, which is what `npm run check` and the release workflow run.
 */
import { existsSync } from "node:fs";
import { cp, readdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const check = process.argv.includes("--check");
const TREES = ["agents", "skills", "prompts"];

const require = createRequire(import.meta.url);
/** The package does not export `./package.json`, so resolve its entry and walk up to the package root. */
const dependencyRoot = (() => {
	let dir = dirname(require.resolve("@gang-of-beads/pi-subagents"));
	while (!existsSync(join(dir, "package.json"))) {
		const parent = dirname(dir);
		if (parent === dir) throw new Error("@gang-of-beads/pi-subagents package root not found");
		dir = parent;
	}
	return dir;
})();

async function files(dir, base = dir) {
	const out = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...(await files(path, base)));
		else if (entry.isFile()) out.push(relative(base, path));
	}
	return out.sort();
}

let stale = 0;
for (const tree of TREES) {
	const source = join(dependencyRoot, tree);
	const target = join(root, tree);
	if (check) {
		let existing;
		try {
			existing = await files(target);
		} catch {
			existing = [];
		}
		const expected = await files(source).catch(() => []);
		const same = existing.length === expected.length && existing.every((path) => expected.includes(path));
		const identical = same && (await Promise.all(expected.map(async (path) => (await readFile(join(source, path), "utf8")) === (await readFile(join(target, path), "utf8"))))).every(Boolean);
		if (!identical) {
			console.error(`${tree}/ is out of date with @gang-of-beads/pi-subagents; run npm run sync:assets`);
			stale += 1;
		}
		continue;
	}
	await rm(target, { recursive: true, force: true });
	await cp(source, target, { recursive: true });
	console.log(`synced ${tree}/ (${(await files(target)).length} files)`);
}
if (stale > 0) process.exitCode = 1;
