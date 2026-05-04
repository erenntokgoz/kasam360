const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin using the existing google-vision.json service account
try {
  const serviceAccountPath = path.resolve(__dirname, '../config/kasam360-firebase-adminsdk.json');
  admin.initializeApp({
    credential: admin.credential.cert(require(serviceAccountPath))
  });
  console.log('[NotificationService] Firebase Admin initialized.');
} catch (error) {
  console.error('[NotificationService] Firebase Admin initialization error:', error);
}

/**
 * Send Push Notification (Simulated for now)
 * @param {string} deviceToken - FCM Device Token (or phone number for SMS simulation)
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 */
const sendPushNotification = async (deviceToken, title, body) => {
  try {
    // For now, simulate sending by logging
    console.log(`[NotificationService] Simulated Push/SMS to [${deviceToken}]`);
    console.log(`[NotificationService] Title: ${title}`);
    console.log(`[NotificationService] Body: ${body}`);
    
    // Real implementation would look like:
    // const message = {
    //   notification: { title, body },
    //   token: deviceToken
    // };
    // await admin.messaging().send(message);
    
    return true;
  } catch (error) {
    console.error('[NotificationService] Error sending notification:', error);
    return false;
  }
};

module.exports = {
  sendPushNotification
};
