"""Generate the geometric Swaggy mark with the Python standard library."""
import pathlib
import struct
import zlib

SIZE = 1024
SCALE = 2

def pixel(x, y):
    # Rounded tile, inset so the macOS dock has the usual visual padding.
    left, top, right, bottom, radius = 64, 64, 960, 960, 200
    nx = max(left + radius - x, 0, x - (right - radius))
    ny = max(top + radius - y, 0, y - (bottom - radius))
    if not (left <= x <= right and top <= y <= bottom) or nx * nx + ny * ny > radius * radius:
        return (0, 0, 0, 0)
    color = (21, 31, 39, 255)
    # A single continuous S cut from seven horizontal/vertical rectangles.
    bars = [(310, 290, 714, 372), (290, 310, 372, 505), (310, 470, 694, 552),
            (652, 510, 734, 704), (310, 652, 714, 734)]
    if any(a <= x <= c and b <= y <= d for a, b, c, d in bars):
        color = (77, 194, 160, 255)
    return color

rows = bytearray()
for y in range(SIZE):
    rows.append(0)
    for x in range(SIZE):
        samples = [pixel(x + (sx + 0.5) / SCALE, y + (sy + 0.5) / SCALE)
                   for sy in range(SCALE) for sx in range(SCALE)]
        rows.extend(round(sum(p[c] for p in samples) / len(samples)) for c in range(4))
def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
output = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>2I5B', SIZE, SIZE, 8, 6, 0, 0, 0))
output += chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b'')
pathlib.Path('assets/icon.png').write_bytes(output)
