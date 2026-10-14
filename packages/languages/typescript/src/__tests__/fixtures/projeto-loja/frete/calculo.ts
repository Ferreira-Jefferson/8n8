export function calcularFrete(peso: number, distancia: number): number {
  return peso * 0.5 + distancia;
}

export default function tabela(total: number) {
  return total > 100 ? 0 : 10;
}
