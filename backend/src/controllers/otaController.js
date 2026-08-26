const {
  requestOta,
  getLatestJob,
  getHistory
} = require("../services/otaService");
const mqttService = require("../services/mqttService");

const sendError = (res, error) => {
  const statusByCode = {
    VALIDATION_ERROR: 400,
    DEVICE_NOT_FOUND: 404,
    MQTT_DISCONNECTED: 503,
    MQTT_PUBLISH_FAILED: 503,
    OTA_JOB_NOT_FOUND: 404
  };

  const status = statusByCode[error.code] || 500;

  res.status(status).json({
    ok: false,
    code: error.code || "OTA_ERROR",
    message: error.message,
    ...(error.details ? { details: error.details } : {})
  });
};

const requestOtaUpdate = async (req, res) => {
  try {
    const { sensor_id } = req.params;
    const {
      version,
      url,
      sha256,
      size,
      firmware_size,
      previous_version,
      requested_by
    } = req.body || {};

    const result = await requestOta({
      sensorId: sensor_id,
      version,
      url,
      sha256,
      size: size ?? firmware_size,
      previousVersion: previous_version,
      requestedBy: requested_by,
      mqttService
    });

    res.status(result.duplicate ? 200 : 202).json({
      ok: true,
      duplicate: result.duplicate,
      message: result.alreadyCompleted
        ? "La misma OTA ya fue completada correctamente y no se volverá a enviar."
        : result.duplicate
          ? "Ya existe un trabajo OTA activo con los mismos parámetros."
          : "Solicitud OTA aceptada y enviada al dispositivo por MQTT.",
      job: result.job,
      ...(result.command ? { command: result.command } : {})
    });
  } catch (error) {
    console.error("Error solicitando OTA:", error.message);
    sendError(res, error);
  }
};

const getOtaStatus = async (req, res) => {
  try {
    const { sensor_id } = req.params;
    const job = await getLatestJob(sensor_id);

    if (!job) {
      return res.status(404).json({
        ok: false,
        code: "OTA_JOB_NOT_FOUND",
        message: `No existen trabajos OTA para el sensor ${sensor_id}.`
      });
    }

    res.json({
      ok: true,
      job
    });
  } catch (error) {
    console.error("Error consultando estado OTA:", error.message);
    res.status(500).json({
      ok: false,
      code: "OTA_STATUS_ERROR",
      message: error.message
    });
  }
};

const getOtaHistory = async (req, res) => {
  try {
    const { sensor_id } = req.params;
    const jobs = await getHistory(sensor_id, req.query.limit);

    res.json({
      ok: true,
      sensor_id,
      count: jobs.length,
      jobs
    });
  } catch (error) {
    console.error("Error consultando historial OTA:", error.message);
    res.status(500).json({
      ok: false,
      code: "OTA_HISTORY_ERROR",
      message: error.message
    });
  }
};

const getManifest = async (_req, res) => {
  const version = process.env.OTA_VERSION || "";
  const url = process.env.OTA_URL || "";
  const sha256 = (process.env.OTA_SHA256 || "").toLowerCase();
  const size = process.env.OTA_SIZE ? Number(process.env.OTA_SIZE) : null;

  if (!version || !url || !sha256) {
    return res.status(503).json({
      ok: false,
      code: "OTA_MANIFEST_NOT_CONFIGURED",
      message: "El manifest OTA todavía no está configurado en el backend."
    });
  }

  res.json({
    version,
    url,
    sha256,
    size: Number.isFinite(size) ? size : null
  });
};

module.exports = {
  requestOtaUpdate,
  getOtaStatus,
  getOtaHistory,
  getManifest
};
