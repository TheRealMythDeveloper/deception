
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

io.on("connection", (socket) => {
    console.log("Player connected:", socket.id);

    socket.emit("server:welcome", {
        message: "Connected to DeSception!"
    });

    socket.on("disconnect", () => {
        console.log("Player disconnected:", socket.id);
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`DeSception running on port ${PORT}`);
});
