-- PIN özeti uzunluğu gizler. Tuş takımı otomatik girişte yanlış uzunlukta deneyip işletmeyi
-- kilitlemesin diye yalnız hane sayısı tutulur; eski kayıtlar ilk girişte dolar.
ALTER TABLE users ADD COLUMN pin_length INTEGER;
