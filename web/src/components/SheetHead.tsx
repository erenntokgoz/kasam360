import Image from 'next/image';

const SERIAL = '000360';

interface SheetHeadProps {
  copy?: string;
  colored?: boolean;
}

// Kopya nüshalar aynı seri numarasını taşır ve tek renk basılır; renkli logo yalnız asıl yapraktadır.
export function SheetHead({ copy, colored = false }: SheetHeadProps) {
  const logo = colored ? '/logo/kasam360-logo-renkli.svg' : '/logo/kasam360-logo-siyah.svg';

  return (
    <div className="sheet-head">
      <Image src={logo} alt="KASAM360" width={143} height={40} className="sheet-logo" />
      <div className="flex flex-wrap items-baseline gap-x-4">
        {copy && <span className="printed">{copy}</span>}
        <span className="printed">Adisyon No</span>
        <span className="serial">{SERIAL}</span>
      </div>
    </div>
  );
}
