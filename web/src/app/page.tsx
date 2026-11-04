import type { Metadata } from 'next';
import { JsonLd } from '@/components/JsonLd';
import { PadStack, type PadSheet } from '@/components/PadStack';
import { BackBoardSheet } from '@/components/sheets/BackBoardSheet';
import { MoneySheet } from '@/components/sheets/MoneySheet';
import { OrderSheet } from '@/components/sheets/OrderSheet';
import { OutageSheet } from '@/components/sheets/OutageSheet';
import { TicketSheet } from '@/components/sheets/TicketSheet';
import { siteConfig } from '@/content/siteConfig';

export const metadata: Metadata = {
  title: { absolute: 'KASAM360: İnternetsiz Çalışan Adisyon Programı' },
  alternates: { canonical: '/' },
};

const sheets: PadSheet[] = [
  { id: 'adisyon', label: 'Adisyon', tone: 'white' },
  { id: 'kesinti', label: 'Kesinti', tone: 'pink' },
  { id: 'servis', label: 'Servis', tone: 'yellow' },
  { id: 'kasa', label: 'Kasa', tone: 'green' },
  { id: 'durum', label: 'Durum', tone: 'board' },
];

// Fiyat ve puan yazılmaz; yapılandırılmış veri sitede görünmeyen bir şey vaat edemez.
const softwareSchema = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: siteConfig.name,
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Windows',
  description: siteConfig.description,
  url: siteConfig.url,
  inLanguage: 'tr',
};

export default function HomePage() {
  return (
    <>
      <JsonLd data={softwareSchema} />
      <PadStack sheets={sheets}>
        <OrderSheet />
        <OutageSheet />
        <TicketSheet />
        <MoneySheet />
        <BackBoardSheet />
      </PadStack>
    </>
  );
}
