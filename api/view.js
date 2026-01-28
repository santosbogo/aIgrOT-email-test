function isHexString(s) {
  return typeof s === "string" && s.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(s);
}

function toUtcStringFromMs(epochMs) {
  const d = new Date(epochMs);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
    d.getUTCHours()
  )}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

function unpackPacket(hex) {
  if (!isHexString(hex)) {
    const err = new Error("Invalid hex string in Packets[0].Value.");
    err.statusCode = 400;
    throw err;
  }

  const buf = Buffer.from(hex, "hex");

  // Python formats:
  // FULL:  "<IIiihbH" => 21 bytes
  // ALERT: "<II?"     => 9 bytes
  const MESSAGE_SIZE_FULL = 21;
  const MESSAGE_SIZE_ALERT = 9;

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
      Type: "Periodic uplink",
      "Sequence Number": sequence_number,
      Latitude: latitude * 1e-7,
      Longitude: longitude * 1e-7,
      "Altitude (meters)": elevation,
      "Temperature (degrees C)": temperature,
      "Battery Voltage (mV)": battery_voltage,
      // si querés conservar el time del dispositivo:
      "Device Time (epoch s)": time,
    };
  }

  if (buf.length === MESSAGE_SIZE_ALERT) {
    let o = 0;
    const sequence_number = buf.readUInt32LE(o); o += 4;
    const time = buf.readUInt32LE(o); o += 4;
    const alert_status = buf.readUInt8(o) !== 0;

    return {
      Type: "Alert uplink",
      "Sequence Number": sequence_number,
      "Alert Status": alert_status,
      // si querés conservar el time del dispositivo:
      "Device Time (epoch s)": time,
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
  const receivedTimestampMs = pkt?.Timestamp;
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

export default function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method Not Allowed. Use POST." });
    }

    const { receivedTimestampMs, packetHex, terminalId } = extractWebhook(req.body);
    const unpacked = unpackPacket(packetHex);

    // “timestamp real arriba (UTC)” siempre:
    const response = {
      "Message Received (epoch ms)": receivedTimestampMs,
      "Message Received (UTC)": toUtcStringFromMs(receivedTimestampMs),
      ...(terminalId ? { TerminalId: terminalId } : {}),
      ...unpacked,
    };

    return res.status(200).json(response);
  } catch (e) {
    return res.status(e.statusCode || 500).json({ error: e.message || "Internal error" });
  }
}