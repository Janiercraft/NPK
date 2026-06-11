const SensorData = require("../models/SensorData");

// Última lectura global
const getLatestData = async (req, res) => {
  try {
    const data = await SensorData
      .findOne()
      .sort({ timestamp: -1, _id: -1 });

    res.json(data);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
};

// Última lectura de cada sensor_id
const getAllLatestSensors = async (req, res) => {
  try {
    const data = await SensorData.aggregate([
      {
        $sort: {
          timestamp: -1,
          _id: -1
        }
      },
      {
        $group: {
          _id: "$sensor_id",
          doc: {
            $first: "$$ROOT"
          }
        }
      },
      {
        $replaceRoot: {
          newRoot: "$doc"
        }
      },
      {
        $sort: {
          sensor_id: 1
        }
      }
    ]);

    res.json(data);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
};

// Última lectura de un sensor específico
const getLatestBySensorId = async (req, res) => {
  try {
    const { sensor_id } = req.params;

    const data = await SensorData
      .findOne({ sensor_id })
      .sort({ timestamp: -1, _id: -1 });

    if (!data) {
      return res.status(404).json({
        message: `No se encontraron datos para el sensor ${sensor_id}`
      });
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
};

// Historial general de lecturas
const getHistory = async (req, res) => {
  try {
    const { sensor_id, start, end } = req.query;
    const limit = Number(req.query.limit) || 5000;

    const filter = {};

    if (sensor_id && sensor_id !== "todos") {
      filter.sensor_id = sensor_id;
    }

    if (start || end) {
      filter.timestamp = {};

      if (start) {
        filter.timestamp.$gte = new Date(`${start}T00:00:00.000Z`);
      }

      if (end) {
        filter.timestamp.$lte = new Date(`${end}T23:59:59.999Z`);
      }
    }

    const data = await SensorData
      .find(filter)
      .sort({ timestamp: -1, _id: -1 })
      .limit(limit);

    res.json(data);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
};

// Historial de un sensor específico
const getHistoryBySensorId = async (req, res) => {
  try {
    const { sensor_id } = req.params;
    const { start, end } = req.query;
    const limit = Number(req.query.limit) || 5000;

    const filter = {
      sensor_id
    };

    if (start || end) {
      filter.timestamp = {};

      if (start) {
        filter.timestamp.$gte = new Date(`${start}T00:00:00.000Z`);
      }

      if (end) {
        filter.timestamp.$lte = new Date(`${end}T23:59:59.999Z`);
      }
    }

    const data = await SensorData
      .find(filter)
      .sort({ timestamp: -1, _id: -1 })
      .limit(limit);

    res.json(data);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
};

module.exports = {
  getLatestData,
  getAllLatestSensors,
  getLatestBySensorId,
  getHistory,
  getHistoryBySensorId
};