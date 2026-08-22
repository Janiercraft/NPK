const express = require("express");

const {
  getLogs,
  getLatestLogs
} = require("../controllers/logController");

const router = express.Router();

// Historial de logs con filtros opcionales.
// Ejemplo: /api/logs?limit=200&sensor_id=001&level=ERROR
router.get("/", getLogs);

// Últimos logs de forma rápida.
router.get("/latest", getLatestLogs);

module.exports = router;
