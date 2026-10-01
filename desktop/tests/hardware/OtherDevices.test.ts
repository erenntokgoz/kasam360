
import { MockCashDrawer } from '../../src/data/hardware/mock/MockCashDrawer';
import { MockBarcodeScanner } from '../../src/data/hardware/mock/MockBarcodeScanner';
import { MockOKC } from '../../src/data/hardware/mock/MockOKC';

describe('Hardware Abstraction - Devices', () => {
  it('TEST: drawer failure - should not throw, just return false', async () => {
    const drawer = new MockCashDrawer();
    await drawer.connect();
    
    // Simulate failure
    drawer.simulateFailure();
    
    const result = await drawer.open();
    expect(result).toBe(false);
    expect(await drawer.isOpen()).toBe(false);
  });

  it('TEST: barcode input - should trigger callback', async () => {
    const scanner = new MockBarcodeScanner();
    await scanner.connect();
    
    const scanCallback = vi.fn();
    scanner.onBarcodeScanned(scanCallback);
    
    scanner.simulateScan('8691234567890');
    
    expect(scanCallback).toHaveBeenCalledWith('8691234567890');
    expect(scanCallback).toHaveBeenCalledTimes(1);
    
    scanner.removeListener();
    scanner.simulateScan('12345');
    expect(scanCallback).toHaveBeenCalledTimes(1); // not called again
  });

  it('TEST: mock ÖKC failure - transaction should fail safely', async () => {
    const okc = new MockOKC();
    await okc.connect();
    
    // Simulate failure
    okc.simulateFailure();
    
    const result = await okc.processTransaction({
      amount: 100.50,
      taxRate: 18,
    });
    
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.fiscalCode).toBeUndefined();
  });

  it('TEST: mock ÖKC success - transaction should succeed', async () => {
    const okc = new MockOKC();
    await okc.connect();
    
    const result = await okc.processTransaction({
      amount: 50.00,
      taxRate: 8,
    });
    
    expect(result.success).toBe(true);
    expect(result.fiscalCode).toBeDefined();
    expect(result.receiptNo).toBeDefined();
  });
});
