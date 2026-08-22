const EspLog = require("../models/EspLog");

let io = null;

const setIO = (ioInstance) => {
  io = ioInstance;
};

const normalizeLevel = (value) => {
  if (!value) return "INFO";

  const normalized = String(value).trim().toUpperCase();

  const allowed = ["TRACE", "DEBUG", "INFO", "WARN", "WARNING", "ERROR", "FATAL"];

  return allowed.includes(normalized) ? normalized : "INFO";
};

const isValidDate = (value) => {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
};

const extractLogFields = (parsedPayload) => {
  if (!parsedPayload || typeof parsedPayload !== "object" || Array.isArray(parsedPayload)) {
    return {
      level: "INFO",
      message: typeof parsedPayload === "string" ? parsedPayload : ""
    };
  }

  const message =
    parsedPayload.message ??
    parsedPayload.msg ??
    parsedPayload.log ??
    parsedPayload.text ??
    "";

  const deviceTimestampCandidate =
    parsedPayload.timestamp ??
    parsedPayload.time ??
    parsedPayload.datetime ??
    parsedPayload.created_at ??
    parsedPayload.createdAt ??
    null;

  return {
    level: normalizeLevel(
      parsedPayload.level ??
      parsedPayload.severity ??
      parsedPayload.type
    ),
    message: typeof message === "string" ? message : JSON.stringify(message),
    device_timestamp: isValidDate(deviceTimestampCandidate)
      ? new Date(deviceTimestampCandidate)
      : null
  };
};

const saveEspLog = async ({ topic, rawPayload, sensorId }) => {
  let parsedPayload = null;
  let jsonParsed = false;

  try {
    parsedPayload = JSON.parse(rawPayload);
    jsonParsed = true;
  } catch (_error) {
    // Los logs no se descartan aunque no sean JSON.
  }

  const fields = extractLogFields(parsedPayload ?? rawPayload);

  const log = await EspLog.create({
    sensor_id: sensorId || null,
    topic,
    level: fields.level,
    message: fields.message,
    raw_payload: rawPayload,
    payload: jsonParsed ? parsedPayload : null,
    device_timestamp: fields.device_timestamp || null,
    received_at: new Date()
  });

  const event = {
    id: String(log._id),
    sensor_id: log.sensor_id,
    topic: log.topic,
    level: log.level,
    message: log.message,
    raw_payload: log.raw_payload,
    payload: log.payload,
    device_timestamp: log.device_timestamp,
    received_at: log.received_at
  };

  if (io) {
    io.emit("esp-log", event);
  }

  return event;
};

module.exports = {
  saveEspLog,
  setIO
};
