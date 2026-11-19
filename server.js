
require("dotenv").config();

const MAX_MESSAGE_LENGTH = Number(process.env.MAX_MESSAGE_LENGTH) || 250;
const Filter = require("bad-words").Filter;
const profanityFilter = new Filter();

function containsProfanity(text) {
    if (process.env.PROFANITY_FILTER !== "true") {
        return false;
    }

    if (profanityFilter.isProfane(text)) {
        return true;
    }

    if (process.env.PROFANITY_STRICT !== "true") {
        return false;
    }

    const normalized = text
        .toLowerCase()
        .replace(/[0-9@$!]/g, char => ({
            "0": "o",
            "1": "i",
            "3": "e",
            "4": "a",
            "5": "s",
            "7": "t",
            "@": "a",
            "$": "s",
            "!": "i"
        }[char]))
        .replace(/[^a-z\s]/g, " ");

    return profanityFilter.isProfane(normalized);
}

const easyTopics = require("./data/easy.json");
const hardTopics = require("./data/hard.json");

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
app.use(express.static(path.join(__dirname, "public")));
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

const lobbies = new Map();
const INSTANCE_ID = Math.random().toString(36).slice(2, 8);

// --------------------
// LOBBY UTILITIES
// --------------------

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

function resetPlayer(player) {
    player.ready = false;
    delete player.secretTopic;
    delete player.questionsUsed;
    delete player.guess;
}

function resetGame(lobby) {
    lobby.state = "WAITING";
    lobby.phase = null;
    lobby.playAgainVotes = [false, false];

    lobby.players.forEach(resetPlayer);

    delete lobby.difficulty;
    delete lobby.category;
    delete lobby.round;
    delete lobby.questionsAsked;
    delete lobby.currentAskerIndex;
    delete lobby.currentQuestion;
    delete lobby.gameStartedAt;
    delete lobby.finalReady;
    delete lobby.finalGuesses;
}

function removePlayer(socket, lobby, code) {
    lobby.players = lobby.players.filter(
        player => player.id !== socket.id
    );

    socket.leave(code);
    delete socket.data.lobbyCode;

    if (lobby.players.length === 0) {
        lobbies.delete(code);
        return;
    }

    // Transfer host if the original host left.
    if (lobby.hostId === socket.id) {
        lobby.hostId = lobby.players[0].id;
    }

    // Reset the remaining player and lobby.
    resetGame(lobby);

    io.to(code).emit("lobby:updated", getPlayerList(lobby));
    io.to(code).emit("lobby:player-left");
}

// --------------------
// CONNECTION
// --------------------

io.on("connection", socket => {

    // --------------------
    // CREATE LOBBY
    // --------------------

    socket.on("lobby:create", name => {
        if (
            typeof name !== "string" ||
            !name.trim() ||
            name.trim().length > 20
        ) {
            socket.emit("lobby:error", "Invalid player name.");
            return;
        }

        // Don't allow one player to join multiple lobbies.
        if (socket.data.lobbyCode) return;

        const code = generateCode();

        const lobby = {
            code,
            hostId: socket.id,
            players: [{
                id: socket.id,
                name: name.trim(),
                ready: false
            }],
            state: "WAITING",
            playAgainVotes: [false, false]
        };

        lobbies.set(code, lobby);

        socket.join(code);
        socket.data.lobbyCode = code;

        socket.emit("lobby:created", {
            code,
            instanceId: INSTANCE_ID
        });

        io.to(code).emit("lobby:updated", getPlayerList(lobby));
    });

    // --------------------
    // JOIN LOBBY
    // --------------------

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

        if (socket.data.lobbyCode) return;

        code = code.trim().toUpperCase();

        const lobby = lobbies.get(code);

        if (!lobby) {
            socket.emit(
                "lobby:error",
                `Lobby not found on server ${INSTANCE_ID}.`
            );
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

    // --------------------
    // READY / UNREADY
    // --------------------

    socket.on("lobby:ready", () => {
        const code = socket.data.lobbyCode;
        const lobby = lobbies.get(code);

        if (!lobby) return;
        if (lobby.state !== "WAITING" && lobby.state !== "READY") return;

        const player = lobby.players.find(p => p.id === socket.id);
        if (!player) return;

        player.ready = !player.ready;

        if (lobby.players.length === 2 &&
            lobby.players.every(p => p.ready)) {
            lobby.state = "READY";
            io.to(code).emit("lobby:ready-to-start");
        } else {
            lobby.state = "WAITING";
        }

        io.to(code).emit("lobby:updated", getPlayerList(lobby));
    });

    // --------------------
    // START GAME
    // --------------------

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
        if (categories.length === 0) return;

        const category = randomItem(categories);
        const topics = database[category];

        if (!Array.isArray(topics) || topics.length < 2) return;

        const firstIndex = Math.floor(Math.random() * topics.length);
        let secondIndex = Math.floor(Math.random() * (topics.length - 1));

        if (secondIndex >= firstIndex) {
            secondIndex++;
        }

        lobby.difficulty = difficulty;
        lobby.category = category;
        lobby.state = "PLAYING";
        lobby.round = 1;
        lobby.gameStartedAt = Date.now();
        lobby.finalReady = [false, false];
        lobby.finalGuesses = [null, null];
        lobby.questionsAsked = [0, 0];
        lobby.playAgainVotes = [false, false];

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

        lobby.currentAskerIndex = 0;
        lobby.currentQuestion = null;
        lobby.phase = "ASK";

        io.to(code).emit("question:turn", {
            phase: "ASK",
            playerIndex: 0,
            playerName: lobby.players[0].name,
            counts: [0, 0]
        });
    });

    // --------------------
    // SUBMIT QUESTION
    // --------------------

    socket.on("question:submit", text => {
        const code = socket.data.lobbyCode;
        const lobby = lobbies.get(code);

        if (!lobby || lobby.state !== "PLAYING") return;
        if (lobby.phase !== "ASK") return;

        const asker = lobby.players[lobby.currentAskerIndex];

        if (!asker || asker.id !== socket.id) {
            socket.emit("question:error", "It is not your turn to ask.");
            return;
        }

        if (typeof text !== "string") return;

        text = text.trim();

        if (!text || text.length > MAX_MESSAGE_LENGTH) {
            socket.emit(
                "question:error",
                `Messages must be 1–${MAX_MESSAGE_LENGTH} characters.`
            );
            return;
        }

        if (containsProfanity(text)) {
            socket.emit("question:error", "Please rephrase without profanity.");
            return;
        }

        lobby.currentQuestion = text;
        lobby.phase = "ANSWER";

        io.to(code).emit("question:received", {
            question: text,
            asker: asker.name
        });

        const answererIndex = 1 - lobby.currentAskerIndex;

        io.to(code).emit("question:turn", {
            phase: "ANSWER",
            playerIndex: answererIndex,
            playerName: lobby.players[answererIndex].name
        });
    });

    // --------------------
    // SUBMIT ANSWER
    // --------------------

    socket.on("answer:submit", text => {
        const code = socket.data.lobbyCode;
        const lobby = lobbies.get(code);

        if (!lobby || lobby.state !== "PLAYING") return;
        if (lobby.phase !== "ANSWER") return;

        const askerIndex = lobby.currentAskerIndex;
        const answererIndex = 1 - askerIndex;
        const answerer = lobby.players[answererIndex];

        if (!answerer || answerer.id !== socket.id) {
            socket.emit("question:error", "It is not your turn to answer.");
            return;
        }

        if (typeof text !== "string") return;

        text = text.trim();

        if (!text || text.length > MAX_MESSAGE_LENGTH) {
            socket.emit(
                "question:error",
                `Messages must be 1–${MAX_MESSAGE_LENGTH} characters.`
            );
            return;
        }

        if (containsProfanity(text)) {
            socket.emit("question:error", "Please rephrase without profanity.");
            return;
        }

        io.to(code).emit("answer:received", {
            answer: text,
            answerer: answerer.name
        });

        lobby.questionsAsked[askerIndex]++;

        const totalQuestions =
            lobby.questionsAsked[0] + lobby.questionsAsked[1];

        if (totalQuestions >= 10) {
            lobby.phase = "GUESS";

            io.to(code).emit("question:finished", {
                counts: lobby.questionsAsked
            });

            return;
        }

        lobby.currentAskerIndex = answererIndex;
        lobby.currentQuestion = null;
        lobby.phase = "ASK";

        io.to(code).emit("question:turn", {
            phase: "ASK",
            playerIndex: answererIndex,
            playerName: lobby.players[answererIndex].name,
            counts: lobby.questionsAsked
        });
    });

    // --------------------
    // FINAL ROUND READY
    // --------------------

    socket.on("final:ready", () => {
        const code = socket.data.lobbyCode;
        const lobby = lobbies.get(code);

        if (!lobby || lobby.state !== "PLAYING") return;
        if (lobby.phase !== "GUESS") return;

        const playerIndex = lobby.players.findIndex(
            player => player.id === socket.id
        );

        if (playerIndex === -1) return;

        lobby.finalReady[playerIndex] = true;

        io.to(code).emit("final:ready-state", {
            ready: lobby.finalReady
        });

        if (lobby.finalReady.every(Boolean)) {
            lobby.phase = "FINAL_GUESS";

            io.to(code).emit("final:begin", {
                difficulty: lobby.difficulty
            });
        }
    });

    // --------------------
    // SUBMIT FINAL GUESS
    // --------------------

    socket.on("final:submit", guess => {
        const code = socket.data.lobbyCode;
        const lobby = lobbies.get(code);

        if (!lobby || lobby.phase !== "FINAL_GUESS") return;
        if (typeof guess !== "string") return;

        guess = guess.trim();

        if (!guess || guess.length > MAX_MESSAGE_LENGTH) {
            socket.emit("question:error", "Invalid guess length.");
            return;
        }

        if (containsProfanity(guess)) {
            socket.emit("question:error", "Please rephrase without profanity.");
            return;
        }

        const playerIndex = lobby.players.findIndex(
            player => player.id === socket.id
        );

        if (playerIndex === -1) return;
        if (lobby.finalGuesses[playerIndex] !== null) return;

        if (lobby.difficulty === "easy" && /\s/.test(guess)) {
            socket.emit("question:error", "Easy guesses must be one word.");
            return;
        }

        lobby.finalGuesses[playerIndex] = guess;

        io.to(code).emit("final:guess-progress", {
            submitted: lobby.finalGuesses.map(g => g !== null)
        });

        if (lobby.finalGuesses.every(g => g !== null)) {
            const results = lobby.players.map((player, index) => {
                const opponentIndex = 1 - index;
                const actualTopic = lobby.players[opponentIndex].secretTopic;
                const submittedGuess = lobby.finalGuesses[index];

                return {
                    name: player.name,
                    guess: submittedGuess,
                    targetTopic: actualTopic,
                    correct:
                        submittedGuess.toLowerCase() ===
                        actualTopic.toLowerCase()
                };
            });

            lobby.phase = "RESULTS";

            io.to(code).emit("final:results", {
                results,
                duration: Math.floor(
                    (Date.now() - lobby.gameStartedAt) / 1000
                )
            });
        }
    });

    // --------------------
    // PLAY AGAIN
    // --------------------

    socket.on("game:again", () => {
        const code = socket.data.lobbyCode;
        const lobby = lobbies.get(code);

        if (!lobby || lobby.phase !== "RESULTS") return;

        const playerIndex = lobby.players.findIndex(
            player => player.id === socket.id
        );

        if (playerIndex === -1) return;

        if (!lobby.playAgainVotes) {
            lobby.playAgainVotes = [false, false];
        }

        lobby.playAgainVotes[playerIndex] = true;

        io.to(code).emit("game:again-progress", {
            votes: lobby.playAgainVotes
        });

        if (lobby.playAgainVotes.every(Boolean)) {
            resetGame(lobby);

            io.to(code).emit("game:again-ready");
            io.to(code).emit("lobby:updated", getPlayerList(lobby));
        }
    });

    // --------------------
    // LEAVE LOBBY / MAIN MENU
    // --------------------

    socket.on("lobby:leave", () => {
        const code = socket.data.lobbyCode;
        const lobby = lobbies.get(code);

        if (!lobby) {
            delete socket.data.lobbyCode;
            return;
        }

        removePlayer(socket, lobby, code);
    });

    // --------------------
    // DISCONNECT
    // --------------------

    socket.on("disconnect", () => {
        const code = socket.data.lobbyCode;
        const lobby = lobbies.get(code);

        if (!lobby) return;

        removePlayer(socket, lobby, code);
    });
});

// --------------------
// SERVER
// --------------------

server.listen(PORT, "0.0.0.0", () => {
    console.log(`DeSception running on port ${PORT}`);
});
