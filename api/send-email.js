import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const resendPapa = new Resend(process.env.RESEND_API_KEY_PAPA);

function isHexString(s) {
  return typeof s === "string" && s.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(s);
}

function utcFromMs(epochMs) {
  const d = new Date(epochMs);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
    d.getUTCHours()
  )}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

function utcFromSeconds(epochSeconds) {
  return utcFromMs(epochSeconds * 1000);
}

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
    const time = buf.readUInt32LE(o); o += 4; // device time (epoch s)
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
    const time = buf.readUInt32LE(o); o += 4; // device time (epoch s)
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
  const receivedTimestampMs = pkt?.Timestamp; // ms
  const packetHex = pkt?.Value;
  const terminalId = pkt?.TerminalId ?? null;

  if (typeof receivedTimestampMs !== "number") {
    const err = new Error('Missing Packets[0].Timestamp inside Data.');
    err.statusCode = 400;
    throw err;
  }
  if (typeof packetHex !== "string") {
    const err = new Error('Missing Packets[0].Value inside Data.');
    err.statusCode = 400;
    throw err;
  }

  return { receivedTimestampMs, packetHex, terminalId };
}

function buildEmail({ receivedUtc, messageUtc, unpacked }) {
  // Primera línea SIEMPRE
  const firstLine = `Horario de recepción: ${receivedUtc}`;

  if (unpacked.kind === "info") {
    const subject = "aIgrOT info";
    const lines = [
      firstLine,
      `Horario del mensaje: ${messageUtc}`,
    ];
    return { subject, html: `<p>${lines.join("<br/>")}</p>` };
  }

  // alerta
  const subject = unpacked.alert_status
    ? "aIgrOT: ALERTA bebedero sin agua"
    : "aIgrOT: bebedero con agua nuevamente";

  const lines = [
    firstLine,
    `Horario: ${messageUtc}`,
  ];

  return { subject, html: `<p>${lines.join("<br/>")}</p>` };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method Not Allowed. Use POST." });
    }

    if (!process.env.RESEND_API_KEY) {
      return res.status(500).json({ error: "Missing RESEND_API_KEY env var." });
    }

    const { receivedTimestampMs, packetHex, terminalId } = extractWebhook(req.body);

    const receivedUtc = utcFromMs(receivedTimestampMs);

    const unpacked = unpackPacket(packetHex);
    const messageUtc = utcFromSeconds(unpacked.device_time_s);

    const { subject, html } = buildEmail({ receivedUtc, messageUtc, unpacked });

    // Envío
    const [emailMain, emailPapa] = await Promise.all([
  resend.emails.send({
    from: "onboarding@resend.dev",
    to: ["santosbogo@gmail.com"],
    subject,
    html,
  }),
  resendPapa.emails.send({
    from: "onboarding@resend.dev",
    to: ["tomasbogo@gmail.com"],
    subject,
    html,
  }),
]);

    // Respuesta del endpoint (incluye lo desempaquetado y el email)
    return res.status(200).json({
  "Horario de recepción (UTC)": receivedUtc,
  ...(terminalId ? { TerminalId: terminalId } : {}),
  subject,
  "Horario del mensaje (UTC)": messageUtc,
  unpacked,
  resend: {
    main: emailMain,
    papa: emailPapa,
  },
});
  } catch (e) {
    return res.status(e.statusCode || 500).json({ error: e.message || "Internal error" });
  }
}