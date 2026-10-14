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
  /** Fios `imports` entre arquivos da mesma linguagem. */
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
}
