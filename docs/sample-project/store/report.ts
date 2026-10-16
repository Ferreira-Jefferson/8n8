export async function loadOrders(): Promise<object[]> {
  const response = await fetch("http://localhost:3000/api/orders");
  return response.json();
}
