const cron = require("node-cron");
const mongoose = require("mongoose");

const SensorData = require("../models/SensorData");
const SensorHistory = require("../models/SensorHistory");

const DAYS_TO_KEEP_IN_CURRENT = 30;
const BATCH_SIZE = 1000;

const moveOldDataToHistory = async ({
  days = DAYS_TO_KEEP_IN_CURRENT,
  batchSize = BATCH_SIZE
} = {}) => {
  const limitDate = new Date();
  limitDate.setDate(limitDate.getDate() - days);

  let totalMoved = 0;

  while (true) {
    const oldDocs = await SensorData.find({
      timestamp: {
        $lt: limitDate
      }
    })
      .sort({ timestamp: 1, _id: 1 })
      .limit(batchSize)
      .lean();

    if (!oldDocs.length) {
      break;
    }

    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        const historyDocs = oldDocs.map((doc) => ({
          ...doc,
          original_collection: "Datos",
          original_id: doc._id,
          archived_at: new Date()
        }));

        await SensorHistory.insertMany(historyDocs, {
          session,
          ordered: true
        });

        const ids = oldDocs.map((doc) => doc._id);

        await SensorData.deleteMany(
          {
            _id: {
              $in: ids
            }
          },
          {
            session
          }
        );
      });

      totalMoved += oldDocs.length;

      console.log(
        `${oldDocs.length} documentos movidos a DatosHistoricos y eliminados de Datos`
      );
    } catch (error) {
      console.error("Error moviendo datos a históricos:", error.message);
      throw error;
    } finally {
      await session.endSession();
    }
  }

  if (totalMoved === 0) {
    console.log("No hay documentos antiguos para mover a DatosHistoricos");
  } else {
    console.log(`Total movido a históricos: ${totalMoved}`);
  }

  return totalMoved;
};

const startHistoryJob = () => {
  cron.schedule(
    "0 2 * * *",
    async () => {
      console.log("Ejecutando job diario de históricos...");

      try {
        await moveOldDataToHistory();
      } catch (error) {
        console.error("Error en job diario de históricos:", error.message);
      }
    },
    {
      timezone: "America/Bogota"
    }
  );

  console.log("Job de históricos programado todos los días a las 2:00 AM");
};

module.exports = {
  moveOldDataToHistory,
  startHistoryJob
};