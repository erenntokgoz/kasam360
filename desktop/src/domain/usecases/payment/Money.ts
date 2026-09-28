export type CurrencyCode = 'TRY' | 'USD' | 'EUR';

export class Money {
  private constructor(
    private readonly amountInCents: number,
    public readonly currency: CurrencyCode = 'TRY'
  ) {}

  static fromCents(cents: number, currency: CurrencyCode = 'TRY'): Money {
    if (!Number.isInteger(cents)) {
      throw new Error('Money amount must be an integer (cents)');
    }
    return new Money(cents, currency);
  }

  static fromFloat(amount: number, currency: CurrencyCode = 'TRY'): Money {
    return new Money(Math.round(amount * 100), currency);
  }

  get amount(): number {
    return this.amountInCents / 100;
  }

  get cents(): number {
    return this.amountInCents;
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.fromCents(this.amountInCents + other.cents, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.fromCents(this.amountInCents - other.cents, this.currency);
  }

  equals(other: Money): boolean {
    if (this.currency !== other.currency) return false;
    return this.amountInCents === other.cents;
  }

  greaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amountInCents > other.cents;
  }

  greaterThanOrEqual(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amountInCents >= other.cents;
  }

  lessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amountInCents < other.cents;
  }

  isZero(): boolean {
    return this.amountInCents === 0;
  }

  private assertSameCurrency(other: Money) {
    if (this.currency !== other.currency) {
      throw new Error(`Currency mismatch: ${this.currency} vs ${other.currency}`);
    }
  }
}
