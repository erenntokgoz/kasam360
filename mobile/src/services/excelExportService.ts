import RNFS from 'react-native-fs';
import * as XLSX from 'xlsx';
import { ReportData } from './pdfExportService';

class ExcelExportService {
  /**
   * Rapor verisinden Excel (XLSX) dosyası oluşturur.
   * @param {ReportData} data 
   * @param {string} fileName 
   * @returns {Promise<string>} Oluşturulan dosyanın yolu
   */
  static async generateReport(data: ReportData, fileName: string = 'Kasam360_Rapor'): Promise<string> {
    try {
      // 1. Veriyi Excel formatına düzleştir
      const excelData = data.transactions.map(tx => ({
        'Tarih': tx.date,
        'Kişi/Firma': tx.directoryName,
        'Açıklama': tx.description || '-',
        'Tip': tx.type === 'INCOME' ? 'Gelir' : 'Gider',
        'Tutar (₺)': tx.amount
      }));

      // Özet satırlarını ekle
      excelData.push({ 'Tarih': '', 'Kişi/Firma': '', 'Açıklama': '', 'Tip': '', 'Tutar (₺)': '' } as any);
      excelData.push({
        'Tarih': 'ÖZET',
        'Kişi/Firma': `Dönem: ${data.period.start} - ${data.period.end}`,
        'Açıklama': '',
        'Tip': 'Toplam Gelir',
        'Tutar (₺)': data.summary.totalIncome
      } as any);
      excelData.push({
        'Tarih': '',
        'Kişi/Firma': '',
        'Açıklama': '',
        'Tip': 'Toplam Gider',
        'Tutar (₺)': data.summary.totalExpense
      } as any);
      excelData.push({
        'Tarih': '',
        'Kişi/Firma': '',
        'Açıklama': '',
        'Tip': 'Net Durum',
        'Tutar (₺)': data.summary.netBalance
      } as any);

      // 2. Worksheet ve Workbook oluştur
      const ws = XLSX.utils.json_to_sheet(excelData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Rapor');

      // 3. Binary string olarak yaz
      const wbout = XLSX.write(wb, { type: 'binary', bookType: 'xlsx' });

      // 4. Dosyayı diske kaydet
      const path = `${RNFS.DocumentDirectoryPath}/${fileName}_${new Date().getTime()}.xlsx`;
      
      await RNFS.writeFile(path, wbout, 'ascii');
      
      console.log('Excel generated at:', path);
      return path;
    } catch (error) {
      console.error('[ExcelExportService] Error generating Excel:', error);
      throw error;
    }
  }
}

export default ExcelExportService;
