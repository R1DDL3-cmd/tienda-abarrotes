import os
import re
import sys
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch, mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Image, Table, TableStyle,
    HRFlowable, ListFlowable, ListItem, PageBreak, KeepTogether
)
from reportlab.lib.enums import TA_CENTER
from PIL import Image as PILImage

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MD_PATH = os.path.join(BASE_DIR, "Manual_Usuario_Completo.md")
OUT_PATH = os.path.join(BASE_DIR, "Manual de Usuario.pdf")
IMG_DIR = os.path.join(BASE_DIR, "manual_screenshots")

PRIMARY = colors.HexColor("#2563eb")
DARK = colors.HexColor("#1e293b")
MUTED = colors.HexColor("#64748b")

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="H1", fontSize=20, leading=26, textColor=DARK, spaceBefore=18, spaceAfter=10, fontName="Helvetica-Bold"))
styles.add(ParagraphStyle(name="H2", fontSize=15, leading=20, textColor=PRIMARY, spaceBefore=16, spaceAfter=8, fontName="Helvetica-Bold"))
styles.add(ParagraphStyle(name="H3", fontSize=12.5, leading=17, textColor=DARK, spaceBefore=12, spaceAfter=6, fontName="Helvetica-Bold"))
styles.add(ParagraphStyle(name="BodyText2", fontSize=10.3, leading=15, textColor=DARK, spaceAfter=6))
styles.add(ParagraphStyle(name="Bullet2", fontSize=10.3, leading=15, textColor=DARK, spaceAfter=3, leftIndent=14))
styles.add(ParagraphStyle(name="Caption", fontSize=9, leading=12, textColor=MUTED, alignment=TA_CENTER, spaceBefore=4, spaceAfter=14, fontName="Helvetica-Oblique"))
styles.add(ParagraphStyle(name="Cover", fontSize=26, leading=32, textColor=DARK, alignment=TA_CENTER, fontName="Helvetica-Bold"))
styles.add(ParagraphStyle(name="CoverSub", fontSize=13, leading=18, textColor=MUTED, alignment=TA_CENTER, spaceBefore=10))

def inline_md(text):
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"`(.+?)`", r"<font face='Courier'>\1</font>", text)
    return text

def add_image(story, alt, relpath):
    path = os.path.join(BASE_DIR, relpath)
    max_w = 6.3 * inch
    max_h = 8 * inch
    if os.path.isfile(path):
        try:
            with PILImage.open(path) as im:
                w, h = im.size
            ratio = min(max_w / w, max_h / h, 1.0) if w and h else 1.0
            # No agrandar capturas pequeñas de más, pero sí achicar las grandes
            scale = min(max_w / w, 1.0) if w else 1.0
            draw_w = w * scale
            draw_h = h * scale
            if draw_h > max_h:
                s2 = max_h / draw_h
                draw_w *= s2
                draw_h *= s2
            story.append(Image(path, width=draw_w, height=draw_h))
            story.append(Paragraph(alt, styles["Caption"]))
        except Exception as e:
            story.append(_missing_image_box(alt, relpath))
    else:
        story.append(_missing_image_box(alt, relpath))

def _missing_image_box(alt, relpath):
    t = Table([[Paragraph(f"[Captura pendiente: {os.path.basename(relpath)}]<br/><i>{alt}</i>", styles["BodyText2"])]],
               colWidths=[6.3 * inch], rowHeights=[0.9 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f1f5f9")),
        ("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor("#cbd5e1")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
    ]))
    return t

def parse_table(lines, i):
    rows = []
    while i < len(lines) and lines[i].strip().startswith("|"):
        line = lines[i].strip()
        if re.match(r"^\|[\s\-:|]+\|$", line):
            i += 1
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        rows.append(cells)
        i += 1
    return rows, i

def build_story(md_path):
    story = []
    story.append(Spacer(1, 2 * inch))
    story.append(Paragraph("Sistema Tienda de Abarrotes", styles["Cover"]))
    story.append(Paragraph("Manual de Usuario", styles["CoverSub"]))
    story.append(Paragraph("Versión 1.0.4", styles["CoverSub"]))
    story.append(PageBreak())

    with open(md_path, "r", encoding="utf-8") as f:
        lines = f.read().split("\n")

    i = 0
    list_buffer = []

    def flush_list():
        if list_buffer:
            items = [ListItem(Paragraph(inline_md(t), styles["Bullet2"]), leftIndent=14) for t in list_buffer]
            story.append(ListFlowable(items, bulletType="bullet", start="•", leftIndent=10))
            list_buffer.clear()

    while i < len(lines):
        raw = lines[i]
        line = raw.rstrip()
        stripped = line.strip()

        if not stripped:
            flush_list()
            i += 1
            continue

        if stripped == "---":
            flush_list()
            story.append(Spacer(1, 4))
            story.append(HRFlowable(width="100%", thickness=0.6, color=colors.HexColor("#cbd5e1")))
            story.append(Spacer(1, 4))
            i += 1
            continue

        m_img = re.match(r"!\[(.*?)\]\((.*?)\)", stripped)
        if m_img:
            flush_list()
            add_image(story, m_img.group(1), m_img.group(2))
            i += 1
            continue

        if stripped.startswith("### "):
            flush_list()
            story.append(Paragraph(inline_md(stripped[4:]), styles["H3"]))
            i += 1
            continue
        if stripped.startswith("## "):
            flush_list()
            story.append(Paragraph(inline_md(stripped[3:]), styles["H2"]))
            i += 1
            continue
        if stripped.startswith("# "):
            flush_list()
            story.append(Paragraph(inline_md(stripped[2:]), styles["H1"]))
            i += 1
            continue

        if stripped.startswith("|"):
            flush_list()
            rows, i = parse_table(lines, i)
            if rows:
                data = [[Paragraph(inline_md(c), styles["BodyText2"]) for c in r] for r in rows]
                col_count = len(rows[0])
                col_width = 6.3 * inch / col_count
                t = Table(data, colWidths=[col_width] * col_count, repeatRows=1)
                t.setStyle(TableStyle([
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eef2ff")),
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                    ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ]))
                story.append(t)
                story.append(Spacer(1, 8))
            continue

        if re.match(r"^\d+\.\s+", stripped) or stripped.startswith("- "):
            text = re.sub(r"^\d+\.\s+", "", stripped)
            text = re.sub(r"^-\s+", "", text)
            list_buffer.append(text)
            i += 1
            continue

        flush_list()
        story.append(Paragraph(inline_md(stripped), styles["BodyText2"]))
        i += 1

    flush_list()
    return story


def main():
    story = build_story(MD_PATH)
    doc = SimpleDocTemplate(
        OUT_PATH, pagesize=letter,
        leftMargin=0.85 * inch, rightMargin=0.85 * inch,
        topMargin=0.75 * inch, bottomMargin=0.75 * inch,
        title="Manual de Usuario - Sistema Tienda de Abarrotes"
    )
    doc.build(story)
    print("PDF generado en:", OUT_PATH)


if __name__ == "__main__":
    main()
