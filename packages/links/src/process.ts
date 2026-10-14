import type { Linker } from "./types";

/** `\` to `/`, drops `.` segments and resolves `..`. Returns undefined when it escapes the root. */
function normalize(path: string): string | undefined {
  const out: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.pop() === undefined) return undefined;
    } else out.push(part);
  }
  return out.join("/");
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/** Every path a command may mean: each word, from the project root and from the requesting file. */
function candidatePaths(command: string, fromDir: string): Set<string> {
  const paths = new Set<string>();
  for (const word of command.split(/[\s"'`,[\]()]+/)) {
    if (word === "") continue;
    const fromRoot = normalize(word);
    const fromFile = normalize(`${fromDir}/${word}`);
    if (fromRoot) paths.add(fromRoot);
    if (fromFile) paths.add(fromFile);
  }
  return paths;
}

export const processLinker: Linker = {
  channel: "process",
  sameLanguage: false,
  matches(request, offer, ctx) {
    const target = normalize(offer.key);
    if (!target) return false;
    const fromDir = dirOf(ctx.fileOf(request.nodeId)?.path ?? "");
    return candidatePaths(request.key, fromDir).has(target);
  },
  label: () => "processo",
};
