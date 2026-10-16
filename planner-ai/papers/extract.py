"""Layout-aware extraction of a question-paper PDF: text lines, figures and data tables.

Real university papers fight copying, so a plain text dump is not enough:
  * full-page watermark images are layered over every page;
  * many PDFs embed fonts without a usable character map, so the "text" decodes to symbols
    (4 of our 5 Mumbai University samples). Those pages are rendered and read with OCR;
  * layouts are often invisible Word tables, so only *visible* lines count as diagrams/tables.

Output per page: ordered rows (text, x, y, right-column marks) with [FIGURE f1] / [TABLE t1]
placeholders where those sit on the page, plus the figures (cropped PNGs) and tables (cells).
"""

import base64
import logging
import re
from dataclasses import dataclass, field

import numpy as np
import pymupdf

log = logging.getLogger("planner-ai.papers")
# Route PyMuPDF's notices (e.g. "consider pymupdf_layout" on every find_tables call) into logging.
pymupdf.set_messages(pylogging_name="planner-ai.pymupdf", pylogging_level=logging.DEBUG)

OCR_DPI = 200
FIGURE_DPI = 150
WATERMARK_AREA = 0.5  # images covering more than half the page are watermark/scan layers
MIN_FIGURE_AREA = 2500  # pt^2 (~50x50 pt); smaller images are logos, bullets or noise
# A separate marks token ("[10]", "05") this far right is the marks column; marks OCR'd into the
# end of a sentence must reach further right, so the line really ends at the margin.
MARKS_COLUMN = 0.70
EMBEDDED_MARKS_COLUMN = 0.82
COMMON_WORDS = {
    "the", "and", "explain", "what", "with", "write", "following", "any", "question", "marks", "of",
    "for", "using", "describe", "define", "algorithm", "data", "is", "are", "attempt", "compulsory",
    "draw", "find", "give", "in", "to", "a", "an", "on", "by", "its", "how", "why", "list", "short",
}
JUNK_PATTERNS = [
    re.compile(r"paper\s*/\s*subject\s*code", re.I),
    re.compile(r"\bQP\s*CODE\b", re.I),
    re.compile(r"^page\s*\d+\s*(of\s*\d+)?$", re.I),
    re.compile(r"^-*\s*\d+\s*of\s*\d+\s*-*$", re.I),
    re.compile(r"^\d{5,6}$"),  # paper code printed in the footer
    re.compile(r"^[*_\-=~.\s]{4,}$"),  # end-of-paper rules and asterisks
    re.compile(r"(?:[0-9A-F]{8,}|(?:X\d{3}Y[0-9A-Z]+){1,})", re.I),  # watermark serials
    re.compile(r"muquestionpapers|questionpapers\.com", re.I),
    re.compile(r"^(?=.*\d)(?=.*[A-Z])[A-Z0-9]{4,8}$"),  # watermark serial fragments OCR'd from scans ("Y8F5")
]
SUPERSCRIPTS = str.maketrans("0123456789+-=()n", "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿ")
SUBSCRIPTS = str.maketrans("0123456789+-=()", "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎")
# Marks in the right column: "05", "[10]", "(5)", "5M". OCR sometimes reads digits inside brackets
# as letters ("[so]" for "[05]"); those are kept as-is and repaired from context when structuring.
MARKS_TOKEN = re.compile(r"^(?:[\[(]\s*[0-9OoSsIl]{1,2}\s*[\])]|\d{1,2}\s*(?:M|marks?)?)$", re.I)
TRAILING_MARKS = re.compile(r"^(.*\S)\s+((?:\[\s*[0-9OoSsIl]{1,2}\s*\])|\d{1,2})$")
SUBJECT_LINE = re.compile(r"subject\s*code\s*:?\s*([A-Z0-9]+)\s*/\s*(.+)$", re.I)
FOOTER_ZONE = 0.94  # bottom 6% of the page holds only footer codes and page numbers


@dataclass
class Item:
    x0: float
    y0: float
    x1: float
    y1: float
    text: str


@dataclass
class Row:
    page: int
    x: float
    y: float
    text: str
    marks: str = ""


@dataclass
class PageResult:
    number: int
    method: str  # "text" or "ocr"
    rows: list[Row] = field(default_factory=list)


def _is_junk(text: str) -> bool:
    stripped = text.strip()
    if not stripped:
        return True
    return any(pattern.search(stripped) for pattern in JUNK_PATTERNS)


def _near_white(color) -> bool:
    return color is not None and all(channel > 0.9 for channel in color[:3])


def _visible_drawings(page: pymupdf.Page) -> list[dict]:
    """Drawings a reader can actually see (Word's white cell backgrounds are not)."""
    visible = []
    for drawing in page.get_drawings():
        stroke, fill = drawing.get("color"), drawing.get("fill")
        if (stroke is not None and not _near_white(stroke)) or (fill is not None and not _near_white(fill)):
            visible.append(drawing)
    return visible


def _strip_watermarks(page: pymupdf.Page) -> tuple[list[pymupdf.Rect], bool]:
    """Deletes full-page image layers; returns (bboxes of the remaining real images, is_scan).

    Image positions come from the bbox log, which does not decode images: get_image_info()
    decodes every layer (~240 MB for ten 2478x3506 watermarks), too much for a 512 MB server.
    Watermark xrefs are the page-shaped images that are much larger than the page in pixels.

    A page with no text layer is a genuine scan: its full-page image IS the paper, so it stays
    and OCR reads it, watermark and all."""
    page_area = page.rect.width * page.rect.height
    log = page.get_bboxlog()
    has_text_layer = any(kind == "fill-text" for kind, _ in log)

    full_page, kept = 0, []
    for kind, bbox in log:
        if kind != "fill-image":
            continue
        rect = pymupdf.Rect(bbox) & page.rect
        if rect.is_empty:
            continue
        if rect.width * rect.height > WATERMARK_AREA * page_area:
            full_page += 1
        elif rect.width * rect.height >= MIN_FIGURE_AREA:
            kept.append(rect)

    if not full_page or not has_text_layer:
        return kept, bool(full_page) and not has_text_layer

    page_aspect = page.rect.height / page.rect.width
    layers = [
        item[0] for item in page.get_images(full=True)
        if item[2] >= page.rect.width * 2 and abs(item[3] / max(item[2], 1) - page_aspect) / page_aspect < 0.35
    ]
    if len(layers) == full_page:
        for xref in layers:
            page.delete_image(xref)
        return kept, False

    # Shapes did not line up with the positions; fall back to the exact (memory-hungry) lookup.
    for info in page.get_image_info(xrefs=True):
        rect = pymupdf.Rect(info["bbox"]) & page.rect
        if info.get("xref") and rect.width * rect.height > WATERMARK_AREA * page_area:
            page.delete_image(info["xref"])
    return kept, False


def _text_is_readable(page: pymupdf.Page) -> bool:
    """False when the text layer is font-encoded gibberish (needs OCR) or missing."""
    words = re.findall(r"[A-Za-z]{2,}", page.get_text())
    if len(words) < 8:
        return False
    hits = sum(1 for word in words if word.lower() in COMMON_WORDS)
    return hits / len(words) > 0.08


def _native_items(page: pymupdf.Page) -> list[Item]:
    """Horizontal text lines from the PDF text layer, keeping super/subscripts readable."""
    items = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            if abs(line["dir"][1]) > 0.1:  # rotated text is a watermark
                continue
            spans = line["spans"]
            if not spans:
                continue
            base_size = max(span["size"] for span in spans)
            parts = []
            for span in spans:
                text = span["text"]
                if span["flags"] & 1 or (span["size"] < base_size * 0.75 and text.strip().isdigit()):
                    above = span["bbox"][3] < line["bbox"][3] - span["size"] * 0.3
                    text = text.translate(SUPERSCRIPTS if above or span["flags"] & 1 else SUBSCRIPTS)
                parts.append(text)
            text = "".join(parts).strip()
            if text:
                x0, y0, x1, y1 = line["bbox"]
                items.append(Item(x0, y0, x1, y1, text))
    return items


_ocr_engine = None


def _cpu_threads() -> int:
    """Threads the container's CPU quota really allows. A free Render instance gets 0.1 CPU but
    sees every core of the host; ONNX Runtime's default of one thread per core then makes them
    queue for the quota and OCR crawls. -1 (one per core) when there is no quota."""
    for path, parse in (
        ("/sys/fs/cgroup/cpu.max", lambda text: text.split()),
        ("/sys/fs/cgroup/cpu/cpu.cfs_quota_us", lambda text: [text.strip(), open("/sys/fs/cgroup/cpu/cpu.cfs_period_us").read()]),
    ):
        try:
            with open(path) as handle:
                quota, period = parse(handle.read())
            if quota not in ("max", "-1"):
                return max(1, int(float(quota) / float(period)))
        except (OSError, ValueError):
            continue
    return -1


def _ocr():
    """RapidOCR is loaded on first use; papers with a clean text layer never pay for it."""
    global _ocr_engine
    if _ocr_engine is None:
        from rapidocr import RapidOCR

        logging.getLogger("RapidOCR").setLevel(logging.WARNING)
        threads = _cpu_threads()
        # The text-direction classifier sometimes flips a normal line and reads it as gibberish;
        # exam pages are never upside down, so it is turned off.
        # Memory, for a 512 MB server: text is *found* on a copy of each band capped at 960 px
        # (detection dominates memory) and *read* from the full-resolution band.
        # ("max" also stops the default "min" rule from upscaling short bands.)
        _ocr_engine = RapidOCR(params={
            "Global.use_cls": False,
            "Global.log_level": "warning",
            "Det.limit_type": "max",
            "Det.limit_side_len": 960,
            "Rec.rec_batch_num": 1,  # batching is slower on one core and raises peak memory
            "EngineConfig.onnxruntime.intra_op_num_threads": threads,
            "EngineConfig.onnxruntime.inter_op_num_threads": 1 if threads > 0 else -1,
        })
    return _ocr_engine


OCR_BAND = 600  # band height in pixels at OCR_DPI (~3 inches)
OCR_OVERLAP = 120  # taller than any text line, so every line lies wholly inside some band


def _ocr_items(page: pymupdf.Page) -> list[Item]:
    """OCR in overlapping horizontal bands. Text detection on a whole 200-dpi page briefly needs
    ~700 MB, more than a 512 MB server has; a band needs a fraction of that with the same accuracy.
    Each line is kept from the band whose middle (non-overlapping) zone holds its centre, and only
    then read, so lines in the overlaps are not recognised twice."""
    from rapidocr.utils.process_img import get_rotate_crop_image

    pixmap = page.get_pixmap(dpi=OCR_DPI, colorspace=pymupdf.csRGB)
    image = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.h, pixmap.w, 3)
    scale = 72 / OCR_DPI
    engine = _ocr()
    boxes, crops = [], []

    step = OCR_BAND - OCR_OVERLAP
    for top in range(0, max(1, pixmap.h - OCR_OVERLAP), step):
        bottom = min(pixmap.h, top + OCR_BAND)
        band = np.ascontiguousarray(image[top:bottom])
        found = engine(band, use_det=True, use_cls=False, use_rec=False)
        if getattr(found, "boxes", None) is None:
            continue
        keep_from = top + (OCR_OVERLAP / 2 if top else 0)
        keep_to = bottom - OCR_OVERLAP / 2 if bottom < pixmap.h else bottom
        for box in found.boxes:
            box = np.asarray(box, dtype=np.float32)
            if not keep_from <= top + (box[:, 1].min() + box[:, 1].max()) / 2 < keep_to:
                continue  # this line belongs to the neighbouring band
            crops.append(get_rotate_crop_image(band, box.copy()))
            boxes.append(box + (0, top))

    if not crops:
        return []
    read = engine.recognize_txt(crops)
    items = []
    for box, text, score in zip(boxes, read.txts, read.scores):
        if score < 0.5 or not text.strip():
            continue
        items.append(Item(box[:, 0].min() * scale, box[:, 1].min() * scale, box[:, 0].max() * scale,
                          box[:, 1].max() * scale, text.strip()))
    return items


def _inside(item: Item, rect: pymupdf.Rect, margin: float = 2) -> bool:
    cx, cy = (item.x0 + item.x1) / 2, (item.y0 + item.y1) / 2
    return rect.x0 - margin <= cx <= rect.x1 + margin and rect.y0 - margin <= cy <= rect.y1 + margin


SCAN_DPI = 100
SCAN_GRID = 8  # pixels per grid cell (~6 pt) when looking for drawings on a scanned page
SCAN_DARK = 160  # grey level below which a pixel is ink; pink/grey watermarks are lighter


def _scanned_figure_regions(page: pymupdf.Page, items: list[Item]) -> list[pymupdf.Rect]:
    """On a scanned page the diagrams are part of the page photo. Ink that OCR did not read as text
    is grouped on a coarse grid; large connected groups are figures."""
    scale = SCAN_DPI / 72
    pixmap = page.get_pixmap(dpi=SCAN_DPI, colorspace=pymupdf.csGRAY)
    gray = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.h, pixmap.w)
    ink = gray < SCAN_DARK
    for item in items:  # text lines are not drawings
        ink[max(0, int(item.y0 * scale) - 3): int(item.y1 * scale) + 4, max(0, int(item.x0 * scale) - 3): int(item.x1 * scale) + 4] = False

    rows, cols = pixmap.h // SCAN_GRID, pixmap.w // SCAN_GRID
    grid = ink[: rows * SCAN_GRID, : cols * SCAN_GRID].reshape(rows, SCAN_GRID, cols, SCAN_GRID).sum(axis=(1, 3)) >= 2

    regions, seen = [], np.zeros_like(grid)
    for start in zip(*np.nonzero(grid)):
        if seen[start]:
            continue
        stack, cells = [start], []
        seen[start] = True
        while stack:  # flood fill over neighbouring ink cells (one empty cell of tolerance)
            r, c = stack.pop()
            cells.append((r, c))
            for dr in (-2, -1, 0, 1, 2):
                for dc in (-2, -1, 0, 1, 2):
                    nr, nc = r + dr, c + dc
                    if 0 <= nr < rows and 0 <= nc < cols and grid[nr, nc] and not seen[nr, nc]:
                        seen[nr, nc] = True
                        stack.append((nr, nc))
        r0, c0 = min(r for r, _ in cells), min(c for _, c in cells)
        r1, c1 = max(r for r, _ in cells) + 1, max(c for _, c in cells) + 1
        cell = SCAN_GRID / scale  # grid cell size in pt
        rect = pymupdf.Rect(c0 * cell, r0 * cell, c1 * cell, r1 * cell)
        if rect.width >= 60 and rect.height >= 40 and len(cells) >= 25:
            regions.append(rect)
    return regions


def _figure_regions(page: pymupdf.Page, image_rects: list[pymupdf.Rect], table_rects: list[pymupdf.Rect]) -> list[pymupdf.Rect]:
    """Real images plus clusters of visible vector drawings (circuits, graphs, flowcharts)."""
    regions = [rect for rect in image_rects if not any(rect.intersects(table) for table in table_rects)]

    visible = _visible_drawings(page)
    if visible:
        page_area = page.rect.width * page.rect.height
        for rect in page.cluster_drawings(drawings=visible, x_tolerance=8, y_tolerance=8):
            rect = pymupdf.Rect(rect)
            too_thin = rect.width < 30 or rect.height < 30  # rules and underlines
            if too_thin or rect.width * rect.height > 0.6 * page_area:
                continue
            if any(rect.intersects(table) for table in table_rects):
                continue
            regions.append(rect)

    # Merge overlapping regions (an image with arrows drawn over it is one figure).
    merged: list[pymupdf.Rect] = []
    for rect in sorted(regions, key=lambda r: (r.y0, r.x0)):
        for existing in merged:
            if (existing + (-6, -6, 6, 6)).intersects(rect):
                existing.include_rect(rect)
                break
        else:
            merged.append(pymupdf.Rect(rect))
    return merged


def _data_tables(page: pymupdf.Page, items: list[Item]) -> list[tuple[pymupdf.Rect, list[list[str]]]]:
    """Visible-bordered tables, with each cell filled from the (native or OCR) text items."""
    visible = _visible_drawings(page)
    if not visible:
        return []

    tables = []
    page_area = page.rect.width * page.rect.height
    for table in page.find_tables(strategy="lines").tables:
        rect = pymupdf.Rect(table.bbox)
        if rect.width * rect.height > 0.6 * page_area or table.row_count < 2 or table.col_count < 2:
            continue  # a page-sized "table" is the invisible layout grid, not data
        borders = sum(1 for drawing in visible if pymupdf.Rect(drawing["rect"]).intersects(rect))
        if borders < 3:
            continue

        rows = []
        for row in table.rows:
            cells = []
            for cell in row.cells:
                if cell is None:
                    cells.append("")
                    continue
                cell_rect = pymupdf.Rect(cell)
                words = sorted((item for item in items if _inside(item, cell_rect, margin=0)), key=lambda i: (round(i.y0), i.x0))
                cells.append(" ".join(word.text for word in words).strip())
            rows.append(cells)
        if any(any(cell for cell in row) for row in rows):
            tables.append((rect, rows))
    return tables


def _clean_items(items: list[Item], page_height: float) -> list[Item]:
    """Drops footer codes, page numbers and watermark serials before lines are assembled."""
    return [item for item in items if item.y0 < page_height * FOOTER_ZONE and not _is_junk(item.text)]


def _rows_from_items(items: list[Item], page_number: int, page_width: float) -> list[Row]:
    """Groups items into visual lines; a bare number at the far right becomes the marks."""
    items = sorted(items, key=lambda item: ((item.y0 + item.y1) / 2, item.x0))
    lines: list[list[Item]] = []
    for item in items:
        center = (item.y0 + item.y1) / 2
        if lines:
            last = lines[-1]
            last_center = sum((i.y0 + i.y1) / 2 for i in last) / len(last)
            height = max(i.y1 - i.y0 for i in last)
            if abs(center - last_center) < max(4.0, height * 0.55):
                last.append(item)
                continue
        lines.append([item])

    rows = []
    for line in lines:
        line.sort(key=lambda item: item.x0)
        marks = ""
        if len(line) > 1 or line[0].x0 > page_width * MARKS_COLUMN:
            tail = line[-1]
            match = MARKS_TOKEN.match(tail.text)
            if match and tail.x0 > page_width * MARKS_COLUMN:
                marks = tail.text.strip()
                line = line[:-1]
        if not marks and line and line[-1].x1 > page_width * EMBEDDED_MARKS_COLUMN:
            # OCR sometimes reads the marks as part of the text box: "... appropriate 10".
            split = TRAILING_MARKS.match(line[-1].text)
            # "... 75, 13, 15" is data, not marks: the number must not continue a list or equation.
            if split and not re.search(r"[,=+\-*/:(]\s*$", split.group(1)):
                marks = split.group(2)
                line = line[:-1] + [Item(line[-1].x0, line[-1].y0, line[-1].x1, line[-1].y1, split.group(1))]
        text = "  ".join(item.text for item in line).strip()
        if not text and not marks:
            continue
        if text and _is_junk(text):
            continue
        anchor = line[0] if line else tail
        rows.append(Row(page=page_number, x=round(anchor.x0, 1), y=round(anchor.y0, 1), text=text, marks=marks))

    # Marks printed slightly above/below their question line end up on a row of their own;
    # attach them to the nearest text row without marks.
    merged: list[Row] = []
    for row in rows:
        if not row.text and row.marks:
            candidates = [other for other in rows if other.text and not other.marks and abs(other.y - row.y) < 16]
            if candidates:
                min(candidates, key=lambda other: abs(other.y - row.y)).marks = row.marks
                continue
        merged.append(row)
    return merged


def _crop_png(page: pymupdf.Page, rect: pymupdf.Rect) -> str:
    pixmap = page.get_pixmap(dpi=FIGURE_DPI, clip=rect + (-4, -4, 4, 4), colorspace=pymupdf.csRGB)
    return "data:image/png;base64," + base64.b64encode(pixmap.tobytes("png")).decode()


def extract_pdf(data: bytes) -> dict:
    """Returns {pages: [...], figures: [...], tables: [...], layout_text: str, ocr_pages: int}."""
    document = pymupdf.open(stream=data, filetype="pdf")
    pages, figures, tables = [], [], []
    meta: dict = {}

    for page in document:
        number = page.number + 1
        image_rects, is_scan = _strip_watermarks(page)
        readable = _text_is_readable(page)
        items = _native_items(page) if readable else _ocr_items(page)
        method = "text" if readable else "ocr"

        # The "Paper / Subject Code: 49375 / Computer Graphics" header is junk in the body but
        # names the subject, which generation needs.
        for item in items:
            match = SUBJECT_LINE.search(item.text)
            if match and "subject" not in meta:
                meta["subject_code"], meta["subject"] = match.group(1), match.group(2).strip()
        items = _clean_items(items, page.rect.height)
        if is_scan:
            image_rects = image_rects + _scanned_figure_regions(page, items)

        page_tables = _data_tables(page, items)
        table_rects = [rect for rect, _ in page_tables]
        figure_rects = _figure_regions(page, image_rects, table_rects)

        # Text inside a figure (node labels, axis numbers) or a table belongs to that object.
        blocked = figure_rects + table_rects
        items = [item for item in items if not any(_inside(item, rect) for rect in blocked)]
        rows = _rows_from_items(items, number, page.rect.width)

        for rect in figure_rects:
            figure_id = f"f{len(figures) + 1}"
            figures.append({
                "id": figure_id,
                "page": number,
                "bbox": [round(v, 1) for v in rect],
                "width": round(rect.width),
                "height": round(rect.height),
                "dataUrl": _crop_png(page, rect),
            })
            rows.append(Row(page=number, x=round(rect.x0, 1), y=round(rect.y0, 1), text=f"[FIGURE {figure_id}]"))

        for rect, cells in page_tables:
            table_id = f"t{len(tables) + 1}"
            tables.append({"id": table_id, "page": number, "bbox": [round(v, 1) for v in rect], "rows": cells})
            rows.append(Row(page=number, x=round(rect.x0, 1), y=round(rect.y0, 1), text=f"[TABLE {table_id}]"))

        rows.sort(key=lambda row: row.y)
        pages.append(PageResult(number=number, method=method, rows=rows))

    document.close()
    return {
        "meta": meta,
        "pages": [
            {"number": page.number, "method": page.method, "rows": [row.__dict__ for row in page.rows]}
            for page in pages
        ],
        "figures": figures,
        "tables": tables,
        "layout_text": layout_text(pages),
        "ocr_pages": sum(1 for page in pages if page.method == "ocr"),
    }


def layout_text(pages: list[PageResult]) -> str:
    """Readable text that keeps indentation and puts marks in a {{marks}} tag on their line."""
    lines = []
    for page in pages:
        if not page.rows:
            continue
        left = min(row.x for row in page.rows)
        for row in page.rows:
            indent = " " * max(0, min(12, round((row.x - left) / 12)))
            marks = f"  {{{{{row.marks}}}}}" if row.marks else ""
            lines.append(f"{indent}{row.text}{marks}".rstrip())
    return "\n".join(lines)
