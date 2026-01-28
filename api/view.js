export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // 1. Body completo
    const body = req.body;

    // 2. Data viene como string JSON
    const parsedData = JSON.parse(body.Data);

    // 3. Tomamos el primer packet (ajustable)
    const hexValue = parsedData.Packets[0].Value;

    // 4. Desempaquetamos
    const unpacked = unpack(hexValue);

    // 5. Respondemos
    res.status(200).json(unpacked);
  } catch (err) {
    res.status(400).json({
      error: err.message,
    });
  }
}

/* =======================
   UNPACK LOGIC (JS)
   ======================= */

const MESSAGE_SIZE_FULL = 19;
const MESSAGE_SIZE_ALERT = 9;

function unpack(packetHex) {
  const buffer = Buffer.from(packetHex, "hex");

  if (buffer.length === MESSAGE_SIZE_FULL) {
    let offset = 0;

    const sequenceNumber = buffer.readUInt32LE(offset); offset += 4;
    const time = buffer.readUInt32LE(offset); offset += 4;
    const latitude = buffer.readInt32LE(offset); offset += 4;
    const longitude = buffer.readInt32LE(offset); offset += 4;
    const elevation = buffer.readInt16LE(offset); offset += 2;
    const temperature = buffer.readInt8(offset); offset += 1;
    const batteryVoltage = buffer.readUInt16LE(offset);

    return {
      Type: "Periodic uplink",
      "Sequence Number": sequenceNumber,
      "Time (epoch s)": time,
      "Time (UTC)": new Date(time * 1000).toISOString(),
      Latitude: latitude * 1e-7,
      Longitude: longitude * 1e-7,
      "Altitude (meters)": elevation,
      "Temperature (degrees C)": temperature,
      "Battery Voltage (mV)": batteryVoltage,
    };
  }

  if (buffer.length === MESSAGE_SIZE_ALERT) {
    let offset = 0;

    const sequenceNumber = buffer.readUInt32LE(offset); offset += 4;
    const time = buffer.readUInt32LE(offset); offset += 4;
    const hasWater = buffer.readUInt8(offset);

    return {
      Type: "Alert uplink",
      "Sequence Number": sequenceNumber,
      "Time (epoch s)": time,
      "Time (UTC)": new Date(time * 1000).toISOString(),
      "Has Water": Boolean(hasWater),
    };
  }

  throw new Error(
    `Unknown packet size: ${buffer.length} bytes (expected ${MESSAGE_SIZE_FULL} or ${MESSAGE_SIZE_ALERT})`
  );
}