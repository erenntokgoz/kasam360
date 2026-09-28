/**
 * Web Audio API Sentetik Ses Motoru (Apple Pay Ding, Mutfak Çanı, Haptik Uyarı, Hata ve PIN Tock)
 * Harici MP3/WAV bağımlılığı olmaksızın tarayıcı AudioContext osilatörleriyle saf sentetik tonlar üretir.
 */

class SoundService {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;

  constructor() {
    if (typeof window !== 'undefined') {
      this.isMuted = localStorage.getItem('kasam360_sound_muted') === 'true';
    }
  }

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (typeof window !== 'undefined') {
      localStorage.setItem('kasam360_sound_muted', String(muted));
    }
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  /**
   * Apple Pay Çift Harmonik Ding (Ödeme Başarılı)
   * 1046.5 Hz (C6) -> 1318.5 Hz (E6) saf sinüs dalgaları
   */
  public playPaymentSuccess(): void {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(1046.5, now);
    osc1.frequency.exponentialRampToValueAtTime(1318.5, now + 0.08);

    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(2093.0, now);
    osc2.frequency.exponentialRampToValueAtTime(2637.0, now + 0.08);

    gainNode.gain.setValueAtTime(0.3, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.45);
    osc2.stop(now + 0.45);
  }

  public playSuccessChime(): void {
    this.playPaymentSuccess();
  }

  /**
   * Pirinç Mutfak Çanı (Yeni Sipariş / KDS Bildirimi)
   * 880 Hz (A5) -> 1760 Hz harmonikli rezonans
   */
  public playKitchenBell(): void {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.setValueAtTime(1174.6, now + 0.06);

    gainNode.gain.setValueAtTime(0.25, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.6);
  }

  /**
   * Haptik Bas Tonu (Uyarı / Dikkat)
   * 180 Hz derin bas impuls
   */
  public playWarning(): void {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.15);

    gainNode.gain.setValueAtTime(0.35, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.18);
  }

  /**
   * Testere Bas Tonu (Hata / Geçersiz PIN / Kasa Açığı)
   * 130 Hz hafif testere tonu
   */
  public playError(): void {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(130, now);
    osc.frequency.setValueAtTime(98, now + 0.12);

    gainNode.gain.setValueAtTime(0.2, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.28);
  }

  /**
   * 5ms Hafif "Tock" Sesi (PIN tuş takımı basışları)
   * Apple iPhone dokunmatik kilit ekranı tuş tık sesi
   */
  public playKeypadTock(): void {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.exponentialRampToValueAtTime(200, now + 0.015);

    gainNode.gain.setValueAtTime(0.12, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.018);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.018);
  }
}

export const soundService = new SoundService();
