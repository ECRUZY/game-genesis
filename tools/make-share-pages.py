#!/usr/bin/env python3
"""
Страницы-превью моделей для WhatsApp/Telegram — то же, что кнопка
«Обновить превью-ссылки» в админке, только на компьютере.

Запуск из корня проекта:
    python3 tools/make-share-pages.py https://адрес-сайта/

Создаёт <раздел>/<номер>/index.html для всех моделей из data/<раздел>.js
(например, kitchens/12/index.html). Эти папки нужно загрузить в корень репозитория.
"""
import html
import json
import os
import re
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as f:
        return f.read()


def site_config():
    text = read("data/config.js")
    brand = re.search(r'brand:\s*"([^"]+)"', text).group(1)
    # Разделы: id и «one» (кухня, шкаф…) из незакомментированных строк
    live = "\n".join(l for l in text.splitlines() if not l.strip().startswith("//"))
    cats = re.findall(r'id:\s*"([\w-]+)".*?one:\s*"([^"]+)"', live, re.S)
    return brand, cats


def items_of(cat_id):
    text = read("data/%s.js" % cat_id)
    marker = "window.CATALOG.%s = [" % cat_id
    body = text[text.index(marker) + len(marker):text.rindex("];")].strip().rstrip(",")
    return json.loads("[" + body + "]")


def share_page(p, cat_id, one, brand, base, version):
    e = lambda s: html.escape(str(s), quote=True)
    url = "%s%s/%s/" % (base, cat_id, p["id"])
    img = "%sphotos/%s/thumbs/%s_1.jpg?v=%s" % (base, cat_id, p["id"], version)
    title = "%s «%s» · № %s" % (one[:1].upper() + one[1:], p["name"], p["id"])
    desc = " · ".join(x for x in [
        p["type"],
        " / ".join(p["sizes"]) + " см" if p["sizes"] else "",
        ", ".join(p["colors"]),
        p["producer"],
    ] if x)
    target = "../../#%s/%s" % (cat_id, p["id"])
    return "\n".join([
        "<!DOCTYPE html>",
        '<html lang="ru"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        "<title>%s — %s</title>" % (e(title), e(brand)),
        '<meta name="description" content="%s">' % e(desc),
        '<link rel="canonical" href="%s">' % e(url),
        '<meta property="og:type" content="website">',
        '<meta property="og:site_name" content="%s">' % e(brand),
        '<meta property="og:locale" content="ru_RU">',
        '<meta property="og:title" content="%s">' % e(title),
        '<meta property="og:description" content="%s">' % e(desc),
        '<meta property="og:url" content="%s">' % e(url),
        '<meta property="og:image" content="%s">' % e(img),
        '<meta property="og:image:alt" content="%s">' % e(title),
        '<meta name="twitter:card" content="summary_large_image">',
        "<script>location.replace(%s);</script>" % json.dumps(target).replace("<", "\\u003c"),
        "<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:560px;margin:32px auto;padding:0 16px;color:#1B1A17;background:#F3EFE8}img{width:100%;border-radius:16px}a{color:inherit}</style>",
        "</head><body>",
        '<img src="../../photos/%s/thumbs/%s_1.jpg" alt="">' % (cat_id, p["id"]),
        "<h1>%s</h1><p>%s</p>" % (e(title), e(desc)),
        '<p><a href="%s">Открыть в каталоге %s</a></p>' % (e(target), e(brand)),
        "</body></html>",
        "",
    ])


def main():
    if len(sys.argv) != 2 or not re.match(r"^https?://[^/]+", sys.argv[1]):
        sys.exit("Укажите адрес сайта: python3 tools/make-share-pages.py https://адрес-сайта/")
    base = sys.argv[1].strip().rstrip("/") + "/"
    brand, cats = site_config()
    version = format(int(time.time() * 1000), "x")
    for cat_id, one in cats:
        items = items_of(cat_id)
        for p in items:
            out = os.path.join(ROOT, cat_id, str(p["id"]), "index.html")
            os.makedirs(os.path.dirname(out), exist_ok=True)
            with open(out, "w", encoding="utf-8") as f:
                f.write(share_page(p, cat_id, one, brand, base, version))
        print("%s: %d страниц → папка %s/ (адрес %s%s/…)" % (cat_id, len(items), cat_id, base, cat_id))


if __name__ == "__main__":
    main()
