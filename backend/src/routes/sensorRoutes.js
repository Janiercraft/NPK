const express = require("express");

const router = express.Router();

const {
  getLatestData,
  getAllLatestSensors,
  getLatestBySensorId,
  getHistory,
  getHistoryBySensorId
} = require("../controllers/sensorController");

// Última lectura global
router.get("/latest", getLatestData);

// Última lectura de cada sensor
router.get("/all", getAllLatestSensors);

// También permite consultar todos desde /api/sensor
router.get("/", getAllLatestSensors);

// Historial general para informes
router.get("/history", getHistory);

// Última lectura de un sensor específico
router.get("/:sensor_id/latest", getLatestBySensorId);

// Historial de un sensor específico
router.get("/:sensor_id/history", getHistoryBySensorId);

module.exports = router;