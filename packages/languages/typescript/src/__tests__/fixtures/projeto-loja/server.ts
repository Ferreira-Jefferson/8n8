import { exec } from "node:child_process";
import express from "express";
import { main } from "./main";

const app = express();

function handler(_req, res) {
  res.json(main());
}

app.get("/api/frete", handler);
app.post("/api/pedidos", (req, res) => {
  notificar(req.body);
  res.send("ok");
});

exec("python relatorio.py");
