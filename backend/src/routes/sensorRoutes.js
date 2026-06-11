const express = require("express");

const router = express.Router();

const {
  getLatestData,
  getAllLatestSensors,
  getLatestBySensorId,
  getHistoryBySensorId
} = require("../controllers/sensorController");

// Devuelve la última lectura global
router.get("/latest", getLatestData);

// Devuelve la última lectura de cada sensor_id
router.get("/all", getAllLatestSensors);

// También permite consultar todos los sensores desde /api/sensor
router.get("/", getAllLatestSensors);

// Devuelve la última lectura de un sensor específico
router.get("/:sensor_id/latest", getLatestBySensorId);

// Devuelve el historial de un sensor específico
router.get("/:sensor_id/history", getHistoryBySensorId);

module.exports = router;