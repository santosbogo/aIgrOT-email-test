import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  try {
    const { name, email, message } = req.body || {};

    await resend.emails.send({
      from: "Formulario <onboarding@resend.dev>",
      to: "TU_CORREO@gmail.com",
      subject: "Nuevo mensaje",
      html: `
        <p><b>Nombre:</b> ${name}</p>
        <p><b>Email:</b> ${email}</p>
        <p><b>Mensaje:</b> ${message}</p>
      `,
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}