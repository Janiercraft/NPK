require("dotenv").config();

const http = require("http");
const { Server } = require("socket.io");

const app = require("./app");
const connectDB = require("./config/database");
const { startHistoryJob } = require("./services/historyService");
const mqttService = require("./services/mqttService");

const PORT = process.env.PORT || 3000;

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
  }
});

io.on("connection", (socket) => {
  console.log(`Frontend conectado por Socket.IO: ${socket.id}`);

  socket.emit("server-ready", {
    message: "Conexión Socket.IO establecida",
    timestamp: new Date()
  });

  socket.on("disconnect", (reason) => {
    console.log(`Frontend desconectado: ${socket.id}. Motivo: ${reason}`);
  });
});

const startServer = async () => {
  try {
    await connectDB();

    // Conecta Socket.IO con MQTT y con el servicio de logs.
    mqttService.setIO(io);

    startHistoryJob();

    httpServer.listen(PORT, () => {
      console.log(`Servidor iniciado en puerto ${PORT}`);
      console.log("Socket.IO listo para conexiones en tiempo real");
    });
  } catch (error) {
    console.error("No se pudo iniciar el servidor:", error.message);
    process.exit(1);
  }
};

startServer();
