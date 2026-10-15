import { Hono } from "hono";

const app = new Hono();

app.post("/api/aprovacao", (c) => c.json({ aprovado: true }));

app.get("/api/pedidos", (c) => c.json([]));
