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
      name: "languages-only-model",
      severity: "error",
      comment:
        "Um plugin de linguagem importa só model (CORE-05: não alcança o explain).",
      from: { path: "^packages/languages/" },
      to: {
        path: [
          "^packages/(?!languages/|model/)",
          "^apps/",
          "@code2n8n/(?!model|lang-)",
        ],
      },
    },
    {
      name: "languages-do-not-import-each-other",
      severity: "error",
      comment: "Um plugin de linguagem não importa outro plugin.",
      from: { path: "^packages/languages/([^/]+)/" },
      to: {
        path: "^packages/languages/",
        pathNot: "^packages/languages/$1/",
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
      name: "links-only-model",
      severity: "error",
      comment:
        "links importa só model (casa ofertas e pedidos sem conhecer linguagem).",
      from: { path: "^packages/links/" },
      to: {
        path: [
          "^packages/(?!links/|model/)",
          "^apps/",
          "@code2n8n/(?!model|links)",
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
      name: "llm-only-model",
      severity: "error",
      comment: "llm importa só model (provedores e perfis de modelo).",
      from: { path: "^packages/llm/" },
      to: {
        path: [
          "^packages/(?!llm/|model/)",
          "^apps/",
          "@code2n8n/(?!model|llm)",
        ],
      },
    },
    {
      name: "explain-not-llm",
      severity: "error",
      comment:
        "explain não importa llm: o pipeline só conhece o contrato LlmClient do model.",
      from: { path: "^packages/explain/" },
      to: { path: ["^packages/llm/", "@code2n8n/llm"] },
    },
    {
      name: "server-only-core-packages",
      severity: "error",
      comment: "server importa model, languages, explain, input, links e llm.",
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
