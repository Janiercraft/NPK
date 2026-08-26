require("dotenv").config();

const http = require("http");
const mqtt = require("mqtt");
const mongoose = require("mongoose");
const { Server } = require("socket.io");

const app = require("../src/app");
const connectDB = require("../src/config/database");
const mqttService = require("../src/services/mqttService");
const SensorData = require("../src/models/SensorData");
const OtaJob = require("../src/models/OtaJob");

const TEST_SENSOR_ID = process.env.OTA_TEST_SENSOR_ID || "998";
const TEST_VERSION = process.env.OTA_TEST_VERSION || "1.1.0";
const TEST_SHA256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const TEST_URL = "https://example.com/NPK_Smart_Cacao_1.1.0.bin";

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  const body = await response.json();
  return { response, body };
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (predicate, timeoutMs = 10000, intervalMs = 100) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await sleep(intervalMs);
  }
  throw new Error("Timeout esperando condición de prueba.");
};

const main = async () => {
  await connectDB();

  await SensorData.create({
    sensor_id: TEST_SENSOR_ID,
    nitrogeno: 10,
    fosforo: 5,
    potasio: 20,
    humedad_suelo: 45,
    temperatura_ambiente: 25,
    timestamp: new Date()
  });

  const commandMessages = [];
  const socketEvents = [];

  const commandClient = mqtt.connect(process.env.MQTT_BROKER || "mqtt://broker.hivemq.com:1883", {
    reconnectPeriod: 1000,
    connectTimeout: 15000,
    clean: true
  });

  await new Promise((resolve, reject) => {
    commandClient.on("connect", resolve);
    commandClient.on("error", reject);
  });

  await new Promise((resolve, reject) => {
    commandClient.subscribe(`npk/${TEST_SENSOR_ID}/cmd`, { qos: 1 }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  commandClient.on("message", (topic, message) => {
    commandMessages.push({ topic, payload: message.toString() });
  });

  const httpServer = http.createServer(app);
  const io = new Server(httpServer, { cors: { origin: "*" } });

  // Espía el emit real de Socket.IO sin sustituir la instancia.
  // Así la prueba valida el mismo objeto que usa el backend en producción.
  const originalIoEmit = io.emit.bind(io);
  io.emit = (event, payload) => {
    socketEvents.push({ event, payload });
    return originalIoEmit(event, payload);
  };

  mqttService.setIO(io);

  await new Promise((resolve) => httpServer.listen(0, resolve));
  const port = httpServer.address().port;

  try {
    await waitFor(() => mqttService.isConnected(), 15000);

    const create = await fetchJson(`http://127.0.0.1:${port}/api/device/${TEST_SENSOR_ID}/ota`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: TEST_VERSION,
        url: TEST_URL,
        sha256: TEST_SHA256
      })
    });

    if (create.response.status !== 202 || !create.body.ok) {
      throw new Error(`Solicitud OTA inesperada: ${create.response.status} ${JSON.stringify(create.body)}`);
    }

    const jobId = create.body.job.job_id;

    await waitFor(() => commandMessages.some((item) => {
      try {
        const payload = JSON.parse(item.payload);
        return item.topic === `npk/${TEST_SENSOR_ID}/cmd` && payload.command === "OTA" && payload.job_id === jobId;
      } catch (_error) {
        return false;
      }
    }), 10000);

    const command = commandMessages
      .map((item) => ({ item, parsed: JSON.parse(item.payload) }))
      .find(({ parsed }) => parsed.job_id === jobId);

    const publishStatus = async (status, progress, message) => {
      const deviceClient = commandClient;
      await new Promise((resolve, reject) => {
        deviceClient.publish(
          `npk/${TEST_SENSOR_ID}/ota/status`,
          JSON.stringify({
            sensor_id: TEST_SENSOR_ID,
            job_id: jobId,
            version: TEST_VERSION,
            status,
            progress,
            message
          }),
          { qos: 1 },
          (error) => (error ? reject(error) : resolve())
        );
      });
    };

    await publishStatus("OTA_DOWNLOADING", 50, "Descargando");
    await waitFor(async () => {
      const job = await OtaJob.findOne({ job_id: jobId }).lean();
      return job?.status === "OTA_DOWNLOADING" && job.progress === 50;
    });

    await publishStatus("OTA_SUCCESS", 100, "Actualización completada");
    await waitFor(async () => {
      const job = await OtaJob.findOne({ job_id: jobId }).lean();
      return job?.status === "OTA_SUCCESS" && job.progress === 100 && Boolean(job.completed_at);
    });

    const latest = await fetchJson(`http://127.0.0.1:${port}/api/device/${TEST_SENSOR_ID}/ota/status`);
    const history = await fetchJson(`http://127.0.0.1:${port}/api/device/${TEST_SENSOR_ID}/ota/history?limit=10`);

    if (latest.response.status !== 200 || latest.body.job.job_id !== jobId) {
      throw new Error("El endpoint de último estado OTA no coincide con el trabajo probado.");
    }

    if (history.response.status !== 200 || !history.body.jobs.some((item) => item.job_id === jobId)) {
      throw new Error("El historial OTA no contiene el trabajo probado.");
    }

    if (!socketEvents.some((item) => item.event === "ota:status" && item.payload.job_id === jobId)) {
      throw new Error("No se observó el evento Socket.IO ota:status.");
    }

    console.log("OTA SIMULADA OK");
    console.log(JSON.stringify({
      job_id: jobId,
      published_topic: command.item.topic,
      command: command.parsed,
      latest_status: latest.body.job.status,
      history_entries: history.body.count,
      socket_ota_events: socketEvents.filter((item) => item.event === "ota:status").length
    }, null, 2));
  } finally {
    await OtaJob.deleteMany({ sensor_id: TEST_SENSOR_ID });
    await SensorData.deleteMany({ sensor_id: TEST_SENSOR_ID });
    io.close();
    httpServer.close();
    commandClient.end(true);
    await mongoose.connection.close();
  }
};

main().catch(async (error) => {
  console.error("OTA SIMULADA FALLÓ:", error.message);
  try {
    await mongoose.connection.close();
  } catch (_error) {}
  process.exit(1);
});
