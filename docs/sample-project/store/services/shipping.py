import requests


def calculate_shipping(order, zip_code):
    state = requests.get("https://viacep.com.br/ws/" + zip_code).json()["uf"]
    weight = sum(item["weight"] for item in order["items"])
    if weight > 30:
        return HEAVY_TABLE[state]
    else:
        return STANDARD_TABLE[state]
