from frete import calcular_frete
from .itens import somar_itens


def processar_pedido(itens):
    total = somar_itens(itens)
    frete = calcular_frete(total)
    return total + frete
