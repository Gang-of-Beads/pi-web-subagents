/**
 * The package is also the pi extension: one install has to satisfy both hosts.
 *
 * pi loads the file `pi.extensions` names and reads the agents, skills and prompts from this package,
 * so a declared path that does not ship is a silent feature loss rather than a load error.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
	pi?: { extensions?: string[]; agents?: string[]; skills?: string[]; prompts?: string[] };
	piWeb?: { plugins?: { id: string; browserRoot: string; module: string; serverModule: string }[] };
	dependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
};

describe("one package, both hosts", () => {
	it("declares a pi extension that hands off to the published runtime", () => {
		expect(manifest.pi?.extensions).toEqual(["./extension.ts"]);
		const entry = readFileSync(join(root, "extension.ts"), "utf8");
		expect(entry).toContain('from "@gang-of-beads/pi-subagents"');
	});

	it("pins the runtime as a runtime dependency, not a peer", () => {
		// A vendored tarball today, its version implied by the file name until npm serves it.
		expect(manifest.dependencies?.["@gang-of-beads/pi-subagents"]).toMatch(/^(\^\d+\.\d+\.\d+|file:vendor\/[^/]+-\d+\.\d+\.\d+\.tgz|github:[^#]+#v\d+\.\d+\.\d+)$/);
		expect(manifest.peerDependencies?.["@gang-of-beads/pi-subagents"]).toBeUndefined();
	});

	it("forwards the host packages the runtime imports as peers", () => {
		for (const name of ["@earendil-works/pi-agent-core", "@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui", "typebox"]) {
			expect(manifest.peerDependencies?.[name]).toBeDefined();
			expect(manifest.dependencies?.[name]).toBeUndefined();
		}
	});

	it("ships every path it declares, so nothing is dropped from the tarball", () => {
		for (const key of ["extensions", "agents", "skills", "prompts"] as const) {
			for (const declared of manifest.pi?.[key] ?? []) expect(existsSync(join(root, declared))).toBe(true);
		}
		expect(manifest.pi?.agents).toEqual(["./agents"]);
		expect(manifest.pi?.skills).toEqual(["./skills"]);
		expect(manifest.pi?.prompts).toEqual(["./prompts"]);
	});

	it("keeps the plugin half declared alongside the extension", () => {
		const plugin = manifest.piWeb?.plugins?.[0];
		expect(plugin?.id).toBe("subagents");
		expect(existsSync(join(root, plugin!.module))).toBe(true);
		expect(existsSync(join(root, plugin!.serverModule))).toBe(true);
	});
});

describe("the copied assets match the pinned runtime", () => {
	it("has at least one agent, skill and prompt", () => {
		for (const tree of ["agents", "skills", "prompts"]) expect(readdirSync(join(root, tree)).length).toBeGreaterThan(0);
	});
});
