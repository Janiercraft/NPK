const mqtt = require("mqtt");
const SensorData = require("../models/SensorData");
const { saveEspLog, setIO: setLogIO } = require("./logService");
const {
  setIO: setOtaIO,
  applyOtaStatus
} = require("./otaService");

const MQTT_BROKER = process.env.MQTT_BROKER || "mqtt://broker.hivemq.com:1883";

console.log("Conectando a MQTT:", MQTT_BROKER);

const client = mqtt.connect(MQTT_BROKER, {
  reconnectPeriod: 5000,
  connectTimeout: 30000,
  clean: true
});

let io = null;

const setIO = (ioInstance) => {
  io = ioInstance;
  setLogIO(ioInstance);
  setOtaIO(ioInstance);
};

const toRequiredNumber = (value) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isNaN(number) ? null : number;
};

const toOptionalNumber = (value) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isNaN(number) ? null : number;
};

const getSensorIdFromTopic = (topic) => {
  const topicParts = topic.split("/");
  return topicParts[1] || null;
};

const isLogTopic = (topic) => {
  const parts = topic.split("/");

  if (parts.length < 3 || parts[0] !== "npk") {
    return false;
  }

  return ["log", "logs"].includes(parts[2].toLowerCase());
};

const isOtaStatusTopic = (topic) => {
  return /^npk\/[^/]+\/ota\/status$/.test(topic);
};

const isSensorDataTopic = (topic, sensorId) => {
  return topic === `npk/${sensorId}/data`;
};

const parseSensorData = (rawPayload) => {
  try {
    return JSON.parse(rawPayload);
  } catch (error) {
    throw new Error(`Payload JSON inválido: ${error.message}`);
  }
};

const parseJsonObject = (rawPayload) => {
  try {
    const data = JSON.parse(rawPayload);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("El payload JSON debe ser un objeto.");
    }
    return data;
  } catch (error) {
    throw new Error(`Payload JSON inválido: ${error.message}`);
  }
};

const publishAsync = (topic, payload, options = {}) => {
  return new Promise((resolve, reject) => {
    if (!client.connected) {
      const error = new Error("MQTT desconectado.");
      error.code = "MQTT_DISCONNECTED";
      reject(error);
      return;
    }

    client.publish(topic, payload, options, (error) => {
      if (error) {
        const publishError = new Error(`Falló publish MQTT en ${topic}: ${error.message}`);
        publishError.code = "MQTT_PUBLISH_FAILED";
        publishError.cause = error;
        reject(publishError);
        return;
      }

      resolve({ topic, payload });
    });
  });
};

client.on("connect", () => {
  console.log("MQTT conectado");

  client.subscribe(
    [
      "npk/+/data",
      "npk/+/logs",
      "npk/+/log",
      "npk/+/status",
      "npk/+/ota/status"
    ],
    { qos: 1 },
    (err) => {
      if (err) {
        console.error("Error al suscribirse a topics NPK:", err.message);
        return;
      }

      console.log("Suscrito a: npk/+/data, npk/+/logs, npk/+/log, npk/+/status, npk/+/ota/status");
    }
  );
});

client.on("message", async (topic, message) => {
  const rawPayload = message.toString();
  const sensorId = getSensorIdFromTopic(topic);

  if (isOtaStatusTopic(topic)) {
    try {
      const payload = parseJsonObject(rawPayload);
      const result = await applyOtaStatus({
        sensorId,
        payload,
        topic
      });

      if (!result.matched) {
        console.warn("Estado OTA recibido sin trabajo asociado:", {
          sensorId,
          status: result.error?.status,
          topic
        });
      }
    } catch (error) {
      console.error("Error procesando estado OTA:", error.message);
      console.error("Topic OTA:", topic);
      console.error("Payload OTA:", rawPayload);
    }

    return;
  }

  if (isLogTopic(topic)) {
    try {
      const savedLog = await saveEspLog({
        topic,
        rawPayload,
        sensorId
      });

      console.log("Log ESP32 guardado:", savedLog.id);
    } catch (error) {
      console.error("Error guardando log ESP32:", error.message);
      console.error("Topic del log:", topic);
      console.error("Payload del log:", rawPayload);
    }

    return;
  }

  if (topic.endsWith("/status")) {
    console.log("Status MQTT recibido:", {
      topic,
      sensorId,
      payload: rawPayload
    });

    if (io) {
      io.emit("device-status", {
        sensor_id: sensorId,
        topic,
        payload: rawPayload,
        timestamp: new Date()
      });
    }

    return;
  }

  if (!isSensorDataTopic(topic, sensorId)) {
    return;
  }

  try {
    console.log("Mensaje MQTT recibido");
    console.log("Topic:", topic);
    console.log("Payload crudo:", rawPayload);

    const data = parseSensorData(rawPayload);

    if (!sensorId) {
      console.error("Topic inválido. No se pudo obtener sensorId:", topic);
      return;
    }

    const nitrogeno = toRequiredNumber(data.nitrogeno);
    const fosforo = toRequiredNumber(data.fosforo);
    const potasio = toRequiredNumber(data.potasio);

    const humedad_suelo = toOptionalNumber(
      data.humedad_suelo ??
      data.humedadSuelo ??
      data.humedad ??
      data.humidity
    );

    const temperatura_ambiente = toOptionalNumber(
      data.temperatura_ambiente ??
      data.temperaturaAmbiente ??
      data.temperatura ??
      data.temp
    );

    if (
      nitrogeno === null ||
      fosforo === null ||
      potasio === null
    ) {
      console.error("Datos NPK inválidos recibidos:", {
        sensorId,
        nitrogeno,
        fosforo,
        potasio,
        payloadOriginal: data
      });
      return;
    }

    console.log(`Sensor: ${sensorId}`);
    console.log("Dato recibido:", {
      nitrogeno,
      fosforo,
      potasio,
      humedad_suelo,
      temperatura_ambiente
    });

    const saved = await SensorData.create({
      sensor_id: sensorId,
      nitrogeno,
      fosforo,
      potasio,
      humedad_suelo,
      temperatura_ambiente,
      timestamp: new Date()
    });

    console.log("Guardado en MongoDB:", saved._id);

    if (io) {
      io.emit("npk-data", {
        sensor_id: saved.sensor_id,
        nitrogeno: saved.nitrogeno,
        fosforo: saved.fosforo,
        potasio: saved.potasio,
        humedad_suelo: saved.humedad_suelo,
        temperatura_ambiente: saved.temperatura_ambiente,
        timestamp: saved.timestamp
      });
    }
  } catch (error) {
    console.error("Error procesando mensaje MQTT:", error.message);
  }
});

client.on("error", (error) => {
  console.error("Error MQTT:", error.message);
});

client.on("reconnect", () => {
  console.log("Reintentando conexión MQTT...");
});

client.on("close", () => {
  console.log("Conexión MQTT cerrada");
});

module.exports = {
  client,
  setIO,
  isConnected: () => client.connected,
  publishAsync,
  publish: (topic, payload, options, callback) => {
    return client.publish(topic, payload, options, callback);
  }
};
