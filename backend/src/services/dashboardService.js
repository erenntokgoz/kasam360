'use strict';

const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');

/**
 * DashboardService — FAZ 6 Analitik Motoru
 *
 * GÜVENLİK KURALLARI (HİÇBİR ZAMAN ÇIKARILMAZ):
 *   1. Soft Delete filtresi: { isDeleted: false }
 *   2. Tenant izolasyonu: { tenantId: new ObjectId(tenantId) }
 *
 * Parasal değerler her zaman kuruş (integer) cinsinden saklanır.
 * Bölme/çarpma işlemleri sadece sunum katmanında yapılır.
 */

/**
 * Ana dashboard verisini TEK bir aggregation roundtrip ile hesaplar.
 * Dönen nesne hiçbir şekilde başka tenant verisini içermez.
 *
 * @param {string} tenantId — JWT'den extract edilen, doğrulanmış tenant ID
 * @returns {Promise<DashboardPayload>}
 */
async function getDashboardData(tenantId) {
  const tenantObjId = new mongoose.Types.ObjectId(tenantId);
  const now = new Date();

  // ── Zaman sınırları ────────────────────────────────────────────────────────
  // Mevcut ay başı (saat 00:00:00.000)
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  // Bir önceki ay başı
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  // Bir önceki ay sonu (mevcut ay başından 1 ms önce)
  const prevMonthEnd = new Date(currentMonthStart.getTime() - 1);
  // 6 ay öncesinin 1. günü
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

  // ── BASE MATCH — Tenant izolasyonu + Soft Delete ───────────────────────────
  const baseMatch = {
    tenantId: tenantObjId,
    isDeleted: false,
  };

  // ── PIPELINE ──────────────────────────────────────────────────────────────
  const pipeline = [
    // ─ 0. Güvenlik filtresi (her şeyin başında) ─────────────────────────────
    { $match: baseMatch },

    // ─ 1. Zaman etiketleri ──────────────────────────────────────────────────
    {
      $addFields: {
        _isCurrent:  { $gte: ['$transactionDate', currentMonthStart] },
        _isPrev:     { $and: [{ $gte: ['$transactionDate', prevMonthStart] }, { $lte: ['$transactionDate', prevMonthEnd] }] },
        _isIn6Month: { $gte: ['$transactionDate', sixMonthsAgo] },
        // Ay etiketi: "YYYY-MM" formatında string (sıralama için)
        _monthKey: {
          $dateToString: { format: '%Y-%m', date: '$transactionDate' },
        },
      },
    },

    // ─ 2. VERESİYE işlemler nakit bakiyeyi etkilemez
    //      Gerçek nakit etki alanı
    {
      $addFields: {
        _cashImpact: {
          $cond: [
            { $eq: ['$method', 'VERESİYE'] },
            0,
            {
              $cond: [
                { $eq: ['$type', 'INCOME'] },
                '$amount',
                { $multiply: ['$amount', -1] },
              ],
            },
          ],
        },
      },
    },

    // ─ 3. Paralel gruplama facet'leri ───────────────────────────────────────
    {
      $facet: {

        // ── 3a. Mevcut ay kar/zarar özeti ─────────────────────────────────
        currentMonth: [
          { $match: { _isCurrent: true } },
          {
            $group: {
              _id: null,
              income:  { $sum: { $cond: [{ $eq: ['$type', 'INCOME'] }, '$amount', 0] } },
              expense: { $sum: { $cond: [{ $eq: ['$type', 'EXPENSE'] }, '$amount', 0] } },
            },
          },
          {
            $project: {
              _id: 0,
              income: 1,
              expense: 1,
              // Kar = gelir - gider (negatif ise zarar)
              netProfit: { $subtract: ['$income', '$expense'] },
            },
          },
        ],

        // ── 3b. Bir önceki ay özeti (% değişim hesabı için) ───────────────
        prevMonth: [
          { $match: { _isPrev: true } },
          {
            $group: {
              _id: null,
              income:  { $sum: { $cond: [{ $eq: ['$type', 'INCOME'] }, '$amount', 0] } },
              expense: { $sum: { $cond: [{ $eq: ['$type', 'EXPENSE'] }, '$amount', 0] } },
            },
          },
          {
            $project: {
              _id: 0,
              income: 1,
              expense: 1,
              netProfit: { $subtract: ['$income', '$expense'] },
            },
          },
        ],

        // ── 3c. Son 6 aylık trend (aylık gelir/gider) ────────────────────
        monthlyTrend: [
          { $match: { _isIn6Month: true } },
          {
            $group: {
              _id: '$_monthKey',
              income:  { $sum: { $cond: [{ $eq: ['$type', 'INCOME'] }, '$amount', 0] } },
              expense: { $sum: { $cond: [{ $eq: ['$type', 'EXPENSE'] }, '$amount', 0] } },
            },
          },
          { $sort: { _id: 1 } },
          {
            $project: {
              _id: 0,
              month: '$_id',       // "2025-11", "2025-12", ...
              income: 1,
              expense: 1,
              netProfit: { $subtract: ['$income', '$expense'] },
            },
          },
        ],

        // ── 3d. Kategori dağılımı (sadece giderler, pasta grafik için) ────
        categoryBreakdown: [
          {
            $match: {
              type: 'EXPENSE',
              isDeleted: false,          // çift kontrol — facet içi güvenlik
              _isCurrent: true,          // mevcut ay gider dağılımı
            },
          },
          {
            $group: {
              _id: {
                $ifNull: ['$category', 'Diğer'],
              },
              total: { $sum: '$amount' },
              count: { $sum: 1 },
            },
          },
          { $sort: { total: -1 } },
          {
            $project: {
              _id: 0,
              category: '$_id',
              total: 1,
              count: 1,
            },
          },
        ],

        // ── 3e. Toplam bakiye (nakit) — tüm zamanlar ──────────────────────
        overallSummary: [
          {
            $group: {
              _id: null,
              totalIncome:  { $sum: { $cond: [{ $eq: ['$type', 'INCOME'] }, '$amount', 0] } },
              totalExpense: { $sum: { $cond: [{ $eq: ['$type', 'EXPENSE'] }, '$amount', 0] } },
            },
          },
          {
            $project: {
              _id: 0,
              totalIncome: 1,
              totalExpense: 1,
              balance: { $subtract: ['$totalIncome', '$totalExpense'] },
            },
          },
        ],
      },
    },
  ];

  const [result] = await Transaction.aggregate(pipeline);

  // ── Sonuçları güvenli default'larla al ──────────────────────────────────
  const curr = result.currentMonth[0] ?? { income: 0, expense: 0, netProfit: 0 };
  const prev = result.prevMonth[0]    ?? { income: 0, expense: 0, netProfit: 0 };
  const overall = result.overallSummary[0] ?? { totalIncome: 0, totalExpense: 0, balance: 0 };

  // ── Yüzde değişim hesabı (sıfıra bölme koruması) ─────────────────────────
  const pctChange = (current, previous) => {
    if (previous === 0) {
      return current > 0 ? 100 : 0;
    }
    return Math.round(((current - previous) / Math.abs(previous)) * 10000) / 100; // 2 ondalık
  };

  // ── Kategori pasta oranları ───────────────────────────────────────────────
  const totalExpenseForPie = result.categoryBreakdown.reduce((s, c) => s + c.total, 0);
  const categoryBreakdown = result.categoryBreakdown.map((c) => ({
    category: c.category,
    total: c.total,
    count: c.count,
    // Yüzde: integer puan, toplam gider 0 ise 0
    percentage: totalExpenseForPie > 0
      ? Math.round((c.total / totalExpenseForPie) * 10000) / 100
      : 0,
  }));

  return {
    // Mevcut ay kar/zarar
    currentMonth: {
      income:    curr.income,
      expense:   curr.expense,
      netProfit: curr.netProfit,
      isProfit:  curr.netProfit >= 0,
    },
    // Bir önceki aya göre değişim
    changeFromPrevMonth: {
      incomeChangePct:    pctChange(curr.income,    prev.income),
      expenseChangePct:   pctChange(curr.expense,   prev.expense),
      netProfitChangePct: pctChange(curr.netProfit, prev.netProfit),
      prevIncome:         prev.income,
      prevExpense:        prev.expense,
      prevNetProfit:      prev.netProfit,
    },
    // Genel bakiye (tüm zaman)
    overallSummary: {
      totalIncome:  overall.totalIncome,
      totalExpense: overall.totalExpense,
      balance:      overall.balance,
    },
    // Son 6 ay aylık trend
    monthlyTrend: result.monthlyTrend,  // [{ month, income, expense, netProfit }]
    // Kategori pasta grafik
    categoryBreakdown,                   // [{ category, total, count, percentage }]
    // Meta
    generatedAt: now.toISOString(),
    period: {
      currentMonthStart: currentMonthStart.toISOString(),
      sixMonthsAgo: sixMonthsAgo.toISOString(),
    },
  };
}

module.exports = { getDashboardData };
