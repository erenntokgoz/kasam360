// @ts-ignore
import RNHTMLtoPDF from 'react-native-html-to-pdf';
import { Platform } from 'react-native';

export interface ReportData {
  period: { start: string; end: string };
  summary: { totalIncome: number; totalExpense: number; netBalance: number };
  transactions: Array<{ date: string; type: string; amount: number; description: string; directoryName: string }>;
}

class PdfExportService {
  /**
   * Rapor verisinden PDF dosyası oluşturur ve yolunu döner.
   * @param {ReportData} data 
   * @param {string} title Rapor başlığı
   */
  static async generateMonthlyYearlyReport(data: ReportData, title: string = 'Kasam360 Raporu') {
    try {
      const htmlContent = this.buildHtmlTemplate(data, title);

      const options = {
        html: htmlContent,
        fileName: `Kasam360_Rapor_${new Date().getTime()}`,
        directory: 'Documents', // Android'de dökümanlar klasörü, iOS'ta app documents
      };

      const file = await RNHTMLtoPDF.convert(options);
      console.log('PDF generated at:', file.filePath);
      return file.filePath;
    } catch (error) {
      console.error('[PdfExportService] Error generating PDF:', error);
      throw error;
    }
  }

  private static buildHtmlTemplate(data: ReportData, title: string): string {
    const rows = data.transactions.map(tx => `
      <tr>
        <td>${tx.date}</td>
        <td>${tx.directoryName}</td>
        <td>${tx.description || '-'}</td>
        <td style="color: ${tx.type === 'INCOME' ? 'green' : 'red'};">
          ${tx.type === 'INCOME' ? '+' : '-'}${tx.amount} ₺
        </td>
      </tr>
    `).join('');

    return `
      <html>
        <head>
          <style>
            body { font-family: 'Helvetica', sans-serif; padding: 20px; color: #333; }
            h1 { text-align: center; color: #2c3e50; }
            .summary { margin-bottom: 20px; padding: 15px; background: #ecf0f1; border-radius: 8px; }
            .summary p { margin: 5px 0; font-weight: bold; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #bdc3c7; padding: 10px; text-align: left; }
            th { background-color: #34495e; color: white; }
          </style>
        </head>
        <body>
          <h1>${title}</h1>
          
          <div class="summary">
            <p>Dönem: ${data.period.start} - ${data.period.end}</p>
            <p>Toplam Gelir: <span style="color: green;">${data.summary.totalIncome} ₺</span></p>
            <p>Toplam Gider: <span style="color: red;">${data.summary.totalExpense} ₺</span></p>
            <p>Net Durum: <span>${data.summary.netBalance} ₺</span></p>
          </div>

          <table>
            <thead>
              <tr>
                <th>Tarih</th>
                <th>Kişi/Firma</th>
                <th>Açıklama</th>
                <th>Tutar</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </body>
      </html>
    `;
  }
}

export default PdfExportService;
