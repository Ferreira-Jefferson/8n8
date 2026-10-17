import type { ProjectData } from "@8n8/model";
import {
  createProjectStore,
  type ProjectRead,
  type ProjectStore,
} from "../project-store";
import { compactProject } from "./reference-compact";

/** The store a build of this whole graph would give, packed the way the server packs it. */
export function storeOf(response: ProjectData): ProjectStore {
  return createProjectStore(
    compactProject({
      name: response.name,
      files: response.files,
      ignored: response.ignored,
      version: response.version ?? "",
      graph: response.graph,
    }),
  );
}

/** A successful read of a folder whose whole graph is given. */
export function readOf(root: string, response: ProjectData): ProjectRead {
  return { kind: "ok", root, project: storeOf(response) };
}
