import React from 'react';
import { Users, Truck, UserCog, Zap, Crown } from 'lucide-react';
import { formatCurrency } from '../helpers';

/**
 * Beş ayristirilmis rehberin alan katalogu (B1.1 / B1.2).
 * Her tipin gosterecegi alanlar ayri sabit tablosunda tutulur; alan
 * kaydirma testi bu tabloyu dogrudan okur.
 */
export const DIRECTORY_GUIDE: Record<
  string,
  { label: string; icon: typeof Users; fields: string[]; accent: string }
> = {
  CUSTOMER: {
    label: 'Müşteri Veresiye',
    icon: Users,
    fields: ['ad', 'telefon', 'eposta', 'acilis_bakiyesi', 'notlar'],
    accent: 'text-[#007AFF] dark:text-blue-400',
  },
  SUPPLIER: {
    label: 'Toptancı Firma',
    icon: Truck,
    fields: ['firma_adi', 'yetkili_kisi', 'telefon', 'vergi_no', 'acilis_bakiyesi', 'notlar'],
    accent: 'text-amber-600 dark:text-amber-400',
  },
  STAFF: {
    label: 'Personel Finansı',
    icon: UserCog,
    fields: ['ad_soyad', 'pozisyon', 'telefon', 'tc_kimlik', 'acilis_bakiyesi', 'notlar'],
    accent: 'text-emerald-600 dark:text-emerald-400',
  },
  FIXED_EXPENSE: {
    label: 'Sabit Gider Adresi',
    icon: Zap,
    fields: ['gider_adi', 'tedarikci', 'telefon', 'acilis_bakiyesi', 'notlar'],
    accent: 'text-purple-600 dark:text-purple-400',
  },
  OWNER_PERSONAL: {
    label: 'Patron Şahsi Hesabı',
    icon: Crown,
    fields: ['ad', 'acilis_bakiyesi', 'notlar'],
    accent: 'text-purple-600 dark:text-purple-400',
  },
};

export const FIELD_LABELS: Record<string, string> = {
  ad: 'Ad / Ünvan',
  ad_soyad: 'Ad Soyad',
  firma_adi: 'Firma Adı',
  yetkili_kisi: 'Yetkili Kişi',
  telefon: 'Telefon',
  eposta: 'E-posta',
  vergi_no: 'Vergi No',
  tc_kimlik: 'T.C. Kimlik',
  pozisyon: 'Pozisyon',
  gider_adi: 'Gider Adı',
  tedarikci: 'Tedarikçi',
  acilis_bakiyesi: 'Açılış Bakiyesi',
  notlar: 'Notlar',
};

export interface DirectoryRecord {
  id: string;
  name: string;
  type: string;
  phone?: string | null;
  email?: string | null;
  balanceCents?: number;
  notes?: string | null;
}

interface DirectoryGuideProps {
  type: string;
  record: DirectoryRecord;
}

/**
 * Secili rehber tipinin alan listesini ve bakiyesini gosterir.
 * Alan sirasi DIRECTORY_GUIDE sabitinden gelir, JSX icinde dagitik degildir.
 */
export const DirectoryGuide: React.FC<DirectoryGuideProps> = ({ type, record }) => {
  const guide = DIRECTORY_GUIDE[type] ?? DIRECTORY_GUIDE.CUSTOMER;
  const Icon = guide.icon;

  return (
    <div
      data-testid={`directory-guide-${type}`}
      className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] rounded-3xl p-5 shadow-xl"
    >
      <div className="flex items-center gap-2.5 mb-4">
        <div className="p-2 dark:bg-white/[0.06] bg-black/[0.04] rounded-2xl border dark:border-white/10 border-black/[0.08]">
          <Icon size={18} className={guide.accent} />
        </div>
        <div>
          <h3 className="text-base font-semibold dark:text-white text-zinc-900">{record.name}</h3>
          <p className="text-xs dark:text-zinc-400 text-zinc-500">{guide.label}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {guide.fields.map((field) => (
          <div
            key={field}
            data-testid={`guide-field-${field}`}
            className="p-3 rounded-2xl dark:bg-white/[0.03] bg-white/60 border dark:border-white/5 border-black/[0.06]"
          >
            <p className="text-[11px] uppercase tracking-wider dark:text-zinc-400 text-zinc-500">
              {FIELD_LABELS[field] ?? field}
            </p>
            <p className="text-sm dark:text-white text-zinc-900">
              {field === 'acilis_bakiyesi'
                ? formatCurrency(record.balanceCents ?? null)
                : field === 'telefon'
                ? record.phone || '-'
                : field === 'eposta'
                ? record.email || '-'
                : field === 'notlar'
                ? record.notes || '-'
                : field === 'ad' || field === 'ad_soyad' || field === 'firma_adi' || field === 'gider_adi'
                ? record.name
                : '-'}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DirectoryGuide;