import subprocess

import requests
from flask import Flask

app = Flask(__name__)


@app.get("/frete")
def frete():
    resposta = requests.post("https://api.exemplo.com/pedidos?x=1", json={})
    subprocess.run(["node", "scripts/gerar.ts"])
    return resposta


@app.route("/itens/<id>", methods=["GET", "DELETE"])
def itens(id):
    return notificar(id)
