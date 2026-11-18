
const socket = io();

const status = document.getElementById("status");
const players = document.getElementById("players");

function createLobby() {
    const name = document.getElementById("name").value.trim();

    socket.emit("lobby:create", name);
}

function joinLobby() {
    const name = document.getElementById("name").value.trim();
    const code = document.getElementById("code").value.trim();

    socket.emit("lobby:join", { name, code });
}

function readyUp() {
    socket.emit("lobby:ready");
}

socket.on("connect", () => {
    status.textContent = "Connected to server.";
});

socket.on("lobby:created", ({ code }) => {
    status.textContent = "Lobby created! Code: " + code;
});

socket.on("lobby:updated", (list) => {
    players.innerHTML = "";

    list.forEach(player => {
        const item = document.createElement("li");
        item.textContent =
            player.name + (player.ready ? " (Ready)" : " (Not ready)");

        players.appendChild(item);
    });
});

socket.on("lobby:error", (message) => {
    status.textContent = message;
});

socket.on("lobby:ready-to-start", () => {
    status.textContent = "Both players are ready!";
});

socket.on("lobby:player-left", () => {
    status.textContent = "The other player disconnected.";
});
