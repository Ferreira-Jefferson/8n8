import { readFileSync } from "node:fs";
import type { SourceFile } from "@code2n8n/model";

/** The `.py` files of the `projeto-loja` fixture, in code order. */
export const LOJA_PATHS = [
  "frete/__init__.py",
  "frete/calculo.py",
  "legado/frete_antigo.py",
  "main.py",
  "pedidos/__init__.py",
  "pedidos/itens.py",
  "pedidos/pedidos.py",
  "relatorio.py",
];

export function lojaFiles(): SourceFile[] {
  return LOJA_PATHS.map((path) => ({
    path,
    source: readFileSync(
      new URL(`./fixtures/projeto-loja/${path}`, import.meta.url),
      "utf8",
    ),
  }));
}
