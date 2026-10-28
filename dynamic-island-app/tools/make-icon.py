"""生成应用图标 build/icon.png（1024x1024，暖米纸胶囊）"""
import math, os, struct, zlib

W = H = 1024
OUT = os.path.join(os.path.dirname(__file__), '..', 'build', 'icon.png')

CREAM = (253, 246, 234)
DOT = (201, 123, 63)
INK = (74, 56, 38)


def sdf_rrect(px, py, cx, cy, hw, hh, r):
    qx = abs(px - cx) - hw + r
    qy = abs(py - cy) - hh + r
    return math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - r


def sdf_circle(px, py, cx, cy, r):
    return math.hypot(px - cx, py - cy) - r


def cov(d):
    return min(1.0, max(0.0, 0.5 - d))


def over(dst, src, a):
    da = dst[3]
    oa = a + da * (1 - a)
    if oa <= 0:
        return (0.0, 0.0, 0.0, 0.0)
    return tuple(
        (src[i] * a + dst[i] * da * (1 - a)) / oa for i in range(3)
    ) + (oa,)


px = bytearray(W * H * 4)
for y in range(H):
    fy = y + 0.5
    for x in range(W):
        fx = x + 0.5
        c = (0.0, 0.0, 0.0, 0.0)

        a = cov(sdf_rrect(fx, fy, 512, 512, 416, 192, 192))
        if a > 0:
            c = over(c, CREAM, a)

        a = cov(sdf_circle(fx, fy, 236, 512, 62))
        if a > 0:
            c = over(c, DOT, a)

        a = cov(sdf_rrect(fx, fy, 560, 468, 230, 30, 30)) * 0.82
        if a > 0:
            c = over(c, INK, a)

        a = cov(sdf_rrect(fx, fy, 440, 556, 110, 30, 30)) * 0.34
        if a > 0:
            c = over(c, INK, a)

        i = (y * W + x) * 4
        px[i] = int(round(c[0]))
        px[i + 1] = int(round(c[1]))
        px[i + 2] = int(round(c[2]))
        px[i + 3] = int(round(c[3] * 255))


def chunk(tag, data):
    return (struct.pack('>I', len(data)) + tag + data +
            struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))


raw = bytearray()
for y in range(H):
    raw.append(0)
    raw += px[y * W * 4:(y + 1) * W * 4]

png = (b'\x89PNG\r\n\x1a\n'
       + chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 6, 0, 0, 0))
       + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
       + chunk(b'IEND', b''))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'wb') as f:
    f.write(png)
print('written', OUT, len(png), 'bytes')
