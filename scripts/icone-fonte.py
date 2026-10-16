"""Gera a fonte de ícones da extensão do VS Code (apps/editors/vscode/media/8n8-icones.woff).

O desenho vem do manual de marca (docs/marca/manual.html):
  - U+E000 "simbolo-8n8": símbolo #mark (viewBox 96 x 76), para tamanhos pequenos.
  - U+E001 "logotipo-8n8": logotipo #wordmark (viewBox 124 x 80), os quatro blocos.
Uma fonte tem uma cor só e não tem opacidade: no logotipo, os blocos que no manual
ficam a 20% saem iguais aos outros.

  python scripts/icone-fonte.py
"""

from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from shapely.geometry import MultiPolygon, Point, Polygon, box
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

OUT = Path(__file__).resolve().parent.parent / "apps/editors/vscode/media/8n8-icones.woff"
EM = 1000
Q = 24  # segmentos por quarto de círculo


def ring(x, y, w, h, radius, stroke):
    """Borda de um retângulo de cantos redondos; o traço é centrado em (x, y, w, h)."""
    path = box(x + radius, y + radius, x + w - radius, y + h - radius).buffer(radius, quad_segs=Q)
    return path.buffer(stroke / 2, quad_segs=Q).difference(path.buffer(-stroke / 2, quad_segs=Q))


def bezier(p0, p1, p2, p3, n=64):
    pts = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        pts.append(
            tuple(
                u**3 * a + 3 * u * u * t * b + 3 * u * t * t * c + t**3 * d
                for a, b, c, d in zip(p0, p1, p2, p3)
            )
        )
    return pts


def edge(p0, p1, p2, p3, width, port):
    from shapely.geometry import LineString

    line = LineString(bezier(p0, p1, p2, p3)).buffer(width / 2, quad_segs=Q)
    return unary_union([line, Point(p0).buffer(port, quad_segs=Q), Point(p3).buffer(port, quad_segs=Q)])


def simbolo():
    shapes = [
        ring(3, 3, 34, 34, 6, 6),
        ring(59, 39, 34, 34, 6, 6),
        edge((40, 8), (52, 8), (44, 68), (56, 68), 5, 5),
    ]
    return unary_union(shapes), 96, 76


def logotipo():
    shapes = [
        ring(3, 3, 38, 34, 6, 6),
        ring(3, 43, 38, 34, 6, 6),
        ring(83, 3, 38, 34, 6, 6),
        ring(83, 43, 38, 34, 6, 6),
        edge((44, 8), (66, 8), (58, 72), (80, 72), 5, 5),
    ]
    return unary_union(shapes), 124, 80


def glyph(shape, w, h):
    """Largura do desenho = 1 em; centrado na vertical em torno de 400 (altura do texto)."""
    s = EM / w
    ty = 400 + h * s / 2
    pen = TTGlyphPen(None)
    # SVG tem y para baixo; a fonte tem y para cima.
    tp = TransformPen(pen, (s, 0, 0, -s, 0, ty))
    polys = shape.geoms if isinstance(shape, MultiPolygon) else [shape]
    for poly in polys:
        poly = orient(poly, sign=-1.0)  # contorno externo no sentido horário, furos no anti-horário
        for coords in [poly.exterior, *poly.interiors]:
            pts = list(coords.coords)[:-1]
            tp.moveTo(pts[0])
            for p in pts[1:]:
                tp.lineTo(p)
            tp.closePath()
    return pen.glyph()


notdef = TTGlyphPen(None)
glyphs = {".notdef": notdef.glyph()}
cmap = {}
for name, code, make in (("simbolo", 0xE000, simbolo), ("logotipo", 0xE001, logotipo)):
    shape, w, h = make()
    glyphs[name] = glyph(shape, w, h)
    cmap[code] = name

fb = FontBuilder(EM, isTTF=True)
fb.setupGlyphOrder(list(glyphs))
fb.setupCharacterMap(cmap)
fb.setupGlyf(glyphs)
fb.setupHorizontalMetrics({n: (EM, 0) for n in glyphs})
fb.setupHorizontalHeader(ascent=800, descent=-200)
fb.setupNameTable({"familyName": "8n8 Icones", "styleName": "Regular"})
fb.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
fb.setupPost()
fb.font.flavor = "woff"
fb.save(OUT)
print(f"fonte gravada em {OUT}")
