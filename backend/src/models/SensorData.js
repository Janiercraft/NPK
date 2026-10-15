const mongoose = require("mongoose");

const sensorSchema = new mongoose.Schema({
  sensor_id: {
    type: String,
    required: true
  },

  nitrogeno: {
    type: Number,
    default: null
  },

  fosforo: {
    type: Number,
    default: null
  },

  potasio: {
    type: Number,
    default: null
  },

  humedad_suelo: {
    type: Number,
    default: null
  },

  temperatura_ambiente: {
    type: Number,
    default: null
  },

  // Coordenadas opcionales declaradas por el dispositivo o simulador.
  lat: { type: Number, min: -90, max: 90, default: null },
  lng: { type: Number, min: -180, max: 180, default: null },
  location: { type: String, default: null },

  timestamp: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("SensorData", sensorSchema, "Datos");