import { describe, it, expect, beforeEach } from 'vitest';
import {
  tauriInvoke,
  resetMockStaff,
  resetMockStaff360,
} from '../../src/data/ipc/tauriInvoke';
import {
  MODEL_LABELS,
  currentPeriod,
  money,
  shiftPeriod,
} from '../../src/presentation/components/owner/staff/staff360Types';

/**
 * Faz 11 Personel 360° — sözleşme testleri.
 *
 * Bu paketin amacı mock katmanının backend ile **aynı** kapıları uyguladığını
 * kanıtlamak. Mock gevşek kalırsa tarayıcıda çalışan uygulama gerçek uygulamayı
 * yıltır ve testler yeşil görünürken ürün kırık olur.
 */

const TENANT = 'DEFAULT_TENANT';
const AUTH = { tenantId: TENANT, tenant_id: TENANT, actorRole: 'OWNER', actor_role: 'OWNER' };
const MANAGER_AUTH = {
  tenantId: TENANT,
  tenant_id: TENANT,
  actorRole: 'MANAGER',
  actor_role: 'MANAGER',
};

/**
 * Sözleşme tipleri.
 *
 * Neden burada tanımlı: `tauriInvoke` generic'siz çağrıldığında `unknown`
 * döner ve alan erişimi TypeScript hatası verir. Tipler burada tek yerde
 * durur ki mock sözleşmesi ile backend `Option<i64>` / `null` semantiği
 * testte de görünür olsun.
 */
type ProfilDto = {
  userId: string;
  fullName: string;
  role: string;
  /** `null` = yetki yok ya da tanımlanmadı. `0` DEĞİL. */
  baseSalaryCents: number | null;
  commissionPercent: number | null;
};

type BordroSatiriDto = {
  userId: string;
  fullName: string;
  /** Müdür için `null`: tutar görüntülenemez. */
  amounts: { grossCents: number } | null;
};

type BahsisOzetiDto = {
  totalCents: number;
  distributedCents: number;
  leftoverCents: number;
};

type KpiSatiriDto = {
  userId: string;
  fullName: string;
  grossSalesCents: number;
  topProduct: string | null;
};

beforeEach(() => {
  resetMockStaff();
  resetMockStaff360();
});

describe('Personel 360° yetki kapıları', () => {
  it('garson personel listesini göremez', async () => {
    await expect(
      tauriInvoke('list_staff_profiles', {
        tenantId: TENANT,
        tenant_id: TENANT,
        actorRole: 'WAITER',
        actor_role: 'WAITER',
      })
    ).rejects.toThrow(/UNAUTHORIZED/);
  });

  it('müdür maaş kuralı tanımlayamaz', async () => {
    await expect(
      tauriInvoke('set_payroll_rule', {
        ...MANAGER_AUTH,
        input: {
          userId: 'usr_waiter',
          model: 'FIXED',
          baseSalaryCents: 1000,
          commissionPercent: 0,
          hourlyRateCents: 0,
          tipMultiplierPercent: 100,
          profitSharePercent: 0,
        },
      })
    ).rejects.toThrow(/UNAUTHORIZED/);
  });

  it('müdür bahşiş dağıtamaz', async () => {
    await expect(
      tauriInvoke('distribute_tip_pool', {
        ...MANAGER_AUTH,
        period: currentPeriod(),
        allocations: [{ userId: 'usr_waiter', basisCents: 1000, multiplierPercent: 100 }],
      })
    ).rejects.toThrow(/UNAUTHORIZED/);
  });

  it('tenant eksikken her komut reddedilir', async () => {
    await expect(
      tauriInvoke('list_staff_profiles', { actorRole: 'OWNER', actor_role: 'OWNER' })
    ).rejects.toThrow(/tenant_id/);
  });

  it('müdür izin talebini görebilir, mutfak göremez', async () => {
    const müdür = await tauriInvoke('list_leave_requests', MANAGER_AUTH);
    expect(Array.isArray(müdür)).toBe(true);

    await expect(
      tauriInvoke('list_leave_requests', {
        tenantId: TENANT,
        tenant_id: TENANT,
        actorRole: 'KITCHEN',
        actor_role: 'KITCHEN',
      })
    ).rejects.toThrow(/UNAUTHORIZED/);
  });
});

describe('Personel profili', () => {
  it('müdür profil listesini görür ama maaş tutarını görmez', async () => {
    await tauriInvoke('save_staff_profile', {
      ...AUTH,
      actorId: 'usr_owner',
      actor_id: 'usr_owner',
      input: {
        userId: 'usr_waiter',
        fullName: 'Garson (Garson)',
        baseSalaryCents: 25000,
        commissionPercent: 10,
      },
    });

    const müdürListesi = await tauriInvoke<ProfilDto[]>('list_staff_profiles', MANAGER_AUTH);
    expect(müdürListesi).toHaveLength(1);

    const sahipListesi = await tauriInvoke<ProfilDto[]>('list_staff_profiles', AUTH);
    expect(sahipListesi[0].baseSalaryCents).toBe(25000);
    // Müdür için `null`, `0` DEĞİL: 0 da bir maaş olabilir. Sıfır göstermek
    // "maaşsız çalışıyor" yanlış yorumu yaratır.
    expect(müdürListesi[0].baseSalaryCents).toBeNull();
    expect(müdürListesi[0].commissionPercent).toBeNull();
    // Kimlik bilgisi yine görünür: gizlilik tutarı gizler, kaydı değil.
    expect(müdürListesi[0].fullName).toBe('Garson (Garson)');
  });

  it('olmayan kullanıcıya profil açılamaz', async () => {
    await expect(
      tauriInvoke('save_staff_profile', {
        ...AUTH,
        actorId: 'usr_owner',
        actor_id: 'usr_owner',
        input: { userId: 'usr_yok', fullName: 'Hayalet', baseSalaryCents: 0, commissionPercent: 0 },
      })
    ).rejects.toThrow(/kullanici bulunamadi/);
  });

  it('negatif maaş reddedilir', async () => {
    await expect(
      tauriInvoke('save_staff_profile', {
        ...AUTH,
        actorId: 'usr_owner',
        actor_id: 'usr_owner',
        input: {
          userId: 'usr_waiter',
          fullName: 'Garson',
          baseSalaryCents: -100,
          commissionPercent: 0,
        },
      })
    ).rejects.toThrow(/negatif/);
  });

  it('takvimde olmayan doğum tarihi reddedilir', async () => {
    await expect(
      tauriInvoke('save_staff_profile', {
        ...AUTH,
        actorId: 'usr_owner',
        actor_id: 'usr_owner',
        input: {
          userId: 'usr_waiter',
          fullName: 'Garson',
          baseSalaryCents: 0,
          commissionPercent: 0,
          birthDate: '1990-13-45',
        },
      })
    ).rejects.toThrow(/YYYY-MM-DD/);
  });

  it('doğum günü bilinmeyen personel listede görünmez', async () => {
    const sonuc = await tauriInvoke('get_upcoming_birthdays', { ...AUTH, daysAhead: 365 });
    expect(sonuc).toEqual([]);
  });
});

describe('Maaş hesabı', () => {
  it('geçersiz model reddedilir', async () => {
    await expect(
      tauriInvoke('set_payroll_rule', {
        ...AUTH,
        input: {
          userId: 'usr_waiter',
          model: 'HEDIYE',
          baseSalaryCents: 1000,
          commissionPercent: 0,
          hourlyRateCents: 0,
          tipMultiplierPercent: 100,
          profitSharePercent: 0,
        },
      })
    ).rejects.toThrow(/gecersiz maas modeli/);
  });

  it('müdür bordroyu görür ama tutarı göremez', async () => {
    await tauriInvoke('set_payroll_rule', {
      ...AUTH,
      input: {
        userId: 'usr_waiter',
        model: 'FIXED',
        baseSalaryCents: 25000,
        commissionPercent: 0,
        hourlyRateCents: 0,
        tipMultiplierPercent: 100,
        profitSharePercent: 0,
      },
    });

    const müdürBordrosu = await tauriInvoke<BordroSatiriDto[]>('run_payroll', {
      ...MANAGER_AUTH,
      period: currentPeriod(),
    });
    expect(müdürBordrosu).toHaveLength(1);
    expect(müdürBordrosu[0].amounts).toBeNull();
    expect(müdürBordrosu[0].fullName).toBeTruthy();

    const sahipBordrosu = await tauriInvoke<BordroSatiriDto[]>('run_payroll', { ...AUTH, period: currentPeriod() });
    expect(sahipBordrosu[0].amounts?.grossCents).toBe(25000);
  });

  it('kural yokken bordro hata verir, boş liste değil', async () => {
    await expect(
      tauriInvoke('run_payroll', { ...AUTH, period: currentPeriod() })
    ).rejects.toThrow(/maas kurali yok/);
  });

  it('geçersiz dönem reddedilir', async () => {
    await expect(tauriInvoke('run_payroll', { ...AUTH, period: '2026-13' })).rejects.toThrow(
      /YYYY-MM/
    );
  });
});

describe('Bahşiş havuzu', () => {
  it('boş havuzda dağıtım yapılamaz', async () => {
    await expect(
      tauriInvoke('distribute_tip_pool', {
        ...AUTH,
        period: currentPeriod(),
        allocations: [{ userId: 'usr_waiter', basisCents: 1000, multiplierPercent: 100 }],
      })
    ).rejects.toThrow(/dagitilacak bahsis yok/);
  });

  it('boş dağıtım listesi reddedilir', async () => {
    await expect(
      tauriInvoke('distribute_tip_pool', { ...AUTH, period: currentPeriod(), allocations: [] })
    ).rejects.toThrow(/calisan yok/);
  });

  it('havuz özeti kaydı olmayan dönemde sıfır döner, hata değil', async () => {
    const ozet = await tauriInvoke<BahsisOzetiDto>('get_tip_pool_summary', { ...AUTH, period: currentPeriod() });
    expect(ozet.totalCents).toBe(0);
    expect(ozet.distributedCents).toBe(0);
    expect(ozet.leftoverCents).toBe(0);
  });
});

describe('Vardiya planı', () => {
  it('bitiş başlangıçtan önceyse plan reddedilir', async () => {
    await expect(
      tauriInvoke('add_shift_plan', {
        ...AUTH,
        actorId: 'usr_owner',
        actor_id: 'usr_owner',
        plan: {
          userId: 'usr_waiter',
          planDate: '2026-03-10',
          startTime: '22:00',
          endTime: '02:00',
          plannedBreakMinutes: 30,
          roleRequired: 'WAITER',
        },
      })
    ).rejects.toThrow(/baslangictan sonra/);
  });

  it('geçersiz plan tarihi reddedilir', async () => {
    await expect(
      tauriInvoke('add_shift_plan', {
        ...AUTH,
        actorId: 'usr_owner',
        actor_id: 'usr_owner',
        plan: {
          userId: 'usr_waiter',
          planDate: '10/03/2026',
          startTime: '09:00',
          endTime: '17:00',
          plannedBreakMinutes: 0,
          roleRequired: 'WAITER',
        },
      })
    ).rejects.toThrow(/YYYY-MM-DD/);
  });

  it('ters tarih aralığında liste hata verir', async () => {
    await expect(
      tauriInvoke('list_shift_plans', { ...AUTH, from: '2026-03-31', to: '2026-03-01' })
    ).rejects.toThrow(/ters/);
  });
});

describe('İzin', () => {
  it('çakışan izin talebi reddedilir', async () => {
    const talep = {
      userId: 'usr_waiter',
      kind: 'YILLIK',
      startDate: '2026-03-10',
      endDate: '2026-03-15',
      reason: null,
    };
    await tauriInvoke('request_leave', { ...AUTH, input: talep });
    await expect(tauriInvoke('request_leave', { ...AUTH, input: talep })).rejects.toThrow(
      /zaten bir izin talebi/
    );
  });

  it('kendi iznini kendi onaylamak reddedilir', async () => {
    const id = await tauriInvoke('request_leave', {
      ...AUTH,
      input: {
        userId: 'usr_owner',
        kind: 'YILLIK',
        startDate: '2026-03-10',
        endDate: '2026-03-12',
        reason: null,
      },
    });
    await expect(
      tauriInvoke('decide_leave', {
        ...AUTH,
        approverId: 'usr_owner',
        approver_id: 'usr_owner',
        leaveId: id,
        leave_id: id,
        approve: true,
      })
    ).rejects.toThrow(/kendin onaylayamazsin/);
  });

  it('karar sonrası izin yeniden kararlandırılamaz', async () => {
    const id = await tauriInvoke('request_leave', {
      ...AUTH,
      input: {
        userId: 'usr_waiter',
        kind: 'YILLIK',
        startDate: '2026-04-10',
        endDate: '2026-04-12',
        reason: null,
      },
    });
    await tauriInvoke('decide_leave', {
      ...AUTH,
      approverId: 'usr_owner',
      approver_id: 'usr_owner',
      leaveId: id,
      leave_id: id,
      approve: true,
    });
    await expect(
      tauriInvoke('decide_leave', {
        ...AUTH,
        approverId: 'usr_owner',
        approver_id: 'usr_owner',
        leaveId: id,
        leave_id: id,
        approve: false,
      })
    ).rejects.toThrow(/zaten kararli/);
  });
});

describe('Zimmet', () => {
  it('kapalı zimmet tekrar kapatılamaz', async () => {
    const id = await tauriInvoke('add_custody_record', {
      ...AUTH,
      userId: 'usr_waiter',
      user_id: 'usr_waiter',
      itemName: 'Tepsi',
      item_name: 'Tepsi',
      quantity: 4,
    });
    await tauriInvoke('close_custody_record', {
      ...AUTH,
      custodyId: id,
      custody_id: id,
      damaged: false,
    });
    await expect(
      tauriInvoke('close_custody_record', {
        ...AUTH,
        custodyId: id,
        custody_id: id,
        damaged: false,
      })
    ).rejects.toThrow(/zaten kapali/);
  });

  it('sıfır adet zimmet reddedilir', async () => {
    await expect(
      tauriInvoke('add_custody_record', {
        ...AUTH,
        userId: 'usr_waiter',
        user_id: 'usr_waiter',
        itemName: 'Tepsi',
        item_name: 'Tepsi',
        quantity: 0,
      })
    ).rejects.toThrow(/sifirdan buyuk/);
  });
});

describe('Tutanak', () => {
  it('boş özet kaydedilmez', async () => {
    await expect(
      tauriInvoke('record_staff_incident', {
        ...AUTH,
        actorId: 'usr_owner',
        actor_id: 'usr_owner',
        input: {
          userId: 'usr_waiter',
          user_id: 'usr_waiter',
          kind: 'NOT',
          severity: 'Dusuk',
          occurredAt: '2026-03-10T10:00:00Z',
          occurred_at: '2026-03-10T10:00:00Z',
          summary: '   ',
          details: null,
        },
      })
    ).rejects.toThrow(/ozeti bos olamaz/);
  });
});

describe('KPI ve radar', () => {
  it('ters tarih aralığı hata verir', async () => {
    await expect(
      tauriInvoke('get_staff_kpi', {
        ...AUTH,
        from: '2026-03-31',
        to: '2026-03-01',
      })
    ).rejects.toThrow(/ters/);
  });

  it('satış yoksa KPI boş döner, sahte ciro üretmez', async () => {
    const kpi = await tauriInvoke<KpiSatiriDto[]>('get_staff_kpi', {
      ...AUTH,
      from: '2000-01-01',
      to: '2100-01-01',
    });
    for (const satir of kpi) {
      expect(satir.grossSalesCents).toBe(0);
      expect(satir.topProduct).toBeNull();
    }
  });

  it('veri yokken radar boş döner, uydurma bayrak üretmez', async () => {
    const bayraklar = await tauriInvoke('get_suspicious_activity', {
      ...AUTH,
      from: '2000-01-01',
      to: '2100-01-01',
    });
    expect(bayraklar).toEqual([]);
  });
});

describe('Görüntü yardımcıları', () => {
  it('kuruş TL olarak yazılır', () => {
    expect(money(0)).toContain('0,00');
    expect(money(123456)).toContain('1.234,56');
  });

  it('dönem kaydırma ayrı yıl sınırını doğru geçer', () => {
    expect(shiftPeriod('2026-01', -1)).toBe('2025-12');
    expect(shiftPeriod('2026-12', 1)).toBe('2027-01');
    expect(shiftPeriod('2026-06', 0)).toBe('2026-06');
  });

  it('beş maaş modelinin Türkçe karşılığı tanımlı', () => {
    for (const model of ['FIXED', 'COMMISSION', 'TIP', 'HOURLY', 'PROFIT_SHARE']) {
      expect(MODEL_LABELS[model]).toBeTruthy();
    }
  });
});