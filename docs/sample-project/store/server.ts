import { Hono } from "hono";

const app = new Hono();

app.post("/api/approval", (c) => c.json({ approved: true }));

app.get("/api/orders", (c) => c.json([]));
