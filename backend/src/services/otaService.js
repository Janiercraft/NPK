const crypto = require("crypto");
const https = require("https");
const OtaJob = require("../models/OtaJob");
const SensorData = require("../models/SensorData");
const EspLog = require("../models/EspLog");
const { saveEspLog } = require("./logService");

const SUCCESSFUL_STATUSES = new Set([
  "OTA_SUCCESS",
  "SUCCESS",
  "COMPLETED",
  "OTA_COMPLETED"
]);

const TERMINAL_STATUSES = new Set([
  "OTA_SUCCESS",
  "SUCCESS",
  "OTA_ROLLBACK_SUCCESS",
  "OTA_ERROR",
  "ERROR",
  "FAILED",
  "REJECTED",
  "OTA_REJECTED",
  "MQTT_ERROR",
  "MQTT_PUBLISH_FAILED"
]);

const MQTT_PREFIX = "npk";

const DEFAULT_OTA_MAX_FIRMWARE_SIZE = 1572864;
const MAX_FIRMWARE_REDIRECTS = 5;
const METADATA_REQUEST_TIMEOUT_MS = 15000;

const getMaxFirmwareSize = () => {
  const configured = Number(process.env.OTA_MAX_FIRMWARE_SIZE);
  return Number.isInteger(configured) && configured > 0
    ? configured
    : DEFAULT_OTA_MAX_FIRMWARE_SIZE;
};

const normalizeRemoteUrl = (value) => {
  try {
    const parsed = new URL(String(value || ""));
    if (parsed.protocol !== "https:") return null;
    return parsed;
  } catch (_error) {
    return null;
  }
};

const requestHttpsHeaders = (url, { method = "HEAD", headers = {} } = {}) => {
  const parsed = normalizeRemoteUrl(url);

  if (!parsed) {
    const error = new Error("La URL OTA remota debe ser HTTPS.");
    error.code = "OTA_FIRMWARE_METADATA_ERROR";
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    const request = https.request(parsed, {
      method,
      headers: {
        "User-Agent": "NPK-Smart-Cacao-OTA/1.0",
        "Accept": "application/octet-stream,*/*",
        "Accept-Encoding": "identity",
        ...headers
      },
      timeout: METADATA_REQUEST_TIMEOUT_MS
    }, (response) => {
      const location = response.headers.location || null;
      const statusCode = response.statusCode || 0;
      const contentLengthHeader = response.headers["content-length"];
      const contentRange = response.headers["content-range"] || null;
      const contentLength = contentLengthHeader
        ? Number(contentLengthHeader)
        : null;

      // We only need response headers. Do not download the complete firmware.
      response.resume();

      resolve({
        statusCode,
        location,
        contentLength: Number.isInteger(contentLength) && contentLength >= 0 ? contentLength : null,
        contentRange,
        headers: response.headers
      });
    });

    request.on("timeout", () => {
      request.destroy(new Error("Timeout consultando metadatos del firmware OTA."));
    });

    request.on("error", reject);
    request.end();
  });
};

const extractTotalFromContentRange = (value) => {
  if (!value) return null;
  const match = /\/([0-9]+)$/.exec(String(value).trim());
  if (!match) return null;
  const size = Number(match[1]);
  return Number.isInteger(size) && size >= 0 ? size : null;
};

const resolveFirmwareMetadata = async (initialUrl, redirectCount = 0) => {
  if (redirectCount > MAX_FIRMWARE_REDIRECTS) {
    const error = new Error(`El firmware OTA excedió el máximo de ${MAX_FIRMWARE_REDIRECTS} redirecciones.`);
    error.code = "OTA_FIRMWARE_HTTP_ERROR";
    throw error;
  }

  const current = normalizeRemoteUrl(initialUrl);
  if (!current) {
    const error = new Error("La URL del firmware OTA debe ser HTTPS.");
    error.code = "OTA_FIRMWARE_METADATA_ERROR";
    throw error;
  }

  const currentUrl = current.toString();
  let head = await requestHttpsHeaders(currentUrl, { method: "HEAD" });

  if ([301, 302, 303, 307, 308].includes(head.statusCode)) {
    if (!head.location) {
      const error = new Error(`GitHub respondió ${head.statusCode} sin indicar Location.`);
      error.code = "OTA_FIRMWARE_HTTP_ERROR";
      throw error;
    }
    const redirectUrl = new URL(head.location, currentUrl).toString();
    if (!normalizeRemoteUrl(redirectUrl)) {
      const error = new Error("La redirección del firmware OTA no apunta a HTTPS.");
      error.code = "OTA_FIRMWARE_METADATA_ERROR";
      throw error;
    }
    return resolveFirmwareMetadata(redirectUrl, redirectCount + 1);
  }

  if ([405, 501].includes(head.statusCode) || (head.statusCode >= 400 && head.statusCode !== 404)) {
    const rangeResponse = await requestHttpsHeaders(currentUrl, {
      method: "GET",
      headers: { Range: "bytes=0-0" }
    });

    if ([301, 302, 303, 307, 308].includes(rangeResponse.statusCode)) {
      if (!rangeResponse.location) {
        const error = new Error(`Redirección HTTP ${rangeResponse.statusCode} sin Location.`);
        error.code = "OTA_FIRMWARE_HTTP_ERROR";
        throw error;
      }
      const redirectUrl = new URL(rangeResponse.location, currentUrl).toString();
      if (!normalizeRemoteUrl(redirectUrl)) {
        const error = new Error("La redirección del firmware OTA no apunta a HTTPS.");
        error.code = "OTA_FIRMWARE_METADATA_ERROR";
        throw error;
      }
      return resolveFirmwareMetadata(redirectUrl, redirectCount + 1);
    }

    if (![200, 206].includes(rangeResponse.statusCode)) {
      const error = new Error(`El servidor de firmware respondió HTTP ${rangeResponse.statusCode}.`);
      error.code = "OTA_FIRMWARE_HTTP_ERROR";
      throw error;
    }

    const size = extractTotalFromContentRange(rangeResponse.contentRange) ?? rangeResponse.contentLength;
    if (size === null || size <= 0) {
      const error = new Error("No se pudo determinar el tamaño del firmware remoto.");
      error.code = "OTA_FIRMWARE_SIZE_UNKNOWN";
      throw error;
    }

    return { url: currentUrl, size, statusCode: rangeResponse.statusCode, redirects: redirectCount };
  }

  if (head.statusCode !== 200 && head.statusCode !== 206) {
    const error = new Error(`El servidor de firmware respondió HTTP ${head.statusCode}.`);
    error.code = "OTA_FIRMWARE_HTTP_ERROR";
    throw error;
  }

  const size = head.contentLength ?? extractTotalFromContentRange(head.contentRange);
  if (size === null || size <= 0) {
    // Some object stores do not implement HEAD. Use a one-byte range request.
    const rangeResponse = await requestHttpsHeaders(currentUrl, {
      method: "GET",
      headers: { Range: "bytes=0-0" }
    });

    if ([301, 302, 303, 307, 308].includes(rangeResponse.statusCode)) {
      if (!rangeResponse.location) {
        const error = new Error(`Redirección HTTP ${rangeResponse.statusCode} sin Location.`);
        error.code = "OTA_FIRMWARE_HTTP_ERROR";
        throw error;
      }
      const redirectUrl = new URL(rangeResponse.location, currentUrl).toString();
      if (!normalizeRemoteUrl(redirectUrl)) {
        const error = new Error("La redirección del firmware OTA no apunta a HTTPS.");
        error.code = "OTA_FIRMWARE_METADATA_ERROR";
        throw error;
      }
      return resolveFirmwareMetadata(redirectUrl, redirectCount + 1);
    }

    const rangeSize = extractTotalFromContentRange(rangeResponse.contentRange) ?? rangeResponse.contentLength;
    if (![200, 206].includes(rangeResponse.statusCode) || rangeSize === null || rangeSize <= 0) {
      const error = new Error("No se pudo determinar el tamaño del firmware remoto.");
      error.code = "OTA_FIRMWARE_SIZE_UNKNOWN";
      throw error;
    }
    return { url: currentUrl, size: rangeSize, statusCode: rangeResponse.statusCode, redirects: redirectCount };
  }

  return { url: currentUrl, size, statusCode: head.statusCode, redirects: redirectCount };
};

let io = null;

const setIO = (ioInstance) => {
  io = ioInstance;
};

const mqttTopicForCommand = (sensorId) => `${MQTT_PREFIX}/${sensorId}/cmd`;
const mqttTopicForStatus = (sensorId) => `${MQTT_PREFIX}/${sensorId}/ota/status`;

const normalizeStatus = (value) => {
  const status = String(value || "").trim().toUpperCase();
  return status || "UNKNOWN";
};

const normalizeProgress = (value, fallback = 0) => {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.max(0, Math.min(100, Math.round(number)));
};

const isValidSensorId = (value) => {
  return /^[A-Za-z0-9_-]{1,32}$/.test(String(value || ""));
};

const isValidVersion = (value) => {
  return /^(?:v)?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(String(value || "").trim());
};

const isValidFirmwareUrl = (value) => {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch (_error) {
    return false;
  }
};

const isValidSha256 = (value) => {
  return /^[0-9a-fA-F]{64}$/.test(String(value || "").trim());
};

const validateOtaRequest = ({ sensorId, version, url, sha256, size }) => {
  const errors = [];

  if (!isValidSensorId(sensorId)) {
    errors.push("sensor_id inválido. Use entre 1 y 32 caracteres alfanuméricos, '_' o '-'.");
  }

  if (!isValidVersion(version)) {
    errors.push("version inválida. Use un formato como 1.1.0 o v1.1.0.");
  }

  if (!isValidFirmwareUrl(url)) {
    errors.push("url inválida. El firmware remoto debe usar HTTPS.");
  }

  if (!isValidSha256(sha256)) {
    errors.push("sha256 inválido. Debe contener exactamente 64 caracteres hexadecimales.");
  }

  if (size !== undefined && size !== null) {
    const numericSize = Number(size);
    if (!Number.isFinite(numericSize) || !Number.isInteger(numericSize) || numericSize < 0) {
      errors.push("size inválido. Debe ser un entero mayor o igual a 0.");
    }
  }

  return errors;
};

const getDeviceExists = async (sensorId) => {
  const [sensorData, espLog] = await Promise.all([
    SensorData.exists({ sensor_id: sensorId }),
    EspLog.exists({ sensor_id: sensorId })
  ]);

  return Boolean(sensorData || espLog);
};

const buildJobId = (sensorId) => {
  return `ota_${sensorId}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
};

const emitOta = (payload) => {
  if (io) {
    io.emit("ota:status", payload);
  }
};


const recordOtaLog = async ({ sensorId, topic, level = "INFO", message, payload }) => {
  try {
    await saveEspLog({
      sensorId,
      topic,
      rawPayload: JSON.stringify({
        level,
        ...(payload ?? { message })
      }),
    });
  } catch (error) {
    // El log es complementario al flujo OTA: no debe bloquear la actualización.
    console.error(`No se pudo registrar log OTA para ${sensorId}:`, error.message);
  }
};

const buildPublicJob = (job) => ({
  job_id: job.job_id,
  sensor_id: job.sensor_id,
  version: job.version,
  url: job.url,
  sha256: job.sha256,
  firmware_size: job.firmware_size,
  previous_version: job.previous_version,
  requested_by: job.requested_by,
  status: job.status,
  progress: job.progress,
  message: job.message,
  error: job.error,
  mqtt_topic: job.mqtt_topic,
  created_at: job.created_at,
  started_at: job.started_at,
  completed_at: job.completed_at,
  last_status_at: job.last_status_at
});

const getLatestJob = async (sensorId) => {
  return OtaJob.findOne({ sensor_id: sensorId })
    .sort({ created_at: -1, _id: -1 })
    .lean();
};

const getHistory = async (sensorId, limit = 100) => {
  const parsedLimit = Math.min(
    Math.max(Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : 100, 1),
    500
  );

  return OtaJob.find({ sensor_id: sensorId })
    .sort({ created_at: -1, _id: -1 })
    .limit(parsedLimit)
    .lean();
};

const requestOta = async ({ sensorId, version, url, sha256, size, requestedBy, previousVersion, mqttService }) => {
  const validationErrors = validateOtaRequest({
    sensorId,
    version,
    url,
    sha256,
    size
  });

  if (validationErrors.length) {
    const error = new Error(validationErrors.join(" "));
    error.code = "VALIDATION_ERROR";
    error.details = validationErrors;
    throw error;
  }

  const knownDevice = await getDeviceExists(sensorId);

  if (!knownDevice) {
    const error = new Error(`El ESP ${sensorId} no existe o todavía no ha sido visto por el backend.`);
    error.code = "DEVICE_NOT_FOUND";
    throw error;
  }

  if (!mqttService.isConnected()) {
    const error = new Error("MQTT está desconectado. No se puede enviar la orden OTA.");
    error.code = "MQTT_DISCONNECTED";
    throw error;
  }

  const normalizedRequest = {
    sensor_id: sensorId,
    version: String(version).trim(),
    url: String(url).trim(),
    sha256: String(sha256).trim().toLowerCase()
  };

  // Una OTA ya completada correctamente con los mismos parámetros no se debe
  // volver a enviar. El usuario deberá cambiar versión/URL/hash para crear
  // una nueva actualización. Los trabajos fallidos/rechazados sí permiten
  // reintento.
  const successfulJob = await OtaJob.findOne({
    ...normalizedRequest,
    status: { $in: Array.from(SUCCESSFUL_STATUSES) }
  }).sort({ completed_at: -1, created_at: -1, _id: -1 });

  if (successfulJob) {
    return {
      duplicate: true,
      alreadyCompleted: true,
      job: buildPublicJob(successfulJob)
    };
  }

  // Mientras una OTA esté en curso, una segunda solicitud idéntica tampoco
  // debe publicar otra orden MQTT.
  const existingJob = await OtaJob.findOne({
    ...normalizedRequest,
    status: { $nin: Array.from(TERMINAL_STATUSES) }
  }).sort({ created_at: -1, _id: -1 });

  if (existingJob) {
    return {
      duplicate: true,
      alreadyCompleted: false,
      job: buildPublicJob(existingJob)
    };
  }

  let resolvedMetadata;
  try {
    resolvedMetadata = await resolveFirmwareMetadata(url);
  } catch (error) {
    throw error;
  }

  const configuredMax = getMaxFirmwareSize();
  if (resolvedMetadata.size > configuredMax) {
    const error = new Error(
      `El firmware remoto mide ${resolvedMetadata.size} bytes y supera el máximo OTA configurado de ${configuredMax} bytes.`
    );
    error.code = "OTA_FIRMWARE_TOO_LARGE";
    throw error;
  }

  if (size !== undefined && size !== null && Number(size) > 0 && Number(size) !== resolvedMetadata.size) {
    const error = new Error(
      `El size indicado (${Number(size)}) no coincide con el tamaño real del firmware (${resolvedMetadata.size} bytes).`
    );
    error.code = "OTA_SIZE_MISMATCH";
    throw error;
  }

  const jobId = buildJobId(sensorId);
  const mqttTopic = mqttTopicForCommand(sensorId);
  const normalizedFirmwareSize = resolvedMetadata.size;

  const job = await OtaJob.create({
    job_id: jobId,
    sensor_id: sensorId,
    version: String(version).trim(),
    url: String(url).trim(),
    sha256: String(sha256).trim().toLowerCase(),
    firmware_size: normalizedFirmwareSize,
    previous_version: previousVersion ? String(previousVersion).trim() : null,
    requested_by: requestedBy ? String(requestedBy).trim() : null,
    status: "REQUESTED",
    progress: 0,
    message: "OTA solicitada; preparando publicación MQTT.",
    mqtt_topic: mqttTopic,
    last_status_at: new Date()
  });

  emitOta({
    ...buildPublicJob(job),
    event: "requested"
  });

  await recordOtaLog({
    sensorId,
    topic: mqttTopic,
    level: "INFO",
    message: `OTA solicitada para ${sensorId}: ${job.version}`,
    payload: {
      event: "OTA_REQUESTED",
      job_id: job.job_id,
      version: job.version,
      url: job.url,
      sha256: job.sha256
    }
  });

  const commandPayload = {
    command: "OTA",
    job_id: job.job_id,
    version: job.version,
    url: job.url,
    sha256: job.sha256,
    size: job.firmware_size,
    max_size: configuredMax
  };

  try {
    await mqttService.publishAsync(mqttTopic, JSON.stringify(commandPayload), {
      qos: 1,
      retain: false
    });
  } catch (error) {
    await OtaJob.findOneAndUpdate(
      { job_id: job.job_id },
      {
        $set: {
          status: "MQTT_ERROR",
          message: "No fue posible publicar la orden OTA por MQTT.",
          error: error.message,
          last_status_at: new Date()
        }
      },
      { returnDocument: "after" }
    );

    emitOta({
      job_id: job.job_id,
      sensor_id: job.sensor_id,
      version: job.version,
      status: "MQTT_ERROR",
      progress: 0,
      message: "No fue posible publicar la orden OTA por MQTT.",
      error: error.message
    });

    throw error;
  }

  const sentJob = await OtaJob.findOneAndUpdate(
    { job_id: job.job_id },
    {
      $set: {
        status: "MQTT_SENT",
        message: "Orden OTA enviada por MQTT.",
        last_status_at: new Date()
      }
    },
    { returnDocument: "after" }
  );

  emitOta({
    ...buildPublicJob(sentJob),
    event: "mqtt_sent"
  });

  await recordOtaLog({
    sensorId,
    topic: mqttTopic,
    level: "INFO",
    message: `OTA enviada por MQTT para ${sensorId}: ${sentJob.version}`,
    payload: {
      event: "OTA_MQTT_SENT",
      job_id: sentJob.job_id,
      topic: mqttTopic
    }
  });

  return {
    duplicate: false,
    job: buildPublicJob(sentJob),
    command: commandPayload
  };
};

const applyOtaStatus = async ({ sensorId, payload, topic }) => {
  const data = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const status = normalizeStatus(data.status ?? data.state ?? data.event);
  const version = data.version ? String(data.version).trim() : null;
  const jobId = data.job_id ? String(data.job_id).trim() : null;
  const progress = normalizeProgress(data.progress, TERMINAL_STATUSES.has(status) ? 100 : 0);
  const message = data.message ?? data.msg ?? data.detail ?? "";

  let job = null;

  if (jobId) {
    job = await OtaJob.findOne({ job_id: jobId, sensor_id: sensorId });
  }

  if (!job) {
    const filter = {
      sensor_id: sensorId,
      status: { $nin: Array.from(TERMINAL_STATUSES) }
    };

    if (version) {
      filter.version = version;
    }

    job = await OtaJob.findOne(filter).sort({ created_at: -1, _id: -1 });
  }

  if (!job && version) {
    job = await OtaJob.findOne({ sensor_id: sensorId, version })
      .sort({ created_at: -1, _id: -1 });
  }

  if (!job) {
    const error = new Error(`No existe un trabajo OTA activo para el sensor ${sensorId}.`);
    error.code = "OTA_JOB_NOT_FOUND";
    error.sensorId = sensorId;
    error.status = status;
    return {
      matched: false,
      error
    };
  }

  const now = new Date();
  const started = [
    "OTA_START",
    "START",
    "DOWNLOADING",
    "OTA_DOWNLOADING",
    "VERIFYING",
    "OTA_VERIFYING",
    "INSTALLING",
    "OTA_INSTALLING"
  ].includes(status);

  const terminal = TERMINAL_STATUSES.has(status);

  const updates = {
    status,
    progress,
    message: typeof message === "string" ? message : JSON.stringify(message),
    error: status.includes("ERROR") || status === "FAILED" || status.includes("REJECTED")
      ? (data.error ?? data.message ?? null)
      : null,
    last_status_at: now,
    last_status_payload: data
  };

  if (started && !job.started_at) {
    updates.started_at = now;
  }

  if (terminal) {
    updates.completed_at = now;
    if (status === "OTA_SUCCESS" || status === "SUCCESS") {
      updates.progress = 100;
    }
  }

  const updatedJob = await OtaJob.findOneAndUpdate(
    { _id: job._id },
    { $set: updates },
    { returnDocument: "after" }
  );

  const event = {
    ...buildPublicJob(updatedJob),
    topic,
    event: "device_status"
  };

  emitOta(event);

  await recordOtaLog({
    sensorId,
    topic,
    level: status.includes("ERROR") || status === "FAILED" || status.includes("REJECTED") ? "ERROR" : "INFO",
    message: `Estado OTA ${status} para ${sensorId}${message ? `: ${message}` : ""}`,
    payload: {
      event: "OTA_STATUS",
      ...data,
      job_id: updatedJob.job_id,
      normalized_status: status
    }
  });

  return {
    matched: true,
    job: event
  };
};

module.exports = {
  SUCCESSFUL_STATUSES,
  TERMINAL_STATUSES,
  mqttTopicForCommand,
  mqttTopicForStatus,
  setIO,
  normalizeStatus,
  validateOtaRequest,
  isValidSensorId,
  isValidVersion,
  isValidFirmwareUrl,
  isValidSha256,
  getDeviceExists,
  resolveFirmwareMetadata,
  getLatestJob,
  getHistory,
  requestOta,
  applyOtaStatus
};
