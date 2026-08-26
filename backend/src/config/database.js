const dns = require("dns");
const mongoose = require("mongoose");

function configureMongoDns() {
  const raw = String(process.env.MONGO_DNS_SERVERS || "1.1.1.1,8.8.8.8");
  const servers = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (servers.length > 0) {
    try {
      dns.setServers(servers);
      console.log(`DNS MongoDB configurado: ${servers.join(", ")}`);
    } catch (error) {
      console.warn(`No se pudo configurar DNS personalizado: ${error.message}`);
    }
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const connectDB = async () => {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    throw new Error("MONGO_URI no está configurado.");
  }

  configureMongoDns();

  const maxAttempts = Math.max(1, Number(process.env.MONGO_CONNECT_RETRIES || 5));
  const retryDelayMs = Math.max(500, Number(process.env.MONGO_CONNECT_RETRY_DELAY_MS || 3000));

  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await mongoose.connect(uri, {
        dbName: process.env.MONGO_DB_NAME || "Npk",
        serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000)
      });

      console.log(`MongoDB conectado a la base: ${mongoose.connection.name}`);
      return;
    } catch (error) {
      lastError = error;
      console.error(`Error MongoDB (intento ${attempt}/${maxAttempts}): ${error.message}`);

      if (attempt < maxAttempts) {
        await sleep(retryDelayMs);
      }
    }
  }

  throw lastError || new Error("No se pudo conectar a MongoDB.");
};

module.exports = connectDB;
