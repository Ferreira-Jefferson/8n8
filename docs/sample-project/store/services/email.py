def send_email(recipient, total):
    body = "Your order was received. Total: " + str(total)
    smtp.send(recipient, body)
