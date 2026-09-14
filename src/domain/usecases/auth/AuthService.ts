import { SecurityPrincipal } from '../../../core/security/roles.types';
import { AuthorizationGuard } from './AuthorizationGuard';

export interface AuthSession {
  token: string;
  user: SecurityPrincipal;
  expiresAt: number;
}

export class AuthRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthRateLimitError';
  }
}

export class InvalidCredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCredentialsError';
  }
}

export class AuthService {
  private static instance: AuthService;
  private currentSession: AuthSession | null = null;
  
  private readonly userDB: Record<string, SecurityPrincipal> = {
    '1111': { userId: 'usr_master', role: 'MASTER', name: 'Master' },
  };

  private failedAttempts: number = 0;
  private lockedUntil: number | null = null;
  private readonly MAX_ATTEMPTS = 3;
  private readonly LOCKOUT_DURATION_MS = 60 * 1000; // 1 dakika
  private readonly SESSION_DURATION_MS = 8 * 60 * 60 * 1000; // 8 saat
  private readonly guard = new AuthorizationGuard();

  private constructor() {}

  public static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  public loginWithPin(pin: string): AuthSession {
    if (this.lockedUntil && Date.now() < this.lockedUntil) {
      throw new AuthRateLimitError('Too many failed attempts. Account is temporarily locked.');
    }

    if (this.lockedUntil && Date.now() >= this.lockedUntil) {
      this.lockedUntil = null;
      this.failedAttempts = 0;
    }

    const user = this.userDB[pin];
    if (!user) {
      this.failedAttempts++;
      if (this.failedAttempts >= this.MAX_ATTEMPTS) {
        this.lockedUntil = Date.now() + this.LOCKOUT_DURATION_MS;
        throw new AuthRateLimitError('Too many failed attempts. Account is temporarily locked.');
      }
      throw new InvalidCredentialsError('Invalid PIN code.');
    }

    this.failedAttempts = 0;
    this.currentSession = {
      token: `session_${Date.now()}_${Math.random().toString(36).substring(2)}`,
      user,
      expiresAt: Date.now() + this.SESSION_DURATION_MS,
    };

    return this.currentSession;
  }

  public logout(): void {
    this.currentSession = null;
  }

  public getCurrentSession(): AuthSession | null {
    if (!this.currentSession) return null;
    
    if (Date.now() > this.currentSession.expiresAt) {
      this.currentSession = null;
      return null; // Oturum süresi doldu
    }
    return this.currentSession;
  }

  public requireAuth(): AuthSession {
    const session = this.getCurrentSession();
    if (!session) {
      throw new Error('Authentication required. Session is invalid or expired.');
    }
    return session;
  }

  public getGuard(): AuthorizationGuard {
    return this.guard;
  }
}
