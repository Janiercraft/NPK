const mqtt = require("mqtt");
const SensorData = require("../models/SensorData");
const { saveEspLog, setIO: setLogIO } = require("./logService");

// Broker MQTT desde .env o valor por defecto
const MQTT_BROKER = process.env.MQTT_BROKER || "mqtt://broker.hivemq.com:1883";

console.log("Conectando a MQTT:", MQTT_BROKER);

const client = mqtt.connect(MQTT_BROKER, {
  reconnectPeriod: 5000,
  connectTimeout: 30000,
  clean: true
});

// Socket.IO
let io = null;

const setIO = (ioInstance) => {
  io = ioInstance;
  setLogIO(ioInstance);
};

// NPK obligatorio
const toRequiredNumber = (value) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isNaN(number) ? null : number;
};

// Humedad y temperatura opcionales
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

const parseSensorData = (rawPayload) => {
  try {
    return JSON.parse(rawPayload);
  } catch (error) {
    throw new Error(`Payload JSON inválido: ${error.message}`);
  }
};

client.on("connect", () => {
  console.log("MQTT conectado");

  // Datos NPK
  client.subscribe("npk/+/data", { qos: 1 }, (err) => {
    if (err) {
      console.error("Error al suscribirse a datos:", err.message);
      return;
    }

    console.log("Suscrito a: npk/+/data");
  });

  // Logs del ESP32. Se contemplan ambas variantes: /log y /logs.
  client.subscribe(["npk/+/log", "npk/+/logs"], { qos: 1 }, (err) => {
    if (err) {
      console.error("Error al suscribirse a logs:", err.message);
      return;
    }

    console.log("Suscrito a: npk/+/log y npk/+/logs");
  });
});

client.on("message", async (topic, message) => {
  const rawPayload = message.toString();
  const sensorId = getSensorIdFromTopic(topic);

  // IMPORTANTE: los logs se procesan primero y nunca se descartan por
  // tener JSON inválido, campos faltantes o formato inesperado.
  if (isLogTopic(topic)) {
    try {
      const savedLog = await saveEspLog({
        topic,
        rawPayload,
        sensorId
      });

      console.log("Log ESP32 guardado:", savedLog.id);
    } catch (error) {
      // Si MongoDB falla, conservamos el mensaje en consola para que no
      // desaparezca del proceso. No se intenta interpretar el log como
      // lectura de sensor.
      console.error("Error guardando log ESP32:", error.message);
      console.error("Topic del log:", topic);
      console.error("Payload del log:", rawPayload);
    }

    return;
  }

  if (topic !== `npk/${sensorId}/data`) {
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

    // Solo NPK es obligatorio
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

    // Guardar en MongoDB
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

    // Enviar al frontend en tiempo real
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

  publish: (topic, payload, options, callback) => {
    return client.publish(topic, payload, options, callback);
  }
};
