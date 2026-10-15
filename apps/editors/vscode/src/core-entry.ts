// The core, bundled apart as ESM (dist/core.mjs): the language plugins await at
// the top level, which a CommonJS bundle cannot hold. extension.cjs imports it.
export { createCore } from "@8n8/server";
