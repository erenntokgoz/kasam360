const http = require('http');

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: 4444,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let resp = '';
        res.on('data', (chunk) => (resp += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(resp) });
          } catch (e) {
            resolve({ status: res.statusCode, body: resp });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function del(path) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: 4444,
        path,
        method: 'DELETE',
      },
      (res) => {
        let resp = '';
        res.on('data', (chunk) => (resp += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: resp }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function evalInApp(sessionId, script, args = []) {
  const res = await post(`/session/${sessionId}/execute/sync`, { script, args });
  return res.body ? res.body.value : null;
}

async function runVerifiedRegressionSuite() {
  console.log('================================================================');
  console.log('RUNNING MANDATORY REAL TAURI E2E REGRESSION (FLOWS A - E)');
  console.log('================================================================');

  const binaryPath = 'C:\\Users\\Eren Tokgöz\\Desktop\\Projects\\kasam360\\src-tauri\\target\\debug\\kasam360-core.exe';
  const session = await post('/session', {
    capabilities: {
      alwaysMatch: {
        'ms:edgeOptions': { binary: binaryPath },
        'tauri:options': { application: binaryPath },
      },
    },
  });
  const sessionId = session.body.value.sessionId;

  try {
    await new Promise((r) => setTimeout(r, 4000));

    const finalReport = await evalInApp(sessionId, `
      return (async () => {
        const report = {};

        // Products & Tables
        const products = await window.__TAURI_INTERNALS__.invoke('pos_get_products', { tenantId: 'DEFAULT_TENANT', tenant_id: 'DEFAULT_TENANT' });
        const prd = products.find(p => p.id === 'prd-001') || products[0]; // Turk Kahvesi: 2000 cents, 8% tax -> 2160 cents total

        const floor = await window.__TAURI_INTERNALS__.invoke('get_floor_plan', { tenantId: 'DEFAULT_TENANT', tenant_id: 'DEFAULT_TENANT' });
        const table1 = floor.find(t => t.id === 'tbl-001') || floor[0];
        const table2 = floor.find(t => t.id === 'tbl-002') || floor[1];
        const table3 = floor.find(t => t.id === 'tbl-003') || floor[2];
        const table4 = floor.find(t => t.id === 'tbl-004') || floor[3];

        // -------------------------------------------------------------
        // FLOW A: Login -> Table -> Product -> submit_order -> DB check
        // -------------------------------------------------------------
        try {
          const authUser = await window.__TAURI_INTERNALS__.invoke('auth_login', { pin: '5555' });
          const orderIdA = 'ORD_FLOW_A_' + Date.now();
          
          // CartItemDto with unitPrice (camelCase) and missing optional fields (testing BUG-02 fix)
          const itemA = {
            id: 'it_a_1',
            product: { id: prd.id, name: prd.name },
            quantity: 1,
            unitPrice: prd.price_cents
          };

          const submitSuccessA = await window.__TAURI_INTERNALS__.invoke('submit_order', {
            payload: {
              orderId: orderIdA,
              tableId: table1.id,
              items: [itemA],
              notes: 'Flow A Order'
            },
            tenantId: 'DEFAULT_TENANT',
            tenant_id: 'DEFAULT_TENANT'
          });

          const fA = await window.__TAURI_INTERNALS__.invoke('get_floor_plan', { tenantId: 'DEFAULT_TENANT', tenant_id: 'DEFAULT_TENANT' });
          const t1A = fA.find(t => t.id === table1.id);

          const orderItemsA = await window.__TAURI_INTERNALS__.invoke('get_order_items', {
            table_id: table1.id,
            tableId: table1.id
          });

          report.flow_a = {
            status: submitSuccessA && t1A.status === 'OCCUPIED' && t1A.currentTotal === 2160 && orderItemsA.length >= 1 ? 'PASS' : 'FAIL',
            user: authUser.name,
            orderId: orderIdA,
            tableStatusInDb: t1A.status,
            tableTotalInDb: t1A.currentTotal,
            orderItemsPersistedCount: orderItemsA.length,
            persistedItemUnitPrice: orderItemsA[0]?.unitPrice,
            persistedItemTotal: orderItemsA[0]?.total
          };

          // -------------------------------------------------------------
          // FLOW B: Order -> Exact Cash Payment -> verify states
          // -------------------------------------------------------------
          const payResB = await window.__TAURI_INTERNALS__.invoke('process_payment', {
            payload: {
              transactionId: 'TXN_FLOW_B_' + Date.now(),
              orderId: orderIdA,
              timestamp: new Date().toISOString(),
              method: 'CASH',
              amountTendered: 2160,
              totalAmount: 2160,
              items: [itemA],
              customerRef: table1.id
            }
          });

          const fB = await window.__TAURI_INTERNALS__.invoke('get_floor_plan', { tenantId: 'DEFAULT_TENANT', tenant_id: 'DEFAULT_TENANT' });
          const t1B = fB.find(t => t.id === table1.id);

          report.flow_b = {
            status: payResB.success && t1B.status === 'AVAILABLE' && t1B.currentTotal === 0 ? 'PASS' : 'FAIL',
            paymentSuccess: payResB.success,
            fiscalReceipt: payResB.fiscalReceiptNo,
            tableStatusAfterPayment: t1B.status,
            tableTotalAfterPayment: t1B.currentTotal
          };
        } catch (err) {
          report.flow_a_and_b = { status: 'FAIL', error: String(err) };
        }

        // -------------------------------------------------------------
        // FLOW C: Split Payment (4000, 3000, remaining -> close)
        // -------------------------------------------------------------
        try {
          const orderIdC = 'ORD_FLOW_C_' + Date.now();
          // 5 units of prd-001 -> 5 * 2000 = 10000 cents + 800 tax = 10800 cents total
          const itemC = {
            id: 'it_c_1',
            product: { id: prd.id, name: prd.name },
            quantity: 5,
            unitPrice: prd.price_cents
          };
          const totalCentsC = 10800;

          await window.__TAURI_INTERNALS__.invoke('submit_order', {
            payload: { orderId: orderIdC, tableId: table2.id, items: [itemC], notes: 'Flow C Split' },
            tenantId: 'DEFAULT_TENANT', tenant_id: 'DEFAULT_TENANT'
          });

          // 1. Partial 4000
          await window.__TAURI_INTERNALS__.invoke('process_split_payment', {
            payload: {
              transactionId: 'TXN_C_SP1_' + Date.now(),
              orderId: orderIdC,
              timestamp: new Date().toISOString(),
              method: 'SPLIT',
              amountTendered: 4000,
              totalAmount: totalCentsC,
              items: [itemC],
              customerRef: table2.id
            }
          });
          let fC = await window.__TAURI_INTERNALS__.invoke('get_floor_plan', { tenantId: 'DEFAULT_TENANT', tenant_id: 'DEFAULT_TENANT' });
          const t2_1 = fC.find(t => t.id === table2.id);

          // 2. Partial 3000
          await window.__TAURI_INTERNALS__.invoke('process_split_payment', {
            payload: {
              transactionId: 'TXN_C_SP2_' + Date.now(),
              orderId: orderIdC,
              timestamp: new Date().toISOString(),
              method: 'SPLIT',
              amountTendered: 3000,
              totalAmount: totalCentsC,
              items: [itemC],
              customerRef: table2.id
            }
          });
          fC = await window.__TAURI_INTERNALS__.invoke('get_floor_plan', { tenantId: 'DEFAULT_TENANT', tenant_id: 'DEFAULT_TENANT' });
          const t2_2 = fC.find(t => t.id === table2.id);

          // 3. Final: 3800
          await window.__TAURI_INTERNALS__.invoke('process_split_payment', {
            payload: {
              transactionId: 'TXN_C_SP3_' + Date.now(),
              orderId: orderIdC,
              timestamp: new Date().toISOString(),
              method: 'SPLIT',
              amountTendered: 3800,
              totalAmount: totalCentsC,
              items: [itemC],
              customerRef: table2.id
            }
          });
          fC = await window.__TAURI_INTERNALS__.invoke('get_floor_plan', { tenantId: 'DEFAULT_TENANT', tenant_id: 'DEFAULT_TENANT' });
          const t2_3 = fC.find(t => t.id === table2.id);

          report.flow_c = {
            status: t2_1.currentTotal === 6800 && t2_2.currentTotal === 3800 && t2_3.status === 'AVAILABLE' && t2_3.currentTotal === 0 ? 'PASS' : 'FAIL',
            totalCents: totalCentsC,
            step1RemainingInDb: t2_1.currentTotal,
            step2RemainingInDb: t2_2.currentTotal,
            step3FinalStatusInDb: t2_3.status,
            step3FinalTotalInDb: t2_3.currentTotal
          };
        } catch (err) {
          report.flow_c = { status: 'FAIL', error: String(err) };
        }

        // -------------------------------------------------------------
        // FLOW D: Waiter recovery -> select table -> submit order
        // -------------------------------------------------------------
        try {
          const { useAuthStore } = await import('./src/presentation/store/useAuthStore.ts');
          const { useCartStore } = await import('./src/presentation/store/useCartStore.ts');

          const waiterUser = await window.__TAURI_INTERNALS__.invoke('auth_login', { pin: '5555' });
          useAuthStore.getState().login(waiterUser);

          useCartStore.getState().clearCart();
          useCartStore.getState().navigate('POS');
          const activeTableAtStart = useCartStore.getState().activeTableId;

          // Recovery: Navigate to FLOOR & Select Table 3
          useCartStore.getState().navigate('FLOOR');
          await useCartStore.getState().selectTable(table3.id);
          useCartStore.getState().navigate('POS');
          const activeTableAfterSelect = useCartStore.getState().activeTableId;

          // Submit order for Table 3
          const orderIdD = 'ORD_FLOW_D_' + Date.now();
          const itemD = {
            id: 'it_d_1',
            product: { id: prd.id, name: prd.name },
            quantity: 1,
            unitPrice: prd.price_cents
          };

          const submitD = await window.__TAURI_INTERNALS__.invoke('submit_order', {
            payload: { orderId: orderIdD, tableId: table3.id, items: [itemD], notes: 'Waiter Recovery Order' },
            tenantId: 'DEFAULT_TENANT', tenant_id: 'DEFAULT_TENANT'
          });

          const fD = await window.__TAURI_INTERNALS__.invoke('get_floor_plan', { tenantId: 'DEFAULT_TENANT', tenant_id: 'DEFAULT_TENANT' });
          const t3D = fD.find(t => t.id === table3.id);

          report.flow_d = {
            status: activeTableAtStart === null && activeTableAfterSelect === table3.id && submitD && t3D.status === 'OCCUPIED' ? 'PASS' : 'FAIL',
            activeTableAtStart,
            activeTableAfterSelect,
            submitSuccess: submitD,
            table3StatusInDb: t3D.status,
            table3TotalInDb: t3D.currentTotal
          };
        } catch (err) {
          report.flow_d = { status: 'FAIL', error: String(err) };
        }

        // -------------------------------------------------------------
        // FLOW E: Order creation failure -> atomicity (no orphans)
        // -------------------------------------------------------------
        try {
          const failOrderId = 'ORD_FLOW_E_FAIL_' + Date.now();
          const invalidItem = {
            id: 'it_e_invalid',
            product: { id: 'NON_EXISTENT_PRD_XYZ' },
            quantity: 1,
            unitPrice: 1000
          };

          let orderCreationRejected = false;
          let rejectError = '';
          try {
            await window.__TAURI_INTERNALS__.invoke('submit_order', {
              payload: { orderId: failOrderId, tableId: table4.id, items: [invalidItem], notes: 'Failure Atomicity' },
              tenantId: 'DEFAULT_TENANT', tenant_id: 'DEFAULT_TENANT'
            });
          } catch (e) {
            orderCreationRejected = true;
            rejectError = String(e);
          }

          const itemsOnTable4 = await window.__TAURI_INTERNALS__.invoke('get_order_items', {
            table_id: table4.id,
            tableId: table4.id
          });

          const fE = await window.__TAURI_INTERNALS__.invoke('get_floor_plan', { tenantId: 'DEFAULT_TENANT', tenant_id: 'DEFAULT_TENANT' });
          const t4E = fE.find(t => t.id === table4.id);

          report.flow_e = {
            status: orderCreationRejected && itemsOnTable4.length === 0 && t4E.status === 'AVAILABLE' ? 'PASS' : 'FAIL',
            orderCreationRejected,
            rejectError,
            orphanOrderItemsCount: itemsOnTable4.length,
            tableStateInDb: t4E.status
          };
        } catch (err) {
          report.flow_e = { status: 'FAIL', error: String(err) };
        }

        return report;
      })();
    `);

    console.log('\n================================================================');
    console.log('MANDATORY REAL TAURI E2E REGRESSION RESULTS:');
    console.log(JSON.stringify(finalReport, null, 2));
    console.log('================================================================');
  } finally {
    await del(`/session/${sessionId}`);
    console.log('WebDriver Session Cleanly Terminated.');
  }
}

runVerifiedRegressionSuite().catch(console.error);
