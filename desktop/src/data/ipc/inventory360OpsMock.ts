// Faz 12 · Tedarikçi, raf ömrü ve fire mock komutları.
//
// Bu dosya `inventory360Mock` deposunu kullanır ve tedarikçi, satın alma, raf
// ömrü ve fire/kör sayım komutlarını uygular.
//
// Backend karşılığı: `inventory360_commands::supplier_commands`,
// `inventory360_commands::shelf_life_commands` ve
// `inventory360_commands::waste_commands`.

import {
  arg,
  daysUntil,
  isoNow,
  nested,
  nestedProductName,
  persist,
  readTenant,
  requireInventoryFlag,
  requireInventoryRole,
  state,
  WASTE_CODES,
  type MockStockCount,
  type MockSupplier,
  type MockWasteRecord,
} from './inventory360Mock';

const INVENTORY360_MANAGE_ROLES = ['OWNER', 'MANAGER'];
const INVENTORY360_OWNER_ROLES = ['OWNER'];

export const SUPPLIER_SHELF_WASTE_COMMANDS: Record<string, (args: Record<string, unknown>) => unknown> = {
  // ── Tedarikçi ────────────────────────────────────────────────────────────
  get_inventory_suppliers(args) {
    requireInventoryRole(args, INVENTORY360_MANAGE_ROLES);
    return state.suppliers;
  },
  upsert_supplier_command(args) {
    requireInventoryRole(args, INVENTORY360_OWNER_ROLES);
    const govde = nested(args, 'args');
    const ad = String(arg(govde, 'name') ?? '').trim();
    if (!ad) throw new Error('VALIDATION: tedarikçi adı boş olamaz');
    const mevcut = state.suppliers.find((tedarikci) => tedarikci.name === ad);
    if (mevcut) {
      mevcut.payment_term_days = Number(arg(govde, 'payment_term_days', 'paymentTermDays') ?? 0);
      mevcut.lead_time_days = Number(arg(govde, 'lead_time_days', 'leadTimeDays') ?? 0);
      persist();
      return mevcut;
    }
    const tedarikci: MockSupplier = {
      id: `sup_${state.suppliers.length + 1}`,
      name: ad,
      contact_person: (arg(govde, 'contact_person', 'contactPerson') as string | undefined) ?? null,
      phone: (arg(govde, 'phone') as string | undefined) ?? null,
      email: (arg(govde, 'email') as string | undefined) ?? null,
      payment_term_days: Number(arg(govde, 'payment_term_days', 'paymentTermDays') ?? 0),
      lead_time_days: Number(arg(govde, 'lead_time_days', 'leadTimeDays') ?? 0),
      is_active: true,
      notes: (arg(govde, 'notes') as string | undefined) ?? null,
    };
    state.suppliers.push(tedarikci);
    persist();
    return tedarikci;
  },
  set_supplier_product_command(args) {
    requireInventoryRole(args, INVENTORY360_OWNER_ROLES);
    const govde = nested(args, 'args');
    const fiyat = Number(arg(govde, 'unit_cost_cents', 'unitCostCents') ?? -1);
    if (fiyat < 0) throw new Error('VALIDATION: alış fiyatı negatif olamaz');
    const tedarikciId = String(arg(govde, 'supplier_id', 'supplierId'));
    const urunId = String(arg(govde, 'product_id', 'productId'));
    const kayit = state.supplierPrices.find(
      (k) => k.supplier_id === tedarikciId && k.product_id === urunId,
    );
    if (kayit) {
      kayit.unit_cost_cents = fiyat;
    } else {
      state.supplierPrices.push({
        supplier_id: tedarikciId,
        product_id: urunId,
        unit_cost_cents: fiyat,
        is_preferred: false,
      });
    }
    persist();
    return { success: true };
  },
  compare_supplier_prices_command(args) {
    requireInventoryRole(args, INVENTORY360_MANAGE_ROLES);
    const govde = nested(args, 'args');
    const urunId = String(arg(govde, 'product_id', 'productId') ?? '');
    const hacim = arg(govde, 'annual_volume', 'annualVolume');
    const satirlar = state.supplierPrices
      .filter((kayit) => kayit.product_id === urunId)
      .map((kayit) => {
        const tedarikci = state.suppliers.find((t) => t.id === kayit.supplier_id);
        return {
          supplier_id: kayit.supplier_id,
          supplier_name: tedarikci?.name ?? 'Bilinmiyor',
          unit_cost_cents: kayit.unit_cost_cents,
          is_preferred: kayit.is_preferred,
          lead_time_days: tedarikci?.lead_time_days ?? 0,
        };
      });

    if (satirlar.length === 0) {
      return {
        product_id: urunId,
        product_name: null,
        rows: [],
        lowest_cents: null,
        highest_cents: null,
        gap_cents: null,
        gap_percent: null,
        annual_saving_cents: null,
      };
    }

    const fiyatlar = satirlar.map((satir) => satir.unit_cost_cents);
    const enDusuk = Math.min(...fiyatlar);
    const enYuksek = Math.max(...fiyatlar);
    const fark = enYuksek - enDusuk;
    const yillik = typeof hacim === 'number' && Number.isFinite(hacim) ? hacim : null;

    return {
      product_id: urunId,
      product_name: nestedProductName(urunId),
      rows: satirlar,
      lowest_cents: enDusuk,
      highest_cents: enYuksek,
      gap_cents: fark,
      gap_percent: enDusuk === 0 ? null : (fark / enDusuk) * 100,
      annual_saving_cents: yillik === null ? null : Math.round(fark * yillik),
    };
  },
  create_purchase_order_command(args) {
    requireInventoryRole(args, INVENTORY360_OWNER_ROLES);
    const govde = nested(args, 'args');
    const kalemler = (arg(govde, 'items') as Array<Record<string, unknown>> | undefined) ?? [];
    if (kalemler.length === 0) throw new Error('VALIDATION: sipariş en az bir kalem içermeli');
    const siparisNo = String(arg(govde, 'order_number', 'orderNumber') ?? '').trim();
    if (!siparisNo) throw new Error('VALIDATION: sipariş numarası boş olamaz');
    const toplam = kalemler.reduce((toplam, kalem) => {
      const miktar = Number(arg(kalem, 'quantity') ?? 0);
      if (!(miktar > 0)) throw new Error('VALIDATION: sipariş miktarı sıfırdan büyük olmalı');
      const fiyat = Number(arg(kalem, 'unit_cost_cents', 'unitCostCents') ?? 0);
      if (fiyat < 0) throw new Error('VALIDATION: alış fiyatı negatif olamaz');
      return toplam + Math.round(fiyat * miktar);
    }, 0);
    return {
      id: `por_${siparisNo}`,
      supplier_id: String(arg(govde, 'supplier_id', 'supplierId')),
      order_number: siparisNo,
      status: 'TASI',
      total_cents: toplam,
      expected_at: (arg(govde, 'expected_at', 'expectedAt') as string | undefined) ?? null,
      notes: (arg(govde, 'notes') as string | undefined) ?? null,
    };
  },
  receive_purchase_order_command(args) {
    requireInventoryRole(args, INVENTORY360_OWNER_ROLES);
    return 0;
  },

  // ── Raf ömrü ─────────────────────────────────────────────────────────────
  get_expiry_report(args) {
    requireInventoryFlag(args, 'feat_loss_radar', 'raf ömrü ve fire radarı');
    const rapor = state.batches.map((parti) => {
      const kalan = parti.expiry_date ? daysUntil(parti.expiry_date) : null;
      const durum = kalan === null ? 'TAZE' : kalan < 0 ? 'SURESI_GECTI' : kalan <= 3 ? 'YAKLASIYOR' : 'TAZE';
      return {
        batch_id: parti.id,
        product_id: parti.product_id,
        product_name: parti.product_name,
        batch_code: parti.batch_code,
        remaining_quantity: parti.remaining_quantity,
        received_at: parti.received_at,
        expiry_date: parti.expiry_date,
        days_left: kalan,
        state: durum,
      };
    });
    return {
      expired: rapor.filter((parti) => parti.state === 'SURESI_GECTI'),
      expiring: rapor.filter((parti) => parti.state === 'YAKLASIYOR'),
    };
  },
  list_shelf_life_policies_command(args) {
    requireInventoryFlag(args, 'feat_loss_radar', 'raf ömrü ve fire radarı');
    return [];
  },
  upsert_shelf_life_policy_command(args) {
    requireInventoryFlag(args, 'feat_loss_radar', 'raf ömrü ve fire radarı');
    const govde = nested(args, 'args');
    const gun = Number(arg(govde, 'shelf_life_days', 'shelfLifeDays') ?? 0);
    const uyari = Number(arg(govde, 'warning_days', 'warningDays') ?? 3);
    if (!(gun > 0)) throw new Error('VALIDATION: raf ömrü sıfırdan büyük gün sayısı olmalı');
    if (uyari < 0 || uyari >= gun) throw new Error('VALIDATION: uyarı penceresi raf ömründen küçük olmalı');
    return {
      id: `slp_${gun}`,
      product_id: String(arg(govde, 'product_id', 'productId')),
      product_name: nestedProductName(String(arg(govde, 'product_id', 'productId'))),
      shelf_life_days: gun,
      warning_days: uyari,
      storage_instruction: (arg(govde, 'storage_instruction', 'storageInstruction') as string | undefined) ?? null,
      is_active: true,
    };
  },
  set_batch_expiry_date(args) {
    requireInventoryFlag(args, 'feat_loss_radar', 'raf ömrü ve fire radarı');
    const govde = nested(args, 'args');
    const parti = state.batches.find((kayit) => kayit.id === String(arg(govde, 'batch_id', 'batchId')));
    if (!parti) throw new Error('NOT_FOUND: parti bulunamadı');
    const tarih = String(arg(govde, 'expiry_date', 'expiryDate') ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tarih)) {
      throw new Error('VALIDATION: son kullanma tarihi YYYY-AA-GG biçiminde olmalı');
    }
    parti.expiry_date = tarih;
    persist();
    return { success: true };
  },

  // ── Fire ve kör sayım ────────────────────────────────────────────────────
  record_waste_command(args) {
    requireInventoryRole(args, INVENTORY360_OWNER_ROLES);
    const govde = nested(args, 'args');
    const gerekce = String(arg(govde, 'reason') ?? '');
    if (!WASTE_CODES.includes(gerekce)) {
      throw new Error(`VALIDATION: fire gerekçesi geçersiz, izin verilenler: ${WASTE_CODES.join(', ')}`);
    }
    const miktar = Number(arg(govde, 'quantity') ?? 0);
    if (!(miktar > 0)) throw new Error('VALIDATION: fire miktarı sıfırdan büyük olmalı');
    const urunId = String(arg(govde, 'product_id', 'productId') ?? '');
    const parti = state.batches.find((kayit) => kayit.product_id === urunId && kayit.remaining_quantity > 0);
    // Parti yoksa birim maliyet bilinmiyor: `null` yazılır, `0` değil.
    const birim = parti ? Math.round(state.productPrices[urunId] ?? 0) : null;
    const kayit: MockWasteRecord = {
      id: `wst_${state.waste.length + 1}`,
      product_id: urunId,
      product_name: nestedProductName(urunId),
      reason: gerekce,
      quantity: miktar,
      unit_cost_cents: parti ? 1000 : null,
      total_cost_cents: birim === null ? null : Math.round(birim * miktar),
      occurred_at: isoNow(),
      recorded_by: String(arg(args, 'actor_id', 'actorId') ?? 'SYSTEM'),
      notes: (arg(govde, 'notes') as string | undefined) ?? null,
    };
    state.waste.unshift(kayit);
    persist();
    return kayit;
  },
  list_waste_records_command(args) {
    requireInventoryRole(args, INVENTORY360_MANAGE_ROLES);
    const limit = Number(arg(args, 'limit') ?? 500);
    return state.waste.slice(0, Number.isFinite(limit) ? limit : 500);
  },
  open_stock_count_command(args) {
    requireInventoryRole(args, INVENTORY360_OWNER_ROLES);
    const acik = state.stockCounts.find((sayim) => sayim.status === 'ACIK');
    if (acik) throw new Error(`CONFLICT: açık sayım zaten var (${acik.id})`);
    const govde = nested(args, 'args');
    const sayim: MockStockCount = {
      id: `sct_${state.stockCounts.length + 1}`,
      tenant_id: readTenant(args),
      status: 'ACIK',
      location: (arg(govde, 'location') as string | undefined) ?? null,
      started_by: String(arg(args, 'actor_id', 'actorId') ?? 'SYSTEM'),
      started_at: isoNow(),
      closed_by: null,
      closed_at: null,
      notes: (arg(govde, 'notes') as string | undefined) ?? null,
      lines: [],
    };
    state.stockCounts.unshift(sayim);
    persist();
    return sayim;
  },
  record_count_line_command(args) {
    requireInventoryRole(args, INVENTORY360_OWNER_ROLES);
    const govde = nested(args, 'args');
    const sayim = state.stockCounts.find((kayit) => kayit.id === String(arg(govde, 'stock_count_id', 'stockCountId')));
    if (!sayim) throw new Error('NOT_FOUND: sayım bulunamadı');
    if (sayim.status !== 'ACIK') throw new Error(`CONFLICT: sayım ${sayim.status} durumunda`);
    const miktar = Number(arg(govde, 'counted_quantity', 'countedQuantity') ?? NaN);
    if (!(miktar >= 0)) throw new Error('VALIDATION: sayılan miktar negatif olamaz');
    const urunId = String(arg(govde, 'product_id', 'productId') ?? '');
    // Beklenen miktar satırda TUTULMAZ; kapanışta hesaplanır.
    sayim.lines.push({
      product_id: urunId,
      product_name: nestedProductName(urunId),
      counted_quantity: miktar,
      expected_quantity: null,
      variance_quantity: null,
      variance_cost_cents: null,
      counted_by: String(arg(args, 'actor_id', 'actorId') ?? 'SYSTEM'),
      counted_at: isoNow(),
    });
    persist();
    return { success: true };
  },
  close_stock_count_command(args) {
    requireInventoryRole(args, INVENTORY360_OWNER_ROLES);
    const govde = nested(args, 'args');
    const sayim = state.stockCounts.find((kayit) => kayit.id === String(arg(govde, 'stock_count_id', 'stockCountId')));
    if (!sayim) throw new Error('NOT_FOUND: sayım bulunamadı');
    if (sayim.status !== 'ACIK') throw new Error(`CONFLICT: sayım zaten ${sayim.status} durumunda`);
    if (sayim.lines.length === 0) throw new Error('VALIDATION: en az bir satır sayılmadan sayım kapatılamaz');
    const duzelt = arg(govde, 'apply_adjustment', 'applyAdjustment') === true;

    for (const satir of sayim.lines) {
      const partiToplam = state.batches
        .filter((parti) => parti.product_id === satir.product_id)
        .reduce((toplam, parti) => toplam + parti.remaining_quantity, 0);
      const beklenen = state.batches.some((parti) => parti.product_id === satir.product_id)
        ? partiToplam
        : (state.productPrices[satir.product_id] !== undefined ? 0 : 0);
      const fark = satir.counted_quantity - beklenen;
      const parti = state.batches.find(
        (kayit) => kayit.product_id === satir.product_id && kayit.remaining_quantity > 0,
      );
      satir.expected_quantity = beklenen;
      satir.variance_quantity = fark;
      // Fark sıfır değilse ve parti yoksa maliyet bilinmiyor → null.
      satir.variance_cost_cents = fark === 0 ? 0 : parti ? Math.round(1000 * fark) : null;
      if (duzelt && parti) {
        const fazla = Math.min(Math.abs(fark), parti.remaining_quantity);
        parti.remaining_quantity -= fark < 0 ? -fazla : fazla;
      }
    }

    sayim.status = duzelt ? 'UYGULANDI' : 'KAPALI';
    sayim.closed_by = String(arg(args, 'actor_id', 'actorId') ?? 'SYSTEM');
    sayim.closed_at = isoNow();
    persist();
    return sayim;
  },
  get_stock_count_command(args) {
    requireInventoryRole(args, INVENTORY360_MANAGE_ROLES);
    const sayim = state.stockCounts.find(
      (kayit) => kayit.id === String(arg(args, 'stock_count_id', 'stockCountId')),
    );
    if (!sayim) throw new Error('NOT_FOUND: sayım bulunamadı');
    return sayim;
  },
  list_stock_counts_command(args) {
    requireInventoryRole(args, INVENTORY360_MANAGE_ROLES);
    return state.stockCounts.map((sayim) => ({ ...sayim, lines: [] }));
  },
};export default SUPPLIER_SHELF_WASTE_COMMANDS;