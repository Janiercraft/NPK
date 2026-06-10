const mqtt = require("mqtt");
const SensorData = require("../models/SensorData");

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
};

// Convierte y valida números
const toNumber = (value) => {
  const number = Number(value);
  return Number.isNaN(number) ? null : number;
};

client.on("connect", () => {
  console.log("MQTT conectado");

  client.subscribe("npk/+/data", (err) => {
    if (err) {
      console.error("Error al suscribirse:", err.message);
      return;
    }

    console.log("Suscrito a: npk/+/data");
  });
});

client.on("message", async (topic, message) => {
  try {
    const rawPayload = message.toString();

    console.log("Mensaje MQTT recibido");
    console.log("Topic:", topic);
    console.log("Payload crudo:", rawPayload);

    const data = JSON.parse(rawPayload);

    // Ejemplo de topic:
    // npk/001/data
    const topicParts = topic.split("/");
    const sensorId = topicParts[1];

    if (!sensorId) {
      console.error("Topic inválido. No se pudo obtener sensorId:", topic);
      return;
    }

    const nitrogeno = toNumber(data.nitrogeno);
    const fosforo = toNumber(data.fosforo);
    const potasio = toNumber(data.potasio);

    const humedad_suelo = toNumber(
      data.humedad_suelo ?? data.humedadSuelo ?? data.humedad ?? data.humidity
    );

    const temperatura_ambiente = toNumber(
      data.temperatura_ambiente ?? data.temperaturaAmbiente ?? data.temperatura ?? data.temp
    );

    if (
      nitrogeno === null ||
      fosforo === null ||
      potasio === null ||
      humedad_suelo === null ||
      temperatura_ambiente === null
    ) {
      console.error("Datos inválidos recibidos:", {
        sensorId,
        nitrogeno,
        fosforo,
        potasio,
        humedad_suelo,
        temperatura_ambiente,
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

    // Enviar al frontend en tiempo real, si después usas Socket.IO
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

// Export compatible con deviceRoutes
module.exports = {
  client,
  setIO,

  publish: (topic, payload, options, callback) => {
    return client.publish(topic, payload, options, callback);
  }
};