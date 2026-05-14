const generateAlertFromAI = async (alertData) => {
  const { debtorName, balanceTL, dueDays } = alertData;

  const amountStr = Number(balanceTL).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (dueDays === 1) {
    return `Vade Hatırlatıcı: ${debtorName} borcu için ${amountStr} TL tutarındaki ödemenin son günü yarın!`;
  } else if (dueDays === 0) {
    return `Vade Bildirimi: ${debtorName} borcu için ${amountStr} TL tutarındaki ödemenin vadesi bugün!`;
  } else if (dueDays < 0) {
    return `Gecikme Bildirimi: ${debtorName} borcu için ${amountStr} TL tutarındaki ödeme ${Math.abs(dueDays)} gün gecikti!`;
  } else {
    return `${debtorName} borcu için ${amountStr} TL tutarındaki ödemeye ${dueDays} gün kaldı.`;
  }
};

module.exports = {
  generateAlertFromAI
};
