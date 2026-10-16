import requests

from services.email import send_email
from services.shipping import calculate_shipping
from stock import reserve_items


def process_order(order):
    validate_order(order)
    shipping = calculate_shipping(order, order["zip_code"])
    if shipping > 50:
        requests.post("http://localhost:3000/api/approval", json=order)
    db.save(order, shipping)
    send_email(order["email"], shipping)
    return {"ok": True, "shipping": shipping}


def validate_order(order):
    if not order["items"]:
        raise ValueError("order has no items")
    reserve_items(order["items"])
