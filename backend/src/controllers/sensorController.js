const SensorData = require("../models/SensorData");
const SensorHistory = require("../models/SensorHistory");

// Última lectura global desde Datos
const getLatestData = async (req, res) => {
  try {
    const data = await SensorData.findOne().sort({
      timestamp: -1,
      _id: -1
    });

    res.json(data);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
};

// Última lectura de cada sensor desde Datos
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

// Última lectura de un sensor específico desde Datos
const getLatestBySensorId = async (req, res) => {
  try {
    const { sensor_id } = req.params;

    const data = await SensorData.findOne({
      sensor_id
    }).sort({
      timestamp: -1,
      _id: -1
    });

    if (!data) {
      return res.status(404).json({
        message: `No se encontraron datos recientes para el sensor ${sensor_id}`
      });
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
};

const buildHistoryFilter = ({ sensor_id, start, end }) => {
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

  return filter;
};

const sortAndLimit = (rows, limit) => {
  return rows
    .sort((a, b) => {
      const dateA = new Date(a.timestamp).getTime();
      const dateB = new Date(b.timestamp).getTime();

      if (dateB !== dateA) {
        return dateB - dateA;
      }

      return String(b._id).localeCompare(String(a._id));
    })
    .slice(0, limit);
};

// Historial general para reportes.
// source puede ser: actual, historico, todos
const getHistory = async (req, res) => {
  try {
    const {
      sensor_id,
      start,
      end,
      source = "todos"
    } = req.query;

    const limit = Number(req.query.limit) || 5000;

    const filter = buildHistoryFilter({
      sensor_id,
      start,
      end
    });

    let rows = [];

    if (source === "actual") {
      rows = await SensorData.find(filter)
        .sort({ timestamp: -1, _id: -1 })
        .limit(limit)
        .lean();
    } else if (source === "historico") {
      rows = await SensorHistory.find(filter)
        .sort({ timestamp: -1, _id: -1 })
        .limit(limit)
        .lean();
    } else {
      const [currentRows, historyRows] = await Promise.all([
        SensorData.find(filter)
          .sort({ timestamp: -1, _id: -1 })
          .limit(limit)
          .lean(),

        SensorHistory.find(filter)
          .sort({ timestamp: -1, _id: -1 })
          .limit(limit)
          .lean()
      ]);

      rows = sortAndLimit([...currentRows, ...historyRows], limit);
    }

    res.json(rows);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
};

// Historial de un sensor específico.
// source puede ser: actual, historico, todos
const getHistoryBySensorId = async (req, res) => {
  try {
    const { sensor_id } = req.params;
    const {
      start,
      end,
      source = "todos"
    } = req.query;

    const limit = Number(req.query.limit) || 5000;

    const filter = buildHistoryFilter({
      sensor_id,
      start,
      end
    });

    let rows = [];

    if (source === "actual") {
      rows = await SensorData.find(filter)
        .sort({ timestamp: -1, _id: -1 })
        .limit(limit)
        .lean();
    } else if (source === "historico") {
      rows = await SensorHistory.find(filter)
        .sort({ timestamp: -1, _id: -1 })
        .limit(limit)
        .lean();
    } else {
      const [currentRows, historyRows] = await Promise.all([
        SensorData.find(filter)
          .sort({ timestamp: -1, _id: -1 })
          .limit(limit)
          .lean(),

        SensorHistory.find(filter)
          .sort({ timestamp: -1, _id: -1 })
          .limit(limit)
          .lean()
      ]);

      rows = sortAndLimit([...currentRows, ...historyRows], limit);
    }

    res.json(rows);
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