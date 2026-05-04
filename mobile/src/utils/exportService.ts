import * as RNFS from 'react-native-fs';
import Share from 'react-native-share';
import { Alert } from 'react-native';
const RNHTMLtoPDF = require('react-native-html-to-pdf');
import { Transaction } from '../api/transactionService';

const formatCurrency = (cents: number): string => {
  const lira = Math.abs(cents) / 100;
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
  }).format(lira);
};

const formatDate = (iso: string): string => {
  if (!iso) return '';
  const date = new Date(iso);
  return date.toLocaleDateString('tr-TR');
};

export const exportToCSV = async (transactions: Transaction[], fileName: string) => {
  try {
    const headers = ['Tarih', 'Tip', 'Kategori', 'Yöntem', 'Tutar', 'Aciklama'];
    const rows = transactions.map(t => {
      const type = t.type === 'INCOME' ? 'Gelir' : 'Gider';
      const amount = (t.amount / 100).toString().replace('.', ',');
      const desc = t.description ? `"${t.description.replace(/"/g, '""')}"` : '';
      return `${formatDate(t.transactionDate || t.createdAt)},${type},${t.category || ''},${t.method || ''},${amount},${desc}`;
    });

    const csvContent = [headers.join(',')]
      .concat(rows)
      .join('\n');

    const path = `${RNFS.DocumentDirectoryPath}/${fileName}.csv`;
    await RNFS.writeFile(path, csvContent, 'utf8');

    await Share.open({
      url: `file://${path}`,
      type: 'text/csv',
      title: 'CSV Olarak Dışa Aktar',
    });
  } catch (error) {
    if (__DEV__) { console.error('CSV Export Error: ', error); }
    Alert.alert('Hata', 'Dışa aktarma başarısız oldu.');
  }
};

export const exportToPDF = async (
  transactions: Transaction[],
  summary: { totalIncome: number; totalExpense: number; balance: number },
  fileName: string
) => {
  try {
    const rowsHtml = transactions.map(t => `
      <tr>
        <td>${formatDate(t.transactionDate || t.createdAt)}</td>
        <td>${t.type === 'INCOME' ? 'Gelir' : 'Gider'}</td>
        <td>${t.category || '-'}</td>
        <td>${t.method || '-'}</td>
        <td style="text-align: right; color: ${t.type === 'INCOME' ? 'green' : 'red'};">${formatCurrency(t.amount)}</td>
      </tr>
    `).join('');

    const htmlContent = `
      <html>
        <head>
          <style>
            body { font-family: Helvetica, Arial, sans-serif; padding: 20px; }
            h1 { text-align: center; color: #333; }
            .summary { margin-bottom: 30px; display: flex; justify-content: space-between; background: #f9f9f9; padding: 15px; border-radius: 8px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
            th { background-color: #f2f2f2; }
          </style>
        </head>
        <body>
          <h1>Hesap Ozeti</h1>
          <div class="summary">
            <div><strong>Toplam Gelir:</strong> ${formatCurrency(summary.totalIncome)}</div>
            <div><strong>Toplam Gider:</strong> ${formatCurrency(summary.totalExpense)}</div>
            <div><strong>Bakiye:</strong> ${formatCurrency(summary.balance)}</div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Tarih</th>
                <th>Tip</th>
                <th>Kategori</th>
                <th>Yöntem</th>
                <th style="text-align: right;">Tutar</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </body>
      </html>
    `;

    const options = {
      html: htmlContent,
      fileName: fileName,
      directory: 'Documents',
    };

    const file = await RNHTMLtoPDF.convert(options);
    
    if (file.filePath) {
      await Share.open({
        url: `file://${file.filePath}`,
        type: 'application/pdf',
        title: 'PDF Olarak Dışa Aktar',
      });
    }
  } catch (error) {
    if (__DEV__) { console.error('PDF Export Error: ', error); }
    Alert.alert('Hata', 'Dışa aktarma başarısız oldu.');
  }
};
