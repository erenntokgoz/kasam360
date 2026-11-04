-- Komisyon ve kâr payı modelleri kaldırıldı: satış ve kâr tabanlı ödeme işletmede
-- kullanılmıyordu ve yanlış tabandan prim yazma riski taşıyordu. Eski kurallar sabit
-- maaşa döner; taban maaş korunur, yüzdeler sıfırlanır ki bordro onları okumasın.
UPDATE payroll_rules SET model = 'FIXED' WHERE model IN ('COMMISSION', 'PROFIT_SHARE');
UPDATE payroll_rules SET commission_percent = 0, profit_share_percent = 0
 WHERE commission_percent <> 0 OR profit_share_percent <> 0;
