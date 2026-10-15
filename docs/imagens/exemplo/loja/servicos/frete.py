import requests


def calcular_frete(pedido, cep):
    uf = requests.get("https://viacep.com.br/ws/" + cep).json()["uf"]
    peso = sum(item["peso"] for item in pedido["itens"])
    if peso > 30:
        return TABELA_PESADA[uf]
    else:
        return TABELA_PADRAO[uf]
