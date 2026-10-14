import { calcularFrete } from "../frete/calculo";

export interface Item {
  peso: number;
  distancia: number;
}

export function criarPedido(itens: Item[]) {
  let total = 0;
  for (const item of itens) {
    total += calcularFrete(item.peso, item.distancia);
  }
  fetch("/api/frete", { method: "POST" });
  return { total };
}
