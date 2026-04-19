import axios from "axios";

export async function enviarWhatsAppTeste(telefone, mensagem) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    console.warn("⚠️ WhatsApp não configurado no ambiente");
    return;
  }

  const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;

  await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to: telefone,
      type: "text",
      text: {
        body: mensagem
      }
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    }
  );

  console.log("✅ Mensagem WhatsApp enviada com sucesso");
}
