import requests


def calcular_frete(peso, distancia):
    requests.get("https://api.exemplo.com/tabela-frete")
    base = 10
    taxa = distancia * 0.5
    if peso > 30:
        return base + taxa * 2
    else:
        return base + taxa


def processar_pedido(itens):
    total = 0
    for item in itens:
        total = total + calcular_frete(item["peso"], item["distancia"])
    return total
