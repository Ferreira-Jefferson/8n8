import json

import requests


def processar_pedido(req):
    pedido = json.loads(req.body)
    validar_pedido(pedido)
    cliente = db.buscar_cliente(pedido["cliente_id"])
    frete = calcular_frete(pedido, cliente.cep)
    total = soma_itens(pedido) + frete
    db.salvar(pedido, total)
    enviar_email(cliente.email, total)
    return {"ok": True, "total": total}


def calcular_frete(pedido, cep):
    uf = requests.get("https://viacep.com.br/ws/" + cep).json()["uf"]
    peso = sum(item["peso"] for item in pedido["itens"])
    if peso > 30:
        return TABELA_PESADA[uf]
    else:
        return TABELA_PADRAO[uf]
