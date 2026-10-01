/**
 * Faz 2 — Denetim Defteri Güvenlik ve Katalog Testleri
 *
 * Kapsanan kararlar:
 *   D1 Hash kanonik formu ve hash_version korunur (backend testleri bunu doğrular).
 *   D2 İstemciye ham hash veya kısaltılmış hash **hiç** dönmez; yalnızca `sealed`.
 *   D3 Denetim okuma yalnızca işletme sahibi ve müdüre açıktır.
 *   D4/D5 Zaman damgası ve zincir tek gerçektir (backend), istemci yalnızca okur.
 *   D6 Bu fazda dışa aktarım CSV + JSON'dur.
 *
 * Ayrıca sekiz kategori ve beş operasyon filtresinin katalogla birebir uyumu
 * burada sabitlenir: filtre listesi kayarsa (örn. altıncı filtre eklenirse) test
 * kırılır.
 */

import {
  AUDIT_CATEGORIES,
  AUDIT_CATEGORY_LABELS,
  buildAuditCsv,
  buildAuditJson,
  filterAuditLogs,
  isAuditCategory,
  matchesOperation,
  operationOfAction,
  OPERATION_FILTERS,
  type AuditLogDto,
} from '../../src/core/audit/auditCatalog';
import { tauriInvoke } from '../../src/data/ipc/tauriInvoke';
import { hasCapability } from '../../src/core/security/navigationMatrix';
import { useAuthStore } from '../../src/presentation/store/useAuthStore';

function log(overrides: Partial<AuditLogDto> = {}): AuditLogDto {
  return {
    id: 'ledger_test',
    sequence: 1,
    timestamp: '2026-10-01T10:00:00+00:00',
    actor_id: 'usr_owner',
    actor_role: 'OWNER',
    category: 'SIPARIS_MASA',
    action: 'order:submitted',
    resource_id: 'ord_1',
    payload: null,
    sealed: true,
    ...overrides,
  };
}

describe('Denetim kataloğu — sekiz kategori', () => {
  it('kategori listesi tam olarak sekiz ana kategoridir', () => {
    expect(AUDIT_CATEGORIES).toHaveLength(8);
    expect([...AUDIT_CATEGORIES]).toEqual([
      'SIPARIS_MASA',
      'ODEME',
      'FINANS',
      'PERSONEL',
      'MENU',
      'YETKI',
      'SISTEM',
      'GUVENLIK',
    ]);
  });

  it('her kategorinin Türkçe etiketi vardır', () => {
    for (const category of AUDIT_CATEGORIES) {
      expect(AUDIT_CATEGORY_LABELS[category]).toBeTruthy();
      expect(isAuditCategory(category)).toBe(true);
    }
    expect(isAuditCategory('STOK')).toBe(false);
  });
});

describe('Denetim kataloğu — beş operasyon filtresi', () => {
  it('filtre listesi tam olarak beş işlemdir', () => {
    expect(OPERATION_FILTERS.map((filter) => filter.label)).toEqual([
      'İptal & İade',
      'İndirim & İkram',
      'Kasa Giriş & Çıkış',
      'Masa Taşıma',
      'Stok & Fire',
    ]);
  });

  it('işlem kodları doğru filtreye bağlanır', () => {
    expect(operationOfAction('order:voided')).toBe('IPTAL_IADE');
    expect(operationOfAction('cash:movement_in')).toBe('KASA_GIRIS_CIKIS');
    expect(operationOfAction('cash:movement_out')).toBe('KASA_GIRIS_CIKIS');
    expect(operationOfAction('table:move')).toBe('MASA_TASIMA');
    expect(operationOfAction('table:merged')).toBe('MASA_TASIMA');
    expect(operationOfAction('stock:movement_out')).toBe('STOK_FIRE');
  });

  it('indirim taşıyan ödeme kaydı İndirim & İkram filtresine girer', () => {
    const discounted = log({
      action: 'payment:settled_fifo',
      category: 'ODEME',
      payload: { totalAmount: 1800, discountCents: 1200 },
    });
    const fullPrice = log({
      action: 'payment:settled_fifo',
      category: 'ODEME',
      payload: { totalAmount: 4600, discountCents: 0 },
    });

    expect(matchesOperation(discounted, 'INDIRIM_IKRAM')).toBe(true);
    expect(matchesOperation(fullPrice, 'INDIRIM_IKRAM')).toBe(false);
    // İndirimli ödeme yalnızca kendi filtresinde görünür.
    expect(matchesOperation(discounted, 'IPTAL_IADE')).toBe(false);
  });

  it('hiçbir filtreye girmeyen kayıt yalnızca Tüm Kayıtlar görünümündedir', () => {
    const routine = log({ action: 'shift:opened', category: 'FINANS' });
    for (const filter of OPERATION_FILTERS) {
      expect(matchesOperation(routine, filter.id)).toBe(false);
    }
    expect(matchesOperation(routine, 'ALL')).toBe(true);
  });

  it('arama filtreye göre çalışır ve hash alanı aranmaz', () => {
    const logs = [
      log({ id: 'a', actor_id: 'Mehmet Müdür', action: 'order:voided' }),
      log({ id: 'b', actor_id: 'Patron', action: 'table:move', resource_id: 'Masa 7' }),
    ];

    const voided = filterAuditLogs(logs, 'IPTAL_IADE', '');
    expect(voided.map((entry) => entry.id)).toEqual(['a']);

    const byActor = filterAuditLogs(logs, 'ALL', 'müdür');
    expect(byActor.map((entry) => entry.id)).toEqual(['a']);

    const byResource = filterAuditLogs(logs, 'ALL', 'masa 7');
    expect(byResource.map((entry) => entry.id)).toEqual(['b']);

    // Kategori etiketi aramada da aranır (her iki kayıt da Sipariş & Masa).
    const byCategory = filterAuditLogs(logs, 'ALL', 'sipariş & masa');
    expect(byCategory.map((entry) => entry.id)).toEqual(['a', 'b']);

    // Arama yüzeyinde hash yoktur: ne "hash" ne de mühür değeri eşleşme üretir.
    expect(filterAuditLogs(logs, 'ALL', 'hash')).toEqual([]);
    expect(filterAuditLogs(logs, 'ALL', 'mühür')).toEqual([]);
    expect(filterAuditLogs(logs, 'ALL', 'current_hash')).toEqual([]);
  });
});

describe('Dışa aktarım — hash sızdırmaz', () => {
  const logs = [
    log({ sequence: 1, action: 'order:voided', category: 'SIPARIS_MASA' }),
    log({ sequence: 2, action: 'payment:settled_fifo', category: 'ODEME', payload: { discountCents: 500 } }),
  ];

  it('CSV çıktısı mühür durumunu taşır, hash taşımaz', () => {
    const csv = buildAuditCsv(logs);
    expect(csv).toContain('Mühürlü');
    expect(csv).toContain('Sipariş İptal Edildi');
    expect(csv).not.toMatch(/[0-9a-f]{64}/);
    expect(csv.toLowerCase()).not.toContain('hash');
  });

  it('JSON çıktısı mühür durumunu taşır, hash taşımaz', () => {
    const json = buildAuditJson(logs);
    const parsed = JSON.parse(json) as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(2);
    expect(parsed[0].sealed).toBe(true);
    expect(parsed[0]).not.toHaveProperty('current_hash');
    expect(parsed[0]).not.toHaveProperty('previous_hash');
    expect(json.toLowerCase()).not.toContain('hash');
  });

  it('CSV formül enjeksiyonunu nötralize eder', () => {
    const injected = buildAuditCsv([
      log({ resource_id: '=cmd|calc!A1' }),
    ]);
    expect(injected).toContain("\"'=cmd|calc!A1\"");
  });
});

describe('Denetim okuma kapısı (D3)', () => {
  it('işletme sahibi ve müdür kayıtları okuyabilir', async () => {
    for (const caller_role of ['OWNER', 'MANAGER']) {
      const rows = await tauriInvoke<AuditLogDto[]>('get_audit_logs', { caller_role });
      expect(Array.isArray(rows)).toBe(true);
      expect(rows.length).toBeGreaterThan(0);
    }
  });

  it('kasiyer, garson, mutfak ve MASTER reddedilir', async () => {
    for (const caller_role of ['CASHIER', 'WAITER', 'KITCHEN', 'MASTER']) {
      await expect(tauriInvoke('get_audit_logs', { caller_role })).rejects.toThrow(/UNAUTHORIZED/);
    }
  });

  it('rol alanı hiç gönderilmezse kapı fail-closed çalışır', async () => {
    await expect(tauriInvoke('get_audit_logs', {})).rejects.toThrow(/UNAUTHORIZED/);
  });

  it('ekran yetkisi ile komut kapısı aynı satırı paylaşır', () => {
    expect(hasCapability('OWNER', 'auditRead')).toBe(true);
    expect(hasCapability('MANAGER', 'auditRead')).toBe(true);
    for (const role of ['CASHIER', 'WAITER', 'KITCHEN', 'MASTER'] as const) {
      expect(hasCapability(role, 'auditRead')).toBe(false);
    }
  });
});

describe('Denetim DTO sözleşmesi (D2)', () => {
  it('kayıtlar mühürlü gelir ve hash alanı taşımaz', async () => {
    const rows = await tauriInvoke<AuditLogDto[]>('get_audit_logs', { caller_role: 'OWNER' });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.sealed).toBe(true);
      expect(row).not.toHaveProperty('current_hash');
      expect(row).not.toHaveProperty('previous_hash');
      expect(row).not.toHaveProperty('tenant_id');
      expect(Object.values(row).some((value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value))).toBe(false);
    }
  });

  it('kayıtlar sekiz kategoriden birini taşır', async () => {
    const rows = await tauriInvoke<AuditLogDto[]>('get_audit_logs', { caller_role: 'OWNER' });
    for (const row of rows) {
      expect(AUDIT_CATEGORIES as readonly string[]).toContain(row.category);
    }
  });
});

describe('Tenant izolasyonu', () => {
  it('başka tenant\'ın kayıtları dönmez', async () => {
    useAuthStore.setState({
      user: {
        userId: 'usr_owner_iso',
        role: 'OWNER',
        name: 'Patron',
        tenantId: 'tenant_alpha',
      },
      isAuthenticated: true,
      isLocked: false,
    });

    const rows = await tauriInvoke<AuditLogDto[]>('get_audit_logs', { caller_role: 'OWNER' });
    expect(rows).toEqual([]);

    useAuthStore.setState({ user: null, isAuthenticated: false, isLocked: false });
  });
});
