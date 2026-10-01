/**
 * @module presentation/types
 *
 * Kasam360 POS & KDS sunum katmanı için merkezi tip sözleşmeleri.
 * Tüm IPC bağlamaları, store sözleşmeleri ve arayüz bileşenleri, Temiz Mimari
 * sınırı boyunca TypeScript yapısal bütünlüğünü korumak için bu tek doğru
 * kaynaktan içe aktarma yapmalıdır.
 *
 * ─── POS Domain Types ────────────────────────────────────────────────────────
 *   POSProduct         – Görüntüleme meta verileriyle zenginleştirilmiş katalog öğesi
 *   POSCategory        – Katalog gezinme kategorisi
 *   CartItem           – Aktif satış sepetindeki satır öğesi
 *   CartTotals         – Sepetin birleştirilmiş finansal özeti
 *   ItemDiscount       – Öğe bazında veya genel indirim tanımlayıcısı
 *   PaymentMethod      – Desteklenen ödeme yöntemleri
 *   SplitPaymentDetail – Çoklu yöntem ödemesinde bireysel bölünmüş ödeme
 *   PaymentPayload     – Tauri arka ucuna gönderilen eksiksiz IPC veri yükü
 *   PaymentResult      – Arka uçtan döndürülen uzlaşma yanıtı
 *
 * ─── KDS Domain Types ────────────────────────────────────────────────────────
 *   KitchenTicketStatus      – Mutfak biletleri için Kanban yaşam döngüsü durumları
 *   StationQueueItem         – Bir istasyon kuyruğundaki bireysel öğe ataması
 *   KdsOrder                 – Tam Mutfak Görüntüleme Sistemi (KDS) sipariş bileti
 *   KdsStationFilter         – KDS sorguları için istasyon filtresi
 *   KdsStatusFilter          – KDS sorguları için durum filtresi
 *   TicketStatusTransitionEvent – Bilet yaşam döngüsü geçişleri için denetim olayı
 */

// ─────────────────────────────────────────────────────────────────────────────
// POS DOMAIN TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POS kataloğunda satışa sunulan bir ürün.
 * Fiyatlandırma, vergi sınıflandırması, envanter meta verileri ve arayüz görüntüleme ipuçlarını içerir.
 */
export interface POSProduct {
  /** Benzersiz tanımlayıcı (UUID veya sabit bir slug). */
  id: string;
  /** Dahili stok tutma birimi (SKU) kodu. */
  sku: string;
  /** İsteğe bağlı barkod değeri (EAN-13, QR vb.). */
  barcode?: string;
  /** POS ürün ızgarasında ve fişlerde gösterilen görünen ad. */
  name: string;
  /** Yerel para biriminde (kuruş cinsinden) birim fiyat. */
  price: number;
  /** Tam sayı yüzdesi olarak KDV oranı (örn. 10 = %10). */
  taxRate: number;
  /** POSCategory.id ile eşleşen kategori slug'ı. */
  category: string;
  /** Ürün kartlarında gösterilen isteğe bağlı kısa açıklama. */
  description?: string;
  /** Ürünün şu anda satışa hazır olup olmadığı. */
  inStock: boolean;
  /** Mevcut stok seviyesi; undefined olması sınırsız veya izlenmiyor demektir. */
  stockQuantity?: number;
  /** Ürün kartı arka planı için isteğe bağlı Tailwind gradyan sınıfı. */
  color?: string;
  /** İsteğe bağlı ürün küçük resminin URL'si. */
  imageUrl?: string;
}

export interface ModifierOption {
  id: string;
  name: string;
  priceCents: number;
}

export interface ModifierGroup {
  id: string;
  name: string;
  isRequired: boolean;
  minSelections: number;
  maxSelections: number | null;
  options: ModifierOption[];
}

/**
 * POS ürün kataloğunu filtrelemek için kullanılan gezinme kategorisi.
 */
export interface POSCategory {
  /** Benzersiz kategori slug'ı (örn. 'sicak_icecekler'). */
  id: string;
  /** Kategori çubuğunda gösterilen, okunabilir etiket. */
  name: string;
  /** Simge kayıt sisteminde çözümlenen simge tanımlayıcısı (örn. 'COFFEE', 'GRID'). */
  icon?: string;
}

/**
 * Tek bir CartItem'a veya tüm sepete uygulanabilen indirim tanımlayıcısı.
 */
export interface ItemDiscount {
  /** İndirim hesaplama stratejisi. */
  type: 'PERCENTAGE' | 'FIXED_AMOUNT';
  /**
   * İndirimin sayısal büyüklüğü.
   * PERCENTAGE için: 0-100. FIXED_AMOUNT için: mutlak para birimi değeri.
   */
  value: number;
  /** Denetim amacıyla fişte saklanan isteğe bağlı, okunabilir neden. */
  reason?: string;
}

/**
 * Doğru gerçek zamanlı toplamlar ve fiş oluşturma için gereken tüm finansal alanları
 * izleyen, aktif POS sepetindeki tek bir satır öğesi.
 */
export interface CartItem {
  /** Ekleme zamanında oluşturulan sepete özel benzersiz UUID. */
  id: string;
  /** Kaynak katalog ürününe referans. */
  product: POSProduct;
  /** Sipariş edilen miktar (pozitif tam sayı). */
  quantity: number;
  /** Eklenme zamanındaki geçerli birim fiyat (anlık görüntü). */
  unitPrice: number;
  /** Bu satıra uygulanan vergi oranı (ekleme zamanında üründen alınan anlık görüntü). */
  taxRate: number;
  /** Vergi öncesi ara toplam (kuruş cinsinden). */
  subtotal: number;
  /** Hesaplanmış vergi tutarı (kuruş cinsinden): subtotal x (taxRate / 100). */
  taxAmount: number;
  /** Nihai satır toplamı (kuruş cinsinden): subtotal + taxAmount. */
  total: number;
  /** İsteğe bağlı öğe bazlı indirim (bu satır için genel indirimi geçersiz kılar). */
  discount?: ItemDiscount;
  /** İsteğe bağlı mutfak hazırlama talimatı. */
  note?: string;
  /** İsteğe bağlı ürün varyasyonları / modifiye edicileri */
  modifiers?: ModifierOption[];
}

/**
 * Tüm CartItems ve herhangi bir genel indirimden hesaplanan birleştirilmiş finansal özet.
 * Sepet başlığı, ödeme modülü ve fiş oluşturma tarafından kullanılır.
 */
export interface CartTotals {
  /** Tüm satır öğelerindeki toplam bireysel birim sayısı. */
  itemCount: number;
  /** Tüm satır ara toplamlarının toplamı (vergi öncesi, öğe indirimi sonrası). */
  subtotal: number;
  /** Tüm hesaplanmış vergi tutarlarının toplamı. */
  taxTotal: number;
  /** Uygulanan toplam indirim tutarı (satır öğesi + genel). */
  discountTotal: number;
  /** Ödenecek nihai tutar: subtotal + taxTotal - globalDiscount. */
  grandTotal: number;
}

/**
 * Desteklenen ödeme (tender) yöntemleri.
 * 'SPLIT', SplitPaymentDetail[] ile açıklanan çoklu yöntemli bir ödemeyi belirtir.
 */
export type PaymentMethod = 'CASH' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'MOBILE_PAY' | 'SPLIT';

/**
 * Bölünmüş ödemenin bir bacağı, yöntemi ve sunulan tutarı tanımlar.
 */
export interface SplitPaymentDetail {
  /** Bu bacak için ödeme yöntemi. */
  method: Exclude<PaymentMethod, 'SPLIT'>;
  /** Bu yöntem aracılığıyla sunulan tutar (kuruş cinsinden) (tüm bacaklardaki toplam grandTotal değerine eşit olmalıdır). */
  amount: number;
  /** İsteğe bağlı referans numarası (örn. kart onay kodu). */
  reference?: string;
}

/**
 * Uzlaşma için Tauri arka ucuna iletilen eksiksiz IPC veri yükü.
 * SQLite WAL kalıcılığını, mali fiş oluşturmayı ve KDS yönlendirmesini yönetir.
 */
export interface PaymentPayload {
  /** İzleme ve raporlama için istemci tarafından oluşturulan işlem UUID'si. */
  transactionId: string;
  /** İsteğe bağlı, okunabilir sipariş tanımlayıcısı (örn. 'ORD-123456'). */
  orderId?: string;
  /** Ödeme gönderiminin ISO-8601 zaman damgası. */
  timestamp: string;
  /** Birincil ödeme yöntemi; SPLIT çoklu yöntemi belirtir. */
  method: PaymentMethod;
  /** Müşteri tarafından sunulan toplam tutar (kuruş cinsinden). */
  amountTendered: number;
  /** Ödenecek genel toplam (CartTotals.grandTotal'dan). */
  totalAmount: number;
  /** İade edilecek hesaplanmış para üstü: max(0, amountTendered - totalAmount). */
  changeAmount: number;
  /** Uzlaşma zamanındaki tüm sepet satır öğelerinin anlık görüntüsü. */
  items: CartItem[];
  /** Bölünmüş ödeme bacakları, method === 'SPLIT' olduğunda gereklidir. */
  splits?: SplitPaymentDetail[];
  /** Fişe yazdırılan isteğe bağlı sipariş düzeyinde notlar. */
  notes?: string;
  /** İsteğe bağlı müşteri adı veya masa referansı. */
  customerRef?: string;
  /**
   * Anlık PIN onayından gelen tek kullanımlık jeton. Sepette indirim veya
   * ikram varsa **zorunludur**; backend jetonsuz indirimli ödemeyi reddeder.
   */
  approvalToken?: string;
  /** İndirim/ikram işleminde onay jetonunun sahibi (self-approval denetimi). */
  actorId?: string;
  /** Denetim ve vardiya mutabakatı için kasiyer tanımlayıcısı. */
  cashierId?: string;
  /** Terminal / POS cihazı tanımlayıcısı. */
  terminalId?: string;
  /** Aşama 2 etki eşitsizliği anahtarı (UUID). */
  idempotencyKey?: string;
  /** İsteğe bağlı sepet geneli indirim */
  globalDiscount?: ItemDiscount;
  /** İşlemin türü: ödeme, iade veya iptal. Varsayılan olarak PAYMENT. */
  transactionType?: 'PAYMENT' | 'REFUND' | 'CANCEL';
  /** İadeler veya geçersiz kılmalar için gereken onay kodu. */
  authorizationCode?: string;
  /** Ödemenin çevrimdışı işlenip işlenmediğini belirten bayrak. */
  isOffline?: boolean;
}

/**
 * Bir siparişi hemen ödeme almadan bir masaya göndermek için kullanılan veri yükü.
 */
export interface SubmitOrderPayload {
  orderId: string;
  tableId: string;
  items: CartItem[];
  notes?: string;
}

export interface VoidOrderPayload {
  orderId: string;
  tableId: string;
  reason: string;
  actorId: string;
  actorRole?: string;
  /**
   * Anlık PIN onayından gelen tek kullanımlık jeton. `managerPin` kaldırıldı:
   * düz PIN hiçbir komuta taşınmaz. Backend jetonsuz iptali reddeder.
   */
  approvalToken?: string;
}

/**
 * Tauri arka ucu (veya yerel çevrimdışı yedek) tarafından döndürülen uzlaşma yanıtı.
 */
export interface PaymentResult {
  /** Ödemenin kabul edilip edilmediği ve başarıyla kaydedilip kaydedilmediği. */
  success: boolean;
  /** Korelasyon için gönderilen transactionId'nin yankısı. */
  transactionId: string;
  /** Arka uç tarafından atanan mali fiş numarası (başarısızlık durumunda tanımsızdır). */
  fiscalReceiptNo?: string;
  /** Uzlaşma onayının ISO-8601 zaman damgası. */
  timestamp: string;
  /** Ödeme modülünde gösterilmek üzere, okunabilir durum mesajı. */
  message?: string;
  /** Başarısızlık durumunda yapılandırılmış hata detayı (müşteriye gösterilmez, loglama içindir). */
  errorDetail?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// KDS DOMAIN TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * KDS mutfak bileti veya bireysel istasyon öğesi için Kanban yaşam döngüsü durumları.
 *
 * Pending    => Bilet alındı, henüz başlanmadı
 * Preparing  => Mutfak aktif olarak bilet üzerinde çalışıyor
 * Ready      => Tüm öğeler tabaklandı, servis teslimi bekleniyor
 * Completed  => Bilet servis edildi ve kapatıldı
 * Cancelled  => Bilet tamamlanmadan önce iptal edildi
 */
export type KitchenTicketStatus =
  | 'Pending'
  | 'Preparing'
  | 'Ready'
  | 'Completed'
  | 'Cancelled'
  | 'PENDING'
  | 'PREPARING'
  | 'READY'
  | 'SERVED';

/**
 * Bir sipariş bileti içindeki belirli bir mutfak istasyonuna atanan tek bir menü öğesi.
 */
export interface StationQueueItem {
  /** Bilet içindeki benzersiz öğe tanımlayıcısı. */
  id: string;
  /** Bu öğenin ait olduğu üst KdsOrder.id. */
  orderId: string;
  /** Menü öğesinin görünen adı. */
  name: string;
  /** Sipariş edilen miktar. */
  quantity: number;
  /** Bu öğenin hazırlandığı hedef mutfak istasyonu. */
  station: string;
  /** Bu öğenin hedef mutfak istasyonunun benzersiz ID'si. */
  stationId?: string;
  /** Yük dengeleme için kullanılan göreceli hazırlık karmaşıklığı (1.0 = temel). */
  complexityWeight?: number;
  /** Bu bireysel öğenin mevcut yaşam döngüsü durumu. */
  status: KitchenTicketStatus;
  /** Kuyrukta kalma süresini izlemek için isteğe bağlı hazırlık zaman damgası (ISO-8601). */
  completedAt?: string;
  /** İsteğe bağlı serbest metin hazırlık talimatı. */
  notes?: string;
  /** İsteğe bağlı değiştirici listesi (örn. ['Ekstra Çedar', 'Az Pişmiş']). */
  modifiers?: string[];
}

/**
 * Tüm istasyon öğelerini toplayan ve siparişin alınmasından servis
 * tamamlanmasına kadar genel sipariş yaşam döngüsünü izleyen Tam KDS sipariş bileti.
 */
export interface KdsOrder {
  /** POS işleminin orderId'si ile eşleşen benzersiz sipariş tanımlayıcısı. */
  id: string;
  /** Biletlere yazdırılan, okunabilir sipariş numarası (örn. 'ORD-101'). */
  orderNumber: string;
  /** İsteğe bağlı masa numarası veya teslimat referansı. */
  tableNumber?: string;
  /** Mevcut genel bilet durumu (öğe durumlarından türetilir). */
  status: KitchenTicketStatus;
  /** Bu siparişe ait tüm istasyon kuyruğu öğeleri. */
  items: StationQueueItem[];
  /** Siparişin KDS tarafından alındığı ISO-8601 zaman damgası. */
  createdAt: string;
  /** Hazırlığın başladığı (ilk öğeye başlandığı) ISO-8601 zaman damgası. */
  startedAt?: string;
  /** Tüm öğelerin 'Hazır' olduğu ISO-8601 zaman damgası. */
  readyAt?: string;
  /** Siparişin 'Tamamlandı' veya 'İptal Edildi' olarak işaretlendiği ISO-8601 zaman damgası. */
  completedAt?: string;
  /** Servis önceliği sınıflandırması. */
  priority?: 'NORMAL' | 'VIP' | 'RUSH';
  /** Yük dengeleme gösterimi için isteğe bağlı birleştirilmiş karmaşıklık puanı. */
  totalComplexity?: number;
  /** Sunucudan gelen isteğe bağlı serbest metin notları (örn. alerji talimatları). */
  notes?: string;
  /** Siparişi veren sunucunun isteğe bağlı adı. */
  serverName?: string;
}

/**
 * KDS sipariş sorguları için istasyon filtresi.
 * 'ALL' her istasyondaki öğeleri döndürür.
 */
export type KdsStationFilter =
  | 'ALL'
  | 'Grill'
  | 'Fryer'
  | 'Pizza'
  | 'Bar'
  | 'Prep';

/**
 * KDS sipariş sorguları için durum filtresi.
 * 'ALL' her yaşam döngüsü durumundaki siparişleri döndürür.
 */
export type KdsStatusFilter =
  | 'ALL'
  | KitchenTicketStatus;

/**
 * Bir biletin yaşam döngüsü durumu her değiştiğinde yayılan değiştirilemez denetim olayı.
 * Deftere yazılır ve isteğe bağlı olarak Tauri IPC arka ucuna iletilir.
 */
export interface TicketStatusTransitionEvent {
  /** Durumu değişen KDS siparişi. */
  orderId: string;
  /** Geçişten önceki yaşam döngüsü durumu. */
  fromStatus: KitchenTicketStatus;
  /** Geçişten sonraki yaşam döngüsü durumu. */
  toStatus: KitchenTicketStatus;
  /** Geçişin ISO-8601 zaman damgası. */
  timestamp: string;
  /** Geçişi tetikleyen kullanıcı veya sistem aktörü. */
  actorId: string;
  /** Aktörün rolü (örn. 'Kasiyer', 'Sistem', 'MutfakPersoneli'). */
  actorRole: string;
}

export interface KdsStationDto {
  id: string;
  name: string;
  description?: string;
}

export interface UpdateKdsItemStatusPayload {
  itemId: string;
  status: string;
}

export interface KdsOfflineQueuedAction {
  id?: string;
  type?: 'TICKET_STATUS' | 'ITEM_STATUS';
  orderId?: string;
  itemId?: string;
  fromStatus?: string;
  toStatus?: string;
  status?: string;
  timestamp: string;
  actorId: string;
  actorRole: string;
  queuedAt: number;
  retryCount?: number;
}
