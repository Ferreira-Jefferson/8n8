import tabela from "./frete/calculo";
import * as frete from "./frete/calculo.js";
import { criarPedido, somar } from "./pedidos";

export function main() {
  const pedido = criarPedido([{ peso: 10, distancia: 5 }]);
  const total = somar(pedido);
  frete.calcularFrete(1, 2);
  return tabela(total);
}
