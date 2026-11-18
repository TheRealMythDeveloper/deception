
const easyTopics = require("./data/easy.json");
const hardTopics = require("./data/hard.json");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

const lobbies = new Map();

function generateCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code;

    do {
        code = Array.from(
            { length: 5 },
            () => chars[Math.floor(Math.random() * chars.length)]
        ).join("");
    } while (lobbies.has(code));

    return code;
}

function getPlayerList(lobby) {
    return lobby.players.map(player => ({
        name: player.name,
        ready: player.ready
    }));
}

function randomItem(array) {
    return array[Math.floor(Math.random() * array.length)];
}

io.on("connection", (socket) => {

    socket.on("lobby:create", (name) => {
        if (
            typeof name !== "string" ||
            !name.trim() ||
            name.trim().length > 20
        ) {
            socket.emit("lobby:error", "Invalid player name.");
            return;
        }

        const code = generateCode();

        const lobby = {
            code,
            hostId: socket.id,
            players: [{
                id: socket.id,
                name: name.trim(),
                ready: false
            }],
            state: "WAITING"
        };

        lobbies.set(code, lobby);

        socket.join(code);
        socket.data.lobbyCode = code;

        socket.emit("lobby:created", { code });
        io.to(code).emit("lobby:updated", getPlayerList(lobby));
    });

    socket.on("lobby:join", ({ code, name } = {}) => {
        if (
            typeof code !== "string" ||
            typeof name !== "string" ||
            !name.trim() ||
            name.trim().length > 20
        ) {
            socket.emit("lobby:error", "Invalid lobby details.");
            return;
        }

        code = code.trim().toUpperCase();

        const lobby = lobbies.get(code);

        if (!lobby) {
            socket.emit("lobby:error", "Lobby not found. Check the code and try again.");
            return;
        }

        if (lobby.players.length >= 2) {
            socket.emit("lobby:error", "Lobby is full.");
            return;
        }

        if (lobby.state !== "WAITING") {
            socket.emit("lobby:error", "Game already started.");
            return;
        }

        lobby.players.push({
            id: socket.id,
            name: name.trim(),
            ready: false
        });

        socket.join(code);
        socket.data.lobbyCode = code;

        socket.emit("lobby:joined", { code });

        io.to(code).emit("lobby:updated", getPlayerList(lobby));
    });

    socket.on("lobby:ready", () => {
        const code = socket.data.lobbyCode;
        const lobby = lobbies.get(code);

        if (!lobby || lobby.state !== "WAITING") return;

        const player = lobby.players.find(p => p.id === socket.id);

        if (!player) return;

        player.ready = true;

        io.to(code).emit("lobby:updated", getPlayerList(lobby));

        if (
            lobby.players.length === 2 &&
            lobby.players.every(p => p.ready)
        ) {
            lobby.state = "READY";
            io.to(code).emit("lobby:ready-to-start");
        }
    });

    socket.on("game:start", ({ difficulty } = {}) => {
        const code = socket.data.lobbyCode;
        const lobby = lobbies.get(code);

        if (!lobby || socket.id !== lobby.hostId) return;
        if (lobby.players.length !== 2) return;
        if (!lobby.players.every(p => p.ready)) return;
        if (lobby.state !== "READY") return;

        if (difficulty !== "easy" && difficulty !== "hard") return;

        const database = difficulty === "easy"
            ? easyTopics
            : hardTopics;

        const categories = Object.keys(database);
        const category = randomItem(categories);
        const topics = database[category];

        if (!Array.isArray(topics) || topics.length < 2) return;

        const firstIndex = Math.floor(Math.random() * topics.length);
        let secondIndex = Math.floor(Math.random() * (topics.length - 1));

        if (secondIndex >= firstIndex) secondIndex++;

        lobby.difficulty = difficulty;
        lobby.category = category;
        lobby.state = "PLAYING";
        lobby.round = 1;
        lobby.questionsAsked = 0;

        lobby.players.forEach((player, index) => {
            player.secretTopic = topics[
                index === 0 ? firstIndex : secondIndex
            ];

            player.questionsUsed = 0;
            player.guess = null;
        });

        io.to(code).emit("wheel:result", {
            category,
            difficulty
        });

        lobby.players.forEach(player => {
            io.to(player.id).emit("topic:assigned", {
                topic: player.secretTopic
            });
        });

        io.to(code).emit("game:started");
    });

    socket.on("disconnect", () => {
        const code = socket.data.lobbyCode;
        const lobby = lobbies.get(code);

        if (!lobby) return;

        lobby.players = lobby.players.filter(
            player => player.id !== socket.id
        );

        if (lobby.players.length === 0) {
            lobbies.delete(code);
        } else {
            lobby.state = "WAITING";
            io.to(code).emit("lobby:updated", getPlayerList(lobby));
            io.to(code).emit("lobby:player-left");
        }
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`DeSception running on port ${PORT}`);
});
