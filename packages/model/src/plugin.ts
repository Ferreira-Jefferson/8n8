import type { FlowEdge, Graph, NodeId } from "./graph";
import type { SourceFile } from "./project";

/**
 * Canal por onde um arquivo de uma linguagem alcança outro, de outra linguagem.
 * - `http`: rota. `key` é `METHOD /caminho` (`*` quando o método não é conhecido).
 * - `process`: processo ou caminho de arquivo. `key` é o texto do caminho, como está no código.
 * - `name`: nome de função. `key` é o nome chamado.
 */
export type LinkChannel = "http" | "process" | "name";

/** O que um arquivo expõe: uma rota, o próprio caminho, uma função. */
export interface Offer {
  channel: LinkChannel;
  key: string;
  nodeId: NodeId;
  line: number;
}

/** O que um arquivo procura: uma URL chamada, um caminho executado, um nome chamado. */
export interface LinkRequest {
  channel: LinkChannel;
  key: string;
  nodeId: NodeId;
  line: number;
}

/** O que um plugin entende de um conjunto de arquivos da sua linguagem. */
export interface LanguageAnalysis {
  /** Um grafo por arquivo. O primeiro nó é o nó `file`, e os nós internos usam o id dele como prefixo. */
  files: { path: string; graph: Graph }[];
  /** Arestas `imports` entre arquivos da mesma linguagem. */
  imports: FlowEdge[];
  offers: Offer[];
  requests: LinkRequest[];
}

/**
 * Uma linguagem. Tudo que é da linguagem (parser, palavras reservadas, forma do import)
 * mora no plugin; o core monta o grafo, as ligações, o servidor e a tela sem conhecê-la.
 * Determinístico: o mesmo texto gera o mesmo resultado, sem LLM (AD-001).
 */
export interface LanguagePlugin {
  /** Estável: vai no `Graph.language` e nas chaves de cache. Ex.: `python`. */
  id: string;
  /** Nome para a tela. Ex.: `Python`. */
  label: string;
  /** Com o ponto, minúsculas. Ex.: `[".py"]`. */
  extensions: string[];
  /** Pastas que só existem nesta linguagem e que a leitura da pasta pula. Ex.: `.venv`. */
  ignoredDirs: string[];
  /** Começo de um comentário de linha. Ex.: `#`, `//`. */
  commentPrefix: string;
  /** Nota de 0 a 1: quanto o texto parece ser desta linguagem. Serve ao trecho colado, que não tem extensão. */
  detect(source: string): number;
  /** Grafo de um trecho. */
  extract(source: string): Graph;
  /** Entende um conjunto de arquivos desta linguagem. Os caminhos são POSIX, relativos à raiz do projeto. */
  analyze(files: SourceFile[]): LanguageAnalysis;
  /**
   * Optional. Lets the core split `analyze` among worker threads, and keep the result of each
   * file between runs. `files` is a slice of the project's files of this language, sorted by path:
   * contiguous, or any subset (the core opens a slice only with the files that need work).
   * Opening slices that cover all the files and running both phases below must give the same
   * result as `analyze` of all the files together. A plugin without it always runs in one piece.
   */
  openSlice?(files: SourceFile[]): AnalysisSlice;
  /**
   * Optional, with `openSlice`. The version of what the plugin makes of a file: change it
   * whenever the same text can give another contribution or another graph. The core keeps results
   * on disk under it; a plugin without it is never cached.
   */
  cacheVersion?: string;
}

/**
 * What ONE file adds to the project-wide context (module index, top-level names). It depends only on the
 * path and the text of the file, never on other files. `data` is plain JSON (no `Map`, no `undefined`):
 * the core keeps it on disk and hashes its text, so the same file must always give the same text.
 */
export interface FileContribution {
  path: string;
  data: unknown;
}

/** A slice of the files of one language, with its parse trees kept until `dispose`. */
export interface AnalysisSlice {
  /** Phase 1: the contribution of each file of this slice, in the order of the files. */
  contribute(): FileContribution[];
  /**
   * Phase 2: the analysis of the files of this slice only, given the contributions of ALL the project's
   * files of this language, sorted by path. The `imports` wires of a file have its `file` node as `source`;
   * the offers and requests come grouped by file, in the order of the files.
   */
  analyze(contributions: FileContribution[]): LanguageAnalysis;
  /** Frees the parse trees. */
  dispose(): void;
}
