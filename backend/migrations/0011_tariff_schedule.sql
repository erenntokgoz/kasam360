-- Tarife belirlenen saat, gün ve tarih aralığında kendiliğinden açılır. Boş alan sınır koymaz.
ALTER TABLE price_tariffs ADD COLUMN schedule_on INTEGER NOT NULL DEFAULT 0;
ALTER TABLE price_tariffs ADD COLUMN start_time TEXT;
ALTER TABLE price_tariffs ADD COLUMN end_time TEXT;
ALTER TABLE price_tariffs ADD COLUMN days_of_week TEXT;
ALTER TABLE price_tariffs ADD COLUMN valid_from TEXT;
ALTER TABLE price_tariffs ADD COLUMN valid_to TEXT;
