def reservar_itens(itens):
    for item in itens:
        db.reservar(item["sku"], item["quantidade"])
