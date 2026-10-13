/** @type {import('dependency-cruiser').IConfiguration} */
const NO_PACKAGES = "^(packages|apps)/";

module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Sem ciclos.",
      from: {},
      to: { circular: true },
    },
    {
      name: "model-imports-nothing",
      severity: "error",
      comment: "model não importa nenhum pacote do workspace.",
      from: { path: "^packages/model/" },
      to: { path: ["^packages/(?!model/)", "^apps/", "@code2n8n/(?!model)"] },
    },
    {
      name: "extract-python-only-model",
      severity: "error",
      comment:
        "extract-python importa só model (CORE-05: não alcança o explain).",
      from: { path: "^packages/extract-python/" },
      to: {
        path: [
          "^packages/(?!extract-python/|model/)",
          "^apps/",
          "@code2n8n/(?!model|extract-python)",
        ],
      },
    },
    {
      name: "input-only-model",
      severity: "error",
      comment:
        "input importa só model (leitura de pasta, sem extract-* nem explain).",
      from: { path: "^packages/input/" },
      to: {
        path: [
          "^packages/(?!input/|model/)",
          "^apps/",
          "@code2n8n/(?!model|input)",
        ],
      },
    },
    {
      name: "explain-only-model",
      severity: "error",
      comment: "explain importa só model.",
      from: { path: "^packages/explain/" },
      to: {
        path: [
          "^packages/(?!explain/|model/)",
          "^apps/",
          "@code2n8n/(?!model|explain)",
        ],
      },
    },
    {
      name: "server-only-core-packages",
      severity: "error",
      comment: "server importa model, extract-python, explain e input.",
      from: { path: "^packages/server/" },
      to: { path: ["^apps/"] },
    },
    {
      name: "web-only-model",
      severity: "error",
      comment: "apps/web importa só model.",
      from: { path: "^apps/web/" },
      to: { path: ["^packages/(?!model/)", "@code2n8n/(?!model)"] },
    },
    {
      name: "no-node-core-in-model-and-web",
      severity: "error",
      comment:
        "model e apps/web não usam módulos do Node (node:*, fs, path...).",
      from: { path: ["^packages/model/", "^apps/web/"] },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "no-relative-escape",
      severity: "error",
      comment:
        "Caminho relativo não sai da pasta do pacote (../../packages/...).",
      from: { path: "^(packages|apps)/([^/]+)/" },
      to: {
        dependencyTypes: ["local"],
        path: NO_PACKAGES,
        pathNot: "^$1/$2/",
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
  },
};
