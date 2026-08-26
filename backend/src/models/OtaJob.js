const mongoose = require("mongoose");

const otaJobSchema = new mongoose.Schema(
  {
    job_id: {
      type: String,
      required: true,
      unique: true,
      index: true
    },

    sensor_id: {
      type: String,
      required: true,
      index: true
    },

    version: {
      type: String,
      required: true,
      trim: true
    },

    url: {
      type: String,
      required: true,
      trim: true
    },

    sha256: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },

    firmware_size: {
      type: Number,
      default: null,
      min: 0
    },

    previous_version: {
      type: String,
      default: null,
      trim: true
    },

    requested_by: {
      type: String,
      default: null,
      trim: true
    },

    status: {
      type: String,
      required: true,
      default: "REQUESTED",
      index: true
    },

    progress: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },

    message: {
      type: String,
      default: ""
    },

    error: {
      type: String,
      default: null
    },

    mqtt_topic: {
      type: String,
      required: true
    },

    created_at: {
      type: Date,
      default: Date.now,
      index: true
    },

    started_at: {
      type: Date,
      default: null
    },

    completed_at: {
      type: Date,
      default: null
    },

    last_status_at: {
      type: Date,
      default: Date.now,
      index: true
    },

    last_status_payload: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    }
  },
  {
    versionKey: false
  }
);

otaJobSchema.index({ sensor_id: 1, created_at: -1 });
otaJobSchema.index({ sensor_id: 1, status: 1, created_at: -1 });

module.exports = mongoose.model("OtaJob", otaJobSchema, "OtaJobs");
