import Share from 'react-native-share';
import { Alert } from 'react-native';

class ShareService {
  /**
   * Dosyayı genel paylaşım penceresiyle paylaşır.
   * @param {string} filePath Dosya yolu (örn: file://... veya /data/user/...)
   * @param {string} mimeType 'application/pdf' veya 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
   */
  static async shareFile(filePath: string, mimeType: string, title: string = 'Kasam360 Dosyası') {
    try {
      // iOS ve Android için 'file://' prefix'i gerekebilir
      const formattedPath = filePath.startsWith('file://') ? filePath : `file://${filePath}`;

      const shareOptions = {
        title: title,
        url: formattedPath,
        type: mimeType,
        showAppsToView: true,
      };

      await Share.open(shareOptions);
    } catch (error: any) {
      if (error.message !== 'User did not share') {
        console.error('[ShareService] Error sharing file:', error);
        Alert.alert('Hata', 'Dosya paylaşılırken bir sorun oluştu.');
      }
    }
  }

  /**
   * Sadece WhatsApp üzerinden paylaşmaya zorlar.
   */
  static async shareViaWhatsApp(filePath: string, mimeType: string) {
    try {
      const formattedPath = filePath.startsWith('file://') ? filePath : `file://${filePath}`;

      const shareOptions = {
        title: 'Kasam360 Raporu',
        url: formattedPath,
        type: mimeType,
        social: Share.Social.WHATSAPP,
      };

      await Share.shareSingle(shareOptions as any);
    } catch (error: any) {
      console.error('[ShareService] Error sharing via WhatsApp:', error);
      Alert.alert('Hata', 'WhatsApp üzerinden paylaşım yapılamadı. WhatsApp yüklü olduğundan emin olun.');
    }
  }

  /**
   * Sadece Email üzerinden paylaşmaya zorlar.
   */
  static async shareViaEmail(filePath: string, mimeType: string, emailStr: string = '') {
    try {
      const formattedPath = filePath.startsWith('file://') ? filePath : `file://${filePath}`;

      const shareOptions = {
        title: 'Kasam360 Raporu',
        url: formattedPath,
        type: mimeType,
        social: Share.Social.EMAIL,
        email: emailStr,
        subject: 'Kasam360 Aylık Rapor',
        message: 'Ekteki dosyada Kasam360 uygulamasından alınan rapor bulunmaktadır.'
      };

      await Share.shareSingle(shareOptions as any);
    } catch (error: any) {
      console.error('[ShareService] Error sharing via Email:', error);
      Alert.alert('Hata', 'Email üzerinden paylaşım yapılamadı.');
    }
  }
}

export default ShareService;
