const Groq = require('groq-sdk');

const generateAlertFromAI = async (alertData) => {
  const { userBusinessName, debtorName, amountTL, dueDays, balanceTL, status } = alertData;

  const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
  });

  const prompt = `Sen bir finans asistanısın. Borç verilerine göre Türkçe uyarı mesajı yaz.
Veriler:
- İşletme Adı: ${userBusinessName}
- Borçlu/Alacaklı Adı: ${debtorName}
- İşlem Tutarı: ${amountTL} TL
- Vade Durumu: ${dueDays} gün ${dueDays < 0 ? 'gecikmiş' : 'kaldı'}
- Toplam Bakiye: ${balanceTL} TL
- Durum: ${status}

Kısa, profesyonel ve hatırlatıcı bir mesaj oluştur.`;

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "Sen profesyonel bir finans ve tahsilat asistanısın. Kısa ve kibar mesajlar yazarsın."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      model: "llama3-8b-8192",
      temperature: 0.7,
      max_tokens: 150,
    });

    return chatCompletion.choices[0]?.message?.content || "Uyarı mesajı oluşturulamadı.";
  } catch (error) {
    console.error("AI Alert Generation Error:", error);
    return "Yapay zeka uyarı mesajı oluştururken bir hata oluştu.";
  }
};

module.exports = {
  generateAlertFromAI
};
