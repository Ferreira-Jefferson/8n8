export async function carregarPedidos(): Promise<object[]> {
  const resposta = await fetch("http://localhost:3000/api/pedidos");
  return resposta.json();
}
