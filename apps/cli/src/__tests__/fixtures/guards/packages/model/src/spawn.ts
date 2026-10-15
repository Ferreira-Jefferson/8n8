// Fixture of guards.test.ts: a package that may not start processes (DIST-23).
import { spawn } from "node:child_process";

export const start = spawn;
