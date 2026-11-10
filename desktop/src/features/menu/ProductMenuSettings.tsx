import React, { useEffect, useRef, useState } from 'react';
import { errorText } from '../../lib/cariInput';
import { IMAGE_ACCEPT, prepareProductImage } from '../../lib/productImage';
import { useMenuExtrasStore } from '../../stores/menuExtrasStore';
import { useMenuStore } from '../../stores/menuStore';
import { useStationStore } from '../../stores/stationStore';
import type { ProductDto } from '../../types/menu';
import { Button } from '../../ui/Button';
import { ErrorToast } from '../../ui/ErrorToast';
import { Modal } from '../../ui/Modal';

const field = 'w-full min-h-12 rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] px-3 text-sm';

/** Ürün fiyatı ve reçetesi bu karttan değiştirilemez; burada menü bilgileri düzenlenir. */
export const ProductMenuSettings: React.FC<{
  product: ProductDto;
  onBack: () => void;
  onDelete: () => void;
}> = ({ product, onBack, onDelete }) => {
  const extras = useMenuExtrasStore((state) => state.products[product.id]);
  const saveExtras = useMenuExtrasStore((state) => state.save);
  const saveProduct = useMenuStore((state) => state.saveProduct);
  const stations = useStationStore((state) => state.stations);
  const loadStations = useStationStore((state) => state.load);
  const [station, setStation] = useState<string | null>(null);
  const [tax, setTax] = useState(product.taxRateBp ?? 1000);
  const [description, setDescription] = useState(product.description ?? '');
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const currentFile = useRef<File | null>(null);

  useEffect(() => {
    void loadStations().catch((caught: unknown) => setError(errorText(caught)));
    return () => { currentFile.current = null; };
  }, [loadStations]);

  const pickImage = (file: File | undefined) => {
    if (!file) return;
    currentFile.current = file;
    setReading(false);
    setImage(null);
    setError(null);
    setReading(true);
    prepareProductImage(file)
      .then((dataUrl) => { if (currentFile.current === file) setImage(dataUrl); })
      .catch((caught: unknown) => { if (currentFile.current === file) setError(errorText(caught)); })
      .finally(() => { if (currentFile.current === file) setReading(false); });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (inFlight.current || reading) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    let productSaved = false;
    try {
      const nextDescription = description.trim();
      const extrasChanged = image !== null || (station !== null && station !== (extras?.station ?? ''));
      if (extrasChanged && !extras) throw new Error('Menü ayarları okunamadı. Ürün listesini yeniden açın.');
      if (tax !== (product.taxRateBp ?? 1000) || nextDescription !== (product.description ?? '')) {
        if (!await saveProduct({ taxRateBp: tax, description: nextDescription }, product.id)) {
          throw new Error(useMenuStore.getState().error ?? 'Ürün bilgileri kaydedilemedi.');
        }
        productSaved = true;
      }
      if (extrasChanged && extras) {
        await saveExtras({ id: product.id, station: (station ?? extras.station) || null, onWeb: extras.onWeb, imageUrl: image });
        if (image) useMenuStore.setState((state) => ({
          products: state.products.map((item) => item.id === product.id ? { ...item, imageUrl: image } : item),
        }));
      }
      onBack();
    } catch (caught) {
      setError(productSaved ? `KDV ve açıklama kaydedildi. Menü bilgileri tamamlanamadı. ${errorText(caught)}` : errorText(caught));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const preview = image ?? product.imageUrl;

  return (
    <Modal cardFlow isOpen title="Ürünü Düzenle" subtitle={product.name} maxWidth="md"
      onClose={() => { if (!inFlight.current) onBack(); }}>
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <fieldset className="grid gap-3" disabled={busy}>
          <label className="grid gap-1 text-sm">KDV Oranı
            <select className={field} value={tax} onChange={(event) => setTax(Number(event.target.value))}>
              {[...new Set([0, 100, 1000, 2000, tax])].sort((a, b) => a - b)
                .map((rate) => <option key={rate} value={rate}>%{rate / 100}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm">Ürün Açıklaması
            <textarea className={`${field} min-h-24 p-3`} value={description}
              onChange={(event) => setDescription(event.target.value)} />
          </label>
          <label className="grid gap-1 text-sm">Ürün Görseli
            <input type="file" accept={IMAGE_ACCEPT} className={`${field} py-2`}
              onChange={(event) => pickImage(event.target.files?.[0])} />
          </label>
          {preview ? <img src={preview} alt={product.name} className="w-full max-h-40 object-contain rounded-lg" /> : null}
          <label className="grid gap-1 text-sm">İstasyon
            <select className={field} value={station ?? extras?.station ?? ''} onChange={(event) => setStation(event.target.value)}>
              <option value="">Kategorinin istasyonu</option>
              {extras?.station && !stations.some((item) => item.name === extras.station)
                ? <option value={extras.station}>{extras.station}</option> : null}
              {stations.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
            </select>
          </label>
        </fieldset>
        <ErrorToast message={error} />
        <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-3">
          <Button type="button" variant="danger" className="mr-auto" disabled={busy} onClick={onDelete}>Sil</Button>
          <Button type="button" disabled={busy} onClick={onBack}>Vazgeç</Button>
          <Button type="submit" variant="primary" isLoading={busy} disabled={reading}>Kaydet</Button>
        </div>
      </form>
    </Modal>
  );
};
