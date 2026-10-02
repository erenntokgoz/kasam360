"""Faz 5 kanıtı: Birleşik rapor merkezinin gerçek Chrome çıktısı.

Owner olarak giriş yapılır, "Raporlar" sekmesi açılır ve rapor bölümlerinin
gerçek ekran görüntüleri alınır.

Not: Windows konsol kodlaması nedeniyle betik ASCII kaçış dizileri kullanır;
bölüm sekmeleri sırayla (index) seçilir. Metin doğrulaması TypeScript
testlerinde ve Playwright spec'inde yapılır.
"""

import os
import sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:1420"
# Çıktı dizini betiğin bulunduğu klasördür: kullanıcı adı Türkçe karakter
# içerdiğinden yol elle yazılınca Windows'ta kırılıyor.
OUT = os.path.dirname(os.path.abspath(__file__))

# (sekme s\u0131ras\u0131, dosya ad\u0131) — ReportsHub TABS dizisiyle ayn\u0131 s\u0131ra.
TABS = [
    (0, "faz5-reports-01-ozet.png"),
    (1, "faz5-reports-02-fisler.png"),
    (2, "faz5-reports-03-vardiyalar.png"),
    (3, "faz5-reports-04-iptal-iade.png"),
]


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1600, "height": 1100})

        page.goto(BASE)
        page.wait_for_load_state("networkidle")
        page.get_by_role("button", name="Test Rolleri").click()
        page.get_by_role("button", name="Patron").first.click()
        page.get_by_role("button", name="Giri\u015f Yap").click()
        page.get_by_role("button", name="Genel Bak\u0131\u015f").wait_for()

        page.get_by_role("button", name="Raporlar", exact=True).click()
        page.get_by_role("heading", name="Raporlar").wait_for()
        page.wait_for_timeout(1500)

        nav = page.get_by_role("navigation", name="Rapor b\u00f6l\u00fcmleri")
        for index, filename in TABS:
            nav.locator("button").nth(index).click()
            page.wait_for_timeout(700)
            page.screenshot(path=os.path.join(OUT, filename), full_page=True)
            print("captured " + filename)

        # Zaman filtresi: "Son 7 g\u00fcn" aral\u0131\u011f\u0131
        page.get_by_role("button", name="Son 7 g\u00fcn").click()
        page.wait_for_timeout(1000)
        page.screenshot(path=os.path.join(OUT, "faz5-reports-05-son7gun.png"), full_page=True)
        print("captured faz5-reports-05-son7gun.png")

        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
