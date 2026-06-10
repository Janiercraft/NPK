const mongoose = require("mongoose");

const sensorSchema = new mongoose.Schema({
  sensor_id: {
    type: String,
    required: true
  },

  nitrogeno: {
    type: Number,
    required: true
  },

  fosforo: {
    type: Number,
    required: true
  },

  potasio: {
    type: Number,
    required: true
  },

  humedad_suelo: {
    type: Number,
    default: null
  },

  temperatura_ambiente: {
    type: Number,
    default: null
  },

  timestamp: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("SensorData", sensorSchema, "Datos");