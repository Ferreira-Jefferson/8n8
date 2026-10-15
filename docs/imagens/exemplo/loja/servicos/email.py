def enviar_email(destino, total):
    corpo = "Seu pedido foi recebido. Total: " + str(total)
    smtp.enviar(destino, corpo)
