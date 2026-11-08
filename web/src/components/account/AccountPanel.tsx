'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { authGet, authPost, type FieldErrors } from '@/lib/authApi';
import { tenantRequest } from '@/lib/tenantApi';
import { FormError, SecureForm, SubmitButton, TextField } from './FormParts';
import { TenantRightsPanel } from './TenantRightsPanel';

interface Tenant {
  tenantId: string;
  name: string;
  country: string;
  currency: string;
  timeZone: string;
  status: 'active';
  version: number;
  createdAt: string;
}

interface Membership { membershipId: string; userId: string; tenantId: string; role: 'OWNER'; status: 'active'; version: number; createdAt: string }
interface TenantEntry { tenant: Tenant; membership: Membership }
interface SyncReview {
  operationId: string;
  deviceId: string;
  operationSummary: string;
  reportedCreatedAt: string;
  receivedAt: string;
  waitingReason: string;
}

function TenantPanel({ userId }: { userId: string }) {
  const [entries, setEntries] = useState<TenantEntry[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reviews, setReviews] = useState<SyncReview[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [reviewReasons, setReviewReasons] = useState<Record<string, string>>({});
  const [resolvingId, setResolvingId] = useState('');

  const load = async () => {
    setError('');
    try {
      const result = await tenantRequest<{ tenants: TenantEntry[] }>('/v1/tenants');
      setEntries(result.tenants);
      setSelectedId((current) => result.tenants.some(({ tenant }) => tenant.tenantId === current) ? current : '');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'İşletmeler yüklenemedi.');
    } finally { setReady(true); }
  };

  useEffect(() => {
    setEntries([]);
    setSelectedId('');
    setReady(false);
    void load();
  // userId değiştiğinde seçili tenant eski hesaptan taşınmasın.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true); setError(''); setNotice('');
    const form = new FormData(formElement);
    try {
      const result = await tenantRequest<TenantEntry>('/v1/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ businessName: form.get('tenantName'), country: 'TR', currency: 'TRY', timeZone: 'Europe/Istanbul' }),
      });
      setEntries((current) => [...current, result]);
      setSelectedId(result.tenant.tenantId);
      setNotice('İşletme oluşturuldu ve OWNER olarak bağlandınız.');
      formElement.reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'İşletme oluşturulamadı.');
    } finally { setBusy(false); }
  };

  const selectTenant = async (tenantId: string) => {
    setSelectedId('');
    setError(''); setNotice('');
    if (!tenantId) return;
    try {
      const result = await tenantRequest<TenantEntry>(`/v1/tenants/${encodeURIComponent(tenantId)}`);
      if (result.membership.userId !== userId || result.tenant.tenantId !== tenantId) throw new Error('İşletme hesabınızla eşleşmiyor.');
      setSelectedId(tenantId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'İşletme seçilemedi.');
    }
  };

  const selected = entries.find(({ tenant }) => tenant.tenantId === selectedId)?.tenant;

  useEffect(() => {
    let cancelled = false;
    setReviews([]);
    setReviewError('');
    if (!selectedId) return () => { cancelled = true; };
    setReviewLoading(true);
    void tenantRequest<{ tenantId: string; pending: SyncReview[] }>(`/v1/tenants/${encodeURIComponent(selectedId)}/sync/quarantine`)
      .then((result) => {
        if (result.tenantId !== selectedId) throw new Error('İnceleme listesi seçili işletmeyle eşleşmiyor.');
        if (!cancelled) setReviews(result.pending);
      })
      .catch((caught: unknown) => { if (!cancelled) setReviewError(caught instanceof Error ? caught.message : 'Bekleyen incelemeler yüklenemedi.'); })
      .finally(() => { if (!cancelled) setReviewLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

  const resolveReview = async (review: SyncReview, decision: 'accept' | 'reject') => {
    const reason = reviewReasons[review.operationId]?.trim() ?? '';
    if (reason.length < 3 || reason.length > 300) {
      setReviewError('Karar gerekçesi 3–300 karakter olmalı.');
      return;
    }
    setResolvingId(review.operationId);
    setReviewError('');
    try {
      await tenantRequest(`/v1/tenants/${encodeURIComponent(selectedId)}/sync/quarantine/${encodeURIComponent(review.operationId)}/resolve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, reason }),
      });
      setReviews((current) => current.filter((item) => item.operationId !== review.operationId));
      setReviewReasons((current) => { const next = { ...current }; delete next[review.operationId]; return next; });
      setNotice(decision === 'accept' ? 'Kayıt kabul edildi; bağlı cihaz eşitlemede aynı işlemi güvenle tamamlayacak.' : 'Kayıt reddedildi; cihazdaki yerel veri korunacak ve bulut kuyruğu bu işlemi yeniden göndermeyecek.');
    } catch (caught) {
      setReviewError(caught instanceof Error ? caught.message : 'Karar kaydedilemedi. Listeyi yenileyip tekrar deneyin.');
    } finally { setResolvingId(''); }
  };

  return (
    <section className="k-panel k-stack" aria-labelledby="acc-businesses">
      <h2 id="acc-businesses" className="k-section-title" style={{ margin: 0 }}>İşletmeleriniz</h2>
      {!ready && !error && <p className="k-muted" role="status">İşletmeleriniz yükleniyor…</p>}
      {ready && entries.length === 0 && <p className="k-empty">Bu hesaba bağlı işletme yok. Yeni bir işletme oluşturabilirsiniz.</p>}
      {entries.length > 0 && (
        <div className="k-stack">
          <div className="k-field">
            <label htmlFor="tenant-select">İşletme bağlamı</label>
            <select id="tenant-select" className="k-input" value={selectedId} onChange={(event) => void selectTenant(event.target.value)}>
              <option value="">İşletme seçin</option>
              {entries.map(({ tenant }) => <option key={tenant.tenantId} value={tenant.tenantId}>{tenant.name}</option>)}
            </select>
          </div>
          {selected && <p className="k-notice" role="status">Seçili işletme: <strong>{selected.name}</strong> · {selected.tenantId}</p>}
          {selected && <TenantRightsPanel tenantId={selected.tenantId} />}
          {selected && (
            <section className="k-stack" aria-labelledby="sync-review-heading">
              <div>
                <h3 id="sync-review-heading" className="k-section-title" style={{ marginBottom: 4 }}>Bekleyen eşitleme incelemeleri</h3>
                <p className="k-field-hint">Bu kayıtlar yerel kasada korunur; karar verilene kadar işletme verisine uygulanmaz.</p>
              </div>
              {reviewLoading && <p className="k-muted" role="status">Bekleyen kayıtlar yükleniyor…</p>}
              {reviewError && <FormError message={reviewError} />}
              {!reviewLoading && !reviewError && reviews.length === 0 && <p className="k-empty">Bu işletmede bekleyen eşitleme incelemesi yok.</p>}
              {reviews.map((review) => (
                <article className="k-panel k-stack" key={review.operationId} aria-label="Bekleyen eşitleme kaydı">
                  <p><strong>Cihaz</strong> · {review.deviceId}</p>
                  <p><strong>İşlem</strong> · {review.operationSummary}</p>
                  <p><strong>Cihazın bildirdiği tarih</strong> · {new Date(review.reportedCreatedAt).toLocaleString('tr-TR')}</p>
                  <p><strong>Sunucuya ulaştı</strong> · {new Date(review.receivedAt).toLocaleString('tr-TR')}</p>
                  <p className="k-alert" role="note">{review.waitingReason}</p>
                  <label className="k-field">
                    <span>Karar gerekçesi</span>
                    <textarea className="k-input" rows={3} maxLength={300} minLength={3} required
                      aria-label={`${review.operationId} karar gerekçesi`}
                      value={reviewReasons[review.operationId] ?? ''}
                      onChange={(event) => setReviewReasons((current) => ({ ...current, [review.operationId]: event.target.value }))} />
                  </label>
                  <div className="k-row">
                    <button type="button" className="k-btn k-btn-ink" disabled={resolvingId !== '' || (reviewReasons[review.operationId]?.trim().length ?? 0) < 3}
                      onClick={() => void resolveReview(review, 'accept')}>{resolvingId === review.operationId ? 'Kaydediliyor…' : 'Kabul et'}</button>
                    <button type="button" className="k-btn k-btn-line" disabled={resolvingId !== '' || (reviewReasons[review.operationId]?.trim().length ?? 0) < 3}
                      onClick={() => void resolveReview(review, 'reject')}>Reddet</button>
                  </div>
                </article>
              ))}
            </section>
          )}
        </div>
      )}
      {error && <FormError message={error} />}
      {notice && <p className="k-notice" role="status">{notice}</p>}
      <form className="k-stack" onSubmit={(event) => void create(event)}>
        <div className="k-field">
          <label htmlFor="tenantName">Yeni işletme adı</label>
          <input id="tenantName" name="tenantName" className="k-input" required maxLength={120} autoComplete="organization" aria-describedby="tenantName-hint" />
        </div>
        <p id="tenantName-hint" className="k-field-hint">Bu kayıt gerçek işletme kaydıdır. Profil bilgilerinizdeki işletme adı yalnız hesap profil etiketidir.</p>
        <div className="k-row"><button type="submit" className="k-btn k-btn-ink" disabled={busy}>{busy ? 'Oluşturuluyor…' : 'İşletme oluştur'}</button></div>
      </form>
    </section>
  );
}

interface AccountUser {
  id: string;
  name: string;
  email: string;
  businessName?: string | null;
  phone?: string | null;
}

interface Session {
  user: AccountUser;
}

function ProfileForm({ user }: { user: AccountUser }) {
  const [isBusy, setIsBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice('');
    setErrors({});
    setFormError('');
    setIsBusy(true);
    const data = new FormData(event.currentTarget);
    const result = await authPost('/update-user', {
      name: data.get('name'),
      businessName: data.get('businessName'),
      phone: data.get('phone'),
    });
    setIsBusy(false);
    if (result.ok) setNotice('Bilgileriniz kaydedildi.');
    setErrors(result.errors ?? {});
    setFormError(result.error ?? '');
  };

  return (
    <form onSubmit={handleSubmit} className="k-stack">
      <div className="k-grid-2">
        <TextField id="name" label="Ad soyad" autoComplete="name" defaultValue={user.name} error={errors.name} />
        <TextField id="businessName" label="Profil işletme adı" autoComplete="organization" defaultValue={user.businessName ?? ''} error={errors.businessName}
          hint="Hesap profilinizdeki etikettir; işletme kaydı ve seçili işletme bağlamı değildir." />
        <TextField id="email" label="E-posta" type="email" value={user.email} readOnly />
        <TextField id="phone" label="Telefon (isteğe bağlı)" type="tel" inputMode="tel" autoComplete="tel" defaultValue={user.phone ?? ''} error={errors.phone} />
      </div>
      <FormError message={formError} />
      {notice && <p className="k-notice" role="status">{notice}</p>}
      <div className="k-row">
        <button type="submit" className="k-btn k-btn-ink" disabled={isBusy}>
          {isBusy ? 'Kaydediliyor…' : 'Bilgileri kaydet'}
        </button>
      </div>
    </form>
  );
}

function ChangePasswordForm() {
  const [isOpen, setIsOpen] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [formError, setFormError] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice('');
    setFormError('');
    setIsBusy(true);
    const form = event.currentTarget;
    const data = new FormData(form);
    const result = await authPost('/change-password', {
      currentPassword: data.get('currentPassword'),
      newPassword: data.get('newPassword'),
      revokeOtherSessions: true,
    });
    setIsBusy(false);
    if (result.ok) {
      form.reset();
      setNotice('Şifreniz değişti. Diğer cihazlardaki oturumlar kapatıldı.');
    } else {
      setFormError(result.error ?? '');
    }
  };

  // Şifre değiştirmek isteğe bağlıdır; hesaba ilk gelene mevcut şifre sorulmaz.
  if (!isOpen) {
    return (
      <div className="k-row">
        <button type="button" className="k-btn k-btn-line" onClick={() => setIsOpen(true)}>
          Şifre değiştir
        </button>
      </div>
    );
  }

  return (
    <SecureForm fallbackPath="/hesabim" onSubmit={handleSubmit} className="k-stack">
      <div className="k-grid-2">
        <TextField id="currentPassword" label="Mevcut şifre" type="password" autoComplete="current-password" required />
        <TextField id="newPassword" label="Yeni şifre (en az 8 karakter)" type="password" autoComplete="new-password" required />
      </div>
      <FormError message={formError} />
      {notice && <p className="k-notice" role="status">{notice}</p>}
      <div className="k-row">
        <SubmitButton className="k-btn k-btn-ink" disabled={isBusy}>
          {isBusy ? 'Kaydediliyor…' : 'Şifreyi değiştir'}
        </SubmitButton>
        <button type="button" className="k-btn k-btn-ghost" onClick={() => setIsOpen(false)}>
          Vazgeç
        </button>
      </div>
    </SecureForm>
  );
}

function DeleteAccount({ hasPassword }: { hasPassword: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');
    setIsBusy(true);
    const password = new FormData(event.currentTarget).get('deletePassword');
    const result = await authPost('/delete-user', hasPassword ? { password } : {});
    if (result.ok) {
      window.location.assign('/');
      return;
    }
    setIsBusy(false);
    setFormError(result.error ?? '');
  };

  if (!isOpen) {
    return (
      <div className="k-row">
        <button type="button" className="k-btn k-btn-danger" onClick={() => setIsOpen(true)}>
          Hesabı sil
        </button>
      </div>
    );
  }

  return (
    <SecureForm fallbackPath="/hesabim" onSubmit={handleSubmit} className="k-stack">
      <p className="k-alert" style={{ margin: 0 }}>Hesabınız ve bilgileriniz kalıcı olarak silinir. Bu işlem geri alınamaz.</p>
      {hasPassword && <TextField id="deletePassword" label="Şifreniz" type="password" autoComplete="current-password" required />}
      <FormError message={formError} />
      <div className="k-row">
        <SubmitButton className="k-btn k-btn-danger" disabled={isBusy}>
          {isBusy ? 'Siliniyor…' : 'Hesabı kalıcı olarak sil'}
        </SubmitButton>
        <button type="button" className="k-btn k-btn-ghost" onClick={() => setIsOpen(false)}>
          Vazgeç
        </button>
      </div>
    </SecureForm>
  );
}

export function AccountPanel() {
  const [session, setSession] = useState<Session | null>(null);
  const [hasPassword, setHasPassword] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [justVerified, setJustVerified] = useState(false);

  useEffect(() => {
    void (async () => {
      const result = await authGet<Session | null>('/get-session');
      if (!result.ok) {
        setLoadError(result.error ?? '');
        return;
      }
      if (!result.data) {
        // Doğrulama bağlantısı hatası da buraya döner; açıklaması giriş ekranında gösterilir.
        window.location.replace(`/giris${window.location.search}`);
        return;
      }
      const accounts = await authGet<{ providerId: string }[]>('/list-accounts');
      setHasPassword(accounts.data?.some((account) => account.providerId === 'credential') ?? false);
      setSession(result.data);
      if (new URLSearchParams(window.location.search).has('dogrulandi')) {
        setJustVerified(true);
        window.history.replaceState(null, '', '/hesabim');
      }
    })();
  }, []);

  const signOut = async () => {
    await authPost('/sign-out', {});
    window.location.assign('/');
  };

  if (loadError) return <FormError message={loadError} />;
  if (!session) return <p className="k-muted" role="status">Hesabınız yükleniyor…</p>;

  return (
    <div className="k-account">
      {justVerified && (
        <div className="k-done" role="status">
          <b>Hesabınız açıldı.</b>
          <p>E-postanız doğrulandı. Aşağıdaki bilgileri kontrol edin.</p>
        </div>
      )}
      <section className="k-panel" aria-labelledby="acc-profile">
        <h2 id="acc-profile" className="k-section-title">Bilgileriniz</h2>
        <ProfileForm user={session.user} />
      </section>
      <TenantPanel key={session.user.id} userId={session.user.id} />
      <section className="k-panel" aria-labelledby="acc-security">
        <h2 id="acc-security" className="k-section-title">Giriş ve güvenlik</h2>
        {hasPassword ? <ChangePasswordForm /> : <p className="k-muted" style={{ margin: 0 }}>Bu hesaba Google ile giriş yapıyorsunuz.</p>}
      </section>
      <section className="k-panel" aria-labelledby="acc-sub">
        <h2 id="acc-sub" className="k-section-title">Abonelik</h2>
        <dl className="k-dl">
          <div>
            <dt>Durum</dt>
            <dd>Yakında</dd>
          </div>
        </dl>
      </section>
      <section className="k-panel k-row" aria-label="Oturum ve hesap" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="k-btn k-btn-line" onClick={() => void signOut()}>
          Çıkış yap
        </button>
        <DeleteAccount hasPassword={hasPassword} />
      </section>
    </div>
  );
}
