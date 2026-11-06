from decimal import Decimal, ROUND_HALF_UP


CURRENCY_PLACES = {
    "AUD": 2, "CAD": 2, "CHF": 2, "EUR": 2, "GBP": 2, "PLN": 2, "UAH": 2, "USD": 2,
    "JPY": 0, "KWD": 3, "CLF": 4,
}
MAX_AMOUNT = Decimal("9999999999999999.9999")


def money_quantum(currency):
    return Decimal(1).scaleb(-CURRENCY_PLACES[currency])


def round_money(value, currency):
    return value.quantize(money_quantum(currency), rounding=ROUND_HALF_UP)


def money_string(value, currency):
    return f"{value:.{CURRENCY_PLACES.get(currency, 2)}f}"


def calculate_items(items, currency):
    subtotal = tax_total = Decimal("0")
    calculated = []
    for item in items:
        raw_total = item["quantity"] * item["unit_price"]
        if raw_total > MAX_AMOUNT:
            raise ValueError("An invoice line exceeds the supported amount.")
        line_total = round_money(raw_total, currency)
        tax_amount = round_money(line_total * item["tax_rate"] / Decimal("100"), currency)
        if line_total > MAX_AMOUNT or tax_amount > MAX_AMOUNT:
            raise ValueError("An invoice line exceeds the supported amount.")
        calculated.append({**item, "line_total": line_total, "tax_amount": tax_amount})
        subtotal += line_total
        tax_total += tax_amount
    total_amount = subtotal + tax_total
    if max(subtotal, tax_total, total_amount) > MAX_AMOUNT:
        raise ValueError("Invoice totals exceed the supported amount.")
    return calculated, subtotal, tax_total, total_amount
