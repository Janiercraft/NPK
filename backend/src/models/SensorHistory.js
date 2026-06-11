const mongoose = require("mongoose");

const sensorHistorySchema = new mongoose.Schema({
  sensor_id: String,
  nitrogeno: Number,
  fosforo: Number,
  potasio: Number,
  humedad_suelo: {
    type: Number,
    default: null
  },
  temperatura_ambiente: {
    type: Number,
    default: null
  },
  timestamp: Date
}, {
  strict: false
});

module.exports = mongoose.model("SensorHistory", sensorHistorySchema, "DatosHistoricos");