def reserve_items(items):
    for item in items:
        db.reserve(item["sku"], item["quantity"])
