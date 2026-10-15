import requests

from estoque import reservar_itens
from servicos.email import enviar_email
from servicos.frete import calcular_frete


def processar_pedido(pedido):
    validar_pedido(pedido)
    frete = calcular_frete(pedido, pedido["cep"])
    if frete > 50:
        requests.post("http://localhost:3000/api/aprovacao", json=pedido)
    db.salvar(pedido, frete)
    enviar_email(pedido["email"], frete)
    return {"ok": True, "frete": frete}


def validar_pedido(pedido):
    if not pedido["itens"]:
        raise ValueError("pedido sem itens")
    reservar_itens(pedido["itens"])
