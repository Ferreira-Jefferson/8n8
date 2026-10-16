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
      to: { path: ["^packages/(?!model/)", "^apps/", "@8n8/(?!model)"] },
    },
    {
      name: "languages-only-model",
      severity: "error",
      comment:
        "Um plugin de linguagem importa só model, a suíte de conformidade lang-testkit e o auxiliar lang-treesitter (CORE-05: não alcança o explain).",
      from: { path: "^packages/languages/" },
      to: {
        path: [
          "^packages/(?!languages/|model/)",
          "^apps/",
          "@8n8/(?!model|lang-testkit|lang-treesitter)",
        ],
      },
    },
    {
      name: "languages-do-not-import-each-other",
      severity: "error",
      comment:
        "Um plugin de linguagem não importa outro plugin; só a suíte lang-testkit e o auxiliar lang-treesitter são comuns.",
      from: { path: "^packages/languages/([^/]+)/" },
      to: {
        path: "^packages/languages/",
        pathNot: [
          "^packages/languages/$1/",
          "^packages/languages/testkit/",
          "^packages/languages/treesitter/",
        ],
      },
    },
    {
      name: "project-only-model",
      severity: "error",
      comment:
        "project importa só model (monta o grafo dos plugins que recebe, sem conhecer nenhum).",
      from: { path: "^packages/project/" },
      to: {
        path: [
          "^packages/(?!project/|model/)",
          "^apps/",
          "@8n8/(?!model|project)",
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
        path: ["^packages/(?!input/|model/)", "^apps/", "@8n8/(?!model|input)"],
      },
    },
    {
      name: "links-only-model",
      severity: "error",
      comment:
        "links importa só model (casa ofertas e pedidos sem conhecer linguagem).",
      from: { path: "^packages/links/" },
      to: {
        path: ["^packages/(?!links/|model/)", "^apps/", "@8n8/(?!model|links)"],
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
          "@8n8/(?!model|explain)",
        ],
      },
    },
    {
      name: "llm-only-model",
      severity: "error",
      comment: "llm importa só model (provedores e perfis de modelo).",
      from: { path: "^packages/llm/" },
      to: {
        path: ["^packages/(?!llm/|model/)", "^apps/", "@8n8/(?!model|llm)"],
      },
    },
    {
      name: "explain-not-llm",
      severity: "error",
      comment:
        "explain não importa llm: o pipeline só conhece o contrato LlmClient do model.",
      from: { path: "^packages/explain/" },
      to: { path: ["^packages/llm/", "@8n8/llm"] },
    },
    {
      name: "server-only-core-packages",
      severity: "error",
      comment:
        "server importa model, plugins de linguagem, project, explain, input, links e llm.",
      from: { path: "^packages/server/" },
      to: { path: ["^apps/"] },
    },
    {
      name: "cli-only-server",
      severity: "error",
      comment:
        "apps/cli importa só o núcleo (server); quem monta as peças é o núcleo (AD-022).",
      from: { path: "^apps/cli/" },
      to: {
        path: ["^packages/(?!server/)", "^apps/(?!cli/)", "@8n8/(?!server)"],
      },
    },
    {
      name: "no-child-process",
      severity: "error",
      comment:
        "Só apps/cli/src/open-browser.ts, packages/llm/src/claude-code.ts e packages/server/src/pick-path.ts (o seletor de arquivo e pasta do sistema) iniciam processos (DIST-23, CC-09). O teste das guardas também, para rodar o check de verdade, e o teste de processos do provedor, para matar um 8n8 de verdade e ver o que sobra (CC-19). Uma exceção nova entra nesta regra, com revisão do CODEOWNERS.",
      from: {
        pathNot: [
          "^apps/cli/src/open-browser\\.ts$",
          "^packages/llm/src/claude-code\\.ts$",
          "^packages/server/src/pick-path\\.ts$",
          "^apps/cli/src/__tests__/guards\\.test\\.ts$",
          "^packages/llm/src/__tests__/processes\\.test\\.ts$",
        ],
      },
      // cluster starts another Node process too (SEC-08).
      to: {
        dependencyTypes: ["core"],
        path: "^(node:)?(child_process|cluster)$",
      },
    },
    {
      name: "only-vscode-host-imports-vscode",
      severity: "error",
      comment:
        "Só a embalagem apps/editors/vscode importa o módulo vscode; o núcleo e a tela não conhecem o editor (AD-022, VSC-13).",
      from: { pathNot: "^apps/editors/vscode/" },
      to: { path: "^vscode$" },
    },
    {
      name: "vscode-opens-no-port",
      severity: "error",
      comment:
        "A extensão chama o núcleo por app.fetch e nunca abre porta (VSC-09).",
      from: { path: "^apps/editors/vscode/" },
      to: { path: ["@hono[/+]node-server", "^(node:)?(http|https|net)$"] },
    },
    {
      name: "hosts-do-not-import-each-other",
      severity: "error",
      comment:
        "Uma embalagem em apps/ (cli, ui, vscode...) não importa outra (AD-022).",
      from: { path: "^apps/(editors/[^/]+|[^/]+)/" },
      to: { path: "^apps/", pathNot: "^apps/$1/" },
    },
    {
      name: "ui-only-model",
      severity: "error",
      comment: "apps/ui importa só model.",
      from: { path: "^apps/ui/" },
      to: { path: ["^packages/(?!model/)", "@8n8/(?!model)"] },
    },
    {
      name: "no-node-core-in-model-and-ui",
      severity: "error",
      comment:
        "model e apps/ui não usam módulos do Node (node:*, fs, path...).",
      from: { path: ["^packages/model/", "^apps/ui/"] },
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
    // Test fixtures are input code (code to analyse),
    // dist/ is build output and .vscode-test/ the VS Code the extension test downloads:
    // none of them is code of 8n8.
    exclude: {
      path: "(__tests__/fixtures/|/dist/|^apps/editors/vscode/\\.vscode-test/)",
    },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
  },
};
