import Link from 'next/link';
import { PageSheet } from '@/components/PageSheet';

export default function NotFound() {
  return (
    <PageSheet tone="pink" copy="Mutfak nüshası">
      <h1 className="sheet-title">Bu yaprak defterde yok.</h1>
      <div>
        <Link href="/" className="btn">
          Ana Sayfaya Dön
        </Link>
      </div>
    </PageSheet>
  );
}
