import { describe, expect, it } from 'vitest';
import { dayCloseConfirmMessage } from './dayCloseConfirm';

describe('dayCloseConfirmMessage', () => {
  it('neyin kapanacağını ve geri alınamazlığı söyler', () => {
    const text = dayCloseConfirmMessage();
    expect(text).toContain('arşivine mühürlenir');
    expect(text).toContain('geri alınamaz');
  });
});
