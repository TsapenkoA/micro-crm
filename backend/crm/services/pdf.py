import calendar
import html
from io import BytesIO
from pathlib import Path

from django.utils import timezone
from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from .calculations import money_string


def font_paths():
    candidates = [
        (Path("C:/Windows/Fonts/DejaVuSans.ttf"), Path("C:/Windows/Fonts/DejaVuSans-Bold.ttf")),
        (Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")),
    ]
    for regular, bold in candidates:
        if regular.is_file() and bold.is_file():
            return regular, bold
    raise RuntimeError("A DejaVu Sans font is required for invoice PDF generation.")


def pdf_date(value):
    if value is None:
        return "Not issued"
    local = timezone.localtime(value)
    return f"{calendar.month_abbr[local.month]} {local.day}, {local.year}"


def render_invoice(invoice):
    if "InvoiceSans" not in pdfmetrics.getRegisteredFontNames():
        regular, bold = font_paths()
        pdfmetrics.registerFont(TTFont("InvoiceSans", str(regular)))
        pdfmetrics.registerFont(TTFont("InvoiceSans-Bold", str(bold)))
        pdfmetrics.registerFontFamily("InvoiceSans", normal="InvoiceSans", bold="InvoiceSans-Bold")
    styles = getSampleStyleSheet()
    base = ParagraphStyle("InvoiceBody", parent=styles["Normal"], fontName="InvoiceSans", fontSize=9, leading=14, splitLongWords=1)
    small = ParagraphStyle("InvoiceSmall", parent=base, fontSize=8, leading=12, textColor=colors.HexColor("#64748b"))
    heading = ParagraphStyle("InvoiceHeading", parent=base, fontName="InvoiceSans-Bold", fontSize=22, leading=27)
    right = ParagraphStyle("InvoiceRight", parent=base, alignment=TA_RIGHT)
    right_bold = ParagraphStyle("InvoiceRightBold", parent=right, fontName="InvoiceSans-Bold")
    def paragraph(value, style=base):
        return Paragraph(html.escape(str(value or "")).replace("\n", "<br/>"), style)

    stream = BytesIO()
    document = SimpleDocTemplate(stream, pagesize=A4, rightMargin=18 * mm, leftMargin=18 * mm, topMargin=18 * mm, bottomMargin=18 * mm)
    content = [Table([[paragraph("INVOICE", heading), paragraph(invoice.invoice_number, right_bold)]], colWidths=[98 * mm, 76 * mm]), Spacer(1, 10 * mm)]
    seller = invoice.seller_snapshot
    buyer = invoice.buyer_snapshot
    from_lines = [seller.get("name"), seller.get("address"), seller.get("email"), f"Tax ID: {seller['tax_id']}" if seller.get("tax_id") else None]
    to_lines = [buyer.get("company") or buyer.get("name"), buyer.get("name") if buyer.get("company") else None, buyer.get("email"), buyer.get("phone")]
    parties = Table([[
        [paragraph("FROM", small)] + [paragraph(value) for value in from_lines if value],
        [paragraph("BILL TO", small)] + [paragraph(value) for value in to_lines if value],
    ]], colWidths=[87 * mm, 87 * mm])
    parties.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    metadata = Table([[paragraph(f"Status: {invoice.status.title()}", small), paragraph(f"Issued: {pdf_date(invoice.issued_at)}", small)]], colWidths=[87 * mm, 87 * mm])
    metadata.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    content.extend([parties, Spacer(1, 8 * mm), metadata, Spacer(1, 7 * mm)])
    rows = [[paragraph(title, small) for title in ("DESCRIPTION", "QTY", "UNIT PRICE", "TAX", "AMOUNT")]]
    for item in invoice.items.all():
        rows.append([
            paragraph(item.description), paragraph(item.quantity),
            paragraph(f"{item.unit_price:.4f} {invoice.currency}", right),
            paragraph(f"{format(item.tax_rate, '.4f').rstrip('0').rstrip('.')}%", right),
            paragraph(f"{money_string(item.line_total, invoice.currency)} {invoice.currency}", right),
        ])
    lines = Table(rows, colWidths=[70 * mm, 19 * mm, 35 * mm, 18 * mm, 32 * mm], repeatRows=1, hAlign="LEFT")
    lines.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f3f6")),
        ("LINEBELOW", (0, 0), (-1, 0), 0.6, colors.HexColor("#cbd5e1")),
        ("LINEBELOW", (0, 1), (-1, -1), 0.25, colors.HexColor("#e2e8f0")),
        ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    content.extend([lines, Spacer(1, 8 * mm)])
    totals = Table([
        [paragraph("Subtotal"), paragraph(f"{money_string(invoice.subtotal, invoice.currency)} {invoice.currency}", right)],
        [paragraph("Tax"), paragraph(f"{money_string(invoice.tax_total, invoice.currency)} {invoice.currency}", right)],
        [paragraph("Total", ParagraphStyle("InvoiceTotal", parent=base, fontName="InvoiceSans-Bold")), paragraph(f"{money_string(invoice.total_amount, invoice.currency)} {invoice.currency}", right_bold)],
    ], colWidths=[70 * mm, 52 * mm], hAlign="RIGHT")
    totals.setStyle(TableStyle([("LINEABOVE", (0, 2), (-1, 2), 0.7, colors.HexColor("#334155")), ("TOPPADDING", (0, 0), (-1, -1), 6)]))
    content.append(totals)
    document.build(content)
    return stream.getvalue()
