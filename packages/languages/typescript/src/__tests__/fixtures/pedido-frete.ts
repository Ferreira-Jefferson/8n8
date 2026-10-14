import axios from "axios";

/** Calcula o frete de um item. */
export function calcularFrete(peso: number, distancia: number): number {
  axios.get("https://api.exemplo.com/tabela-frete");
  const base = 10;
  const taxa = distancia * 0.5;
  if (peso > 30) {
    return base + taxa * 2;
  } else {
    return base + taxa;
  }
}

export function processarPedido(itens: { peso: number; distancia: number }[]) {
  let total = 0;
  for (const item of itens) {
    total = total + calcularFrete(item.peso, item.distancia);
  }
  return total;
}
