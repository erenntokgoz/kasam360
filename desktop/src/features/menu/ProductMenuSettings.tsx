import React, { useEffect, useState } from 'react';
import { errorText } from '../../lib/cariInput';
import { useMenuExtrasStore } from '../../stores/menuExtrasStore';
import { useStationStore } from '../../stores/stationStore';
import type { ProductDto } from '../../types/menu';
import { Button } from '../../ui/Button';

const field = 'w-full min-h-12 rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] px-3 text-sm';

/** İstasyon, web menüsü ve görsel satış tutarını değiştirmez; ürün kaydından ayrı kaydedilir. */
export const ProductMenuSettings: React.FC<{ product: ProductDto }> = ({ product }) => {
  const extras = useMenuExtrasStore((state) => state.products[product.id]);
  const save = useMenuExtrasStore((state) => state.save);
  const stations = useStationStore((state) => state.stations);
  const loadStations = useStationStore((state) => state.load);
  const [station, setStation] = useState('');
  const [onWeb, setOnWeb] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadStations().catch(() => undefined);
  }, [loadStations]);

  useEffect(() => {
    setStation(extras?.station ?? '');
    setOnWeb(extras?.onWeb ?? false);
    setImage(null);
  }, [extras]);

  const pickImage = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImage(typeof reader.result === 'string' ? reader.result : null);
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    setError(null);
    try {
      await save({ id: product.id, station: station || null, onWeb, imageUrl: image });
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  const preview = image ?? product.imageUrl;

  return (
    <div className="space-y-3">
      <select aria-label="İstasyon" className={field} value={station} onChange={(event) => setStation(event.target.value)}>
        <option value="">Kategorinin istasyonu</option>
        {stations.map((item) => (
          <option key={item.id} value={item.name}>{item.name}</option>
        ))}
      </select>
      <label className="flex min-h-12 items-center gap-2 text-sm">
        <input type="checkbox" checked={onWeb} onChange={(event) => setOnWeb(event.target.checked)} />
        Web menüsünde göster
      </label>
      {preview ? <img src={preview} alt={product.name} className="w-full max-h-48 object-cover rounded-lg" /> : null}
      <label className="flex min-h-12 items-center text-sm font-semibold cursor-pointer">
        <input type="file" accept="image/*" className="sr-only" onChange={(event) => pickImage(event.target.files?.[0])} />
        {preview ? 'Görseli değiştir' : 'Görsel ekle'}
      </label>
      {error ? <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">{error}</p> : null}
      <Button variant="secondary" className="w-full min-h-12" onClick={() => void submit()}>Menü Ayarlarını Kaydet</Button>
    </div>
  );
};
