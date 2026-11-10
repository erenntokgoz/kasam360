'use client';

// Menü okunamadığında (sunucu veya ağ hatası) boş sayfa yerine yeniden deneme sunulur; hata geçici toast değildir.
export default function MenuError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="m-root m-state" role="alert">
      <h1>Menü şu an açılamıyor</h1>
      <button type="button" className="m-btn" onClick={reset}>
        Yeniden dene
      </button>
    </main>
  );
}
