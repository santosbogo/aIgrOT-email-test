import { Resend } from "resend";

// Resend clients (dos cuentas)
const resend = new Resend(process.env.RESEND_API_KEY);
const resendPapa = new Resend(process.env.RESEND_API_KEY_PAPA);

/* ===================== HELPERS ===================== */

function isHexString(s) {
  return typeof s === "string" && s.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(s);
}

function utcFromMs(epochMs) {
  const d = new Date(epochMs);

  const parts = new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const get = (t) => parts.find(p => p.type === t).value;

  // mm/hh dd/mm/aaaa
  return `${get("minute")}/${get("hour")} ${get("day")}/${get("month")}/${get("year")}`;
}

function utcFromSeconds(epochSeconds) {
  return utcFromMs(epochSeconds * 1000);
}

/* ===================== UNPACK ===================== */

function unpackPacket(hex) {
  if (!isHexString(hex)) {
    const err = new Error("Invalid hex string in Packets[0].Value.");
    err.statusCode = 400;
    throw err;
  }

  const buf = Buffer.from(hex, "hex");

  const MESSAGE_SIZE_FULL = 21; // "<IIiihbH"
  const MESSAGE_SIZE_ALERT = 9; // "<II?"

  if (buf.length === MESSAGE_SIZE_FULL) {
    let o = 0;
    const sequence_number = buf.readUInt32LE(o); o += 4;
    const time = buf.readUInt32LE(o); o += 4;
    const latitude = buf.readInt32LE(o); o += 4;
    const longitude = buf.readInt32LE(o); o += 4;
    const elevation = buf.readInt16LE(o); o += 2;
    const temperature = buf.readInt8(o); o += 1;
    const battery_voltage = buf.readUInt16LE(o); o += 2;

    return {
      kind: "info",
      sequence_number,
      device_time_s: time,
      latitude: latitude * 1e-7,
      longitude: longitude * 1e-7,
      elevation,
      temperature,
      battery_voltage,
    };
  }

  if (buf.length === MESSAGE_SIZE_ALERT) {
    let o = 0;
    const sequence_number = buf.readUInt32LE(o); o += 4;
    const time = buf.readUInt32LE(o); o += 4;
    const alert_status = buf.readUInt8(o) !== 0;

    return {
      kind: "alert",
      sequence_number,
      device_time_s: time,
      alert_status,
    };
  }

  const err = new Error(
    `Unknown packet size: ${buf.length} bytes (expected ${MESSAGE_SIZE_FULL} or ${MESSAGE_SIZE_ALERT})`
  );
  err.statusCode = 400;
  throw err;
}

/* ===================== WEBHOOK ===================== */

function extractWebhook(body) {
  if (!body || typeof body.Data !== "string") {
    const err = new Error('Missing "Data" (must be a JSON string).');
    err.statusCode = 400;
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(body.Data);
  } catch {
    const err = new Error('"Data" is not valid JSON.');
    err.statusCode = 400;
    throw err;
  }

  const pkt = parsed?.Packets?.[0];
  const receivedTimestampMs = pkt?.Timestamp;
  const packetHex = pkt?.Value;
  const terminalId = pkt?.TerminalId ?? null;

  if (typeof receivedTimestampMs !== "number") {
    const err = new Error('Missing Packets[0].Timestamp.');
    err.statusCode = 400;
    throw err;
  }
  if (typeof packetHex !== "string") {
    const err = new Error('Missing Packets[0].Value.');
    err.statusCode = 400;
    throw err;
  }

  return { receivedTimestampMs, packetHex, terminalId };
}

/* ===================== EMAIL ===================== */

function buildEmail({ receivedUtc, messageUtc, unpacked }) {
  const firstLine = `Horario de recepción servidor: ${receivedUtc}`;

  if (unpacked.kind === "info") {
    const lines = [
      firstLine,
      `Horario de envío: ${messageUtc}`,
      `Latitud: ${unpacked.latitude}`,
      `Longitud: ${unpacked.longitude}`,
      `Elevación: ${unpacked.elevation}`,
      `Temperatura: ${unpacked.temperature}`,
      `Voltaje: ${unpacked.battery_voltage}`,
    ];

    return {
      subject: "aIgrOT info",
      html: `<p>${lines.join("<br/>")}</p>`,
    };
  }

  const subject = unpacked.alert_status
    ? "aIgrOT: ALERTA bebedero sin agua"
    : "aIgrOT: bebedero con agua nuevamente";

  const lines = [
    firstLine,
    `Horario: ${messageUtc}`,
  ];

  return {
    subject,
    html: `<p>${lines.join("<br/>")}</p>`,
  };
}

/* ===================== HANDLER ===================== */

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    if (!process.env.RESEND_API_KEY || !process.env.RESEND_API_KEY_PAPA) {
      return res.status(500).json({ error: "Missing Resend API keys" });
    }

    const { receivedTimestampMs, packetHex, terminalId } = extractWebhook(req.body);

    const receivedUtc = utcFromMs(receivedTimestampMs);

    const unpacked = unpackPacket(packetHex);
    const messageUtc = utcFromSeconds(unpacked.device_time_s);

    const { subject, html } = buildEmail({ receivedUtc, messageUtc, unpacked });

    // Enviar a ambas cuentas
    const [mainEmail, papaEmail] = await Promise.all([
      resend.emails.send({
        from: "onboarding@resend.dev",
        to: ["santosbogo@gmail.com"],
        subject,
        html,
      }),
      resendPapa.emails.send({
        from: "onboarding@resend.dev",
        to: ["EMAIL_PAPA@DOMINIO.COM"],
        subject,
        html,
      }),
    ]);

    return res.status(200).json({
      "Horario recepcion servidor": receivedUtc,
      ...(terminalId ? { TerminalId: terminalId } : {}),
      subject,
      "Horario de envío": messageUtc,
      unpacked,
      resend: {
        main: mainEmail,
        papa: papaEmail,
      },
    });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ error: e.message || "Internal error" });
  }
}