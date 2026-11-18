
const socket = io();

const $ = id => document.getElementById(id);

let selectedDifficulty = "easy";
let isHost = false;
let gameStarted = false;

const show = id => $(id).classList.remove("hidden");
const hide = id => $(id).classList.add("hidden");

function setStatus(message) {
    $("status").textContent = message;
}

socket.on("connect", () => {
    $("connection").textContent = "CONNECTED";
});

socket.on("disconnect", () => {
    $("connection").textContent = "DISCONNECTED";
    setStatus("Connection lost.");
});

function createLobby() {
    const name = $("name").value.trim();

    if (!name) return setStatus("Enter a player name.");

    socket.emit("lobby:create", name);
}

function joinLobby() {
    const name = $("name").value.trim();
    const code = $("code").value.trim();

    if (!name || !code) return setStatus("Enter your name and lobby code.");

    socket.emit("lobby:join", { name, code });
}

socket.on("lobby:created", ({ code, instanceId }) => {
    status.textContent =
        `Lobby created! Code: ${code} | Server: ${instanceId}`;
});   
 isHost = true;

    $("lobbyCode").textContent = code;

    hide("home");
    show("lobby");
    show("hostControls");
    hide("readyButton");

    setStatus("Share your lobby code with another player.");
});
socket.on("lobby:joined", ({ code }) => {
    status.textContent = "Successfully joined lobby: " + code;
});

socket.on("lobby:updated", list => {
    $("player1").textContent = list[0]?.name || "Waiting...";
    $("player2").textContent = list[1]?.name || "Waiting...";

    $("ready1").textContent = list[0]?.ready ? "READY" : "NOT READY";
    $("ready2").textContent = list[1]?.ready ? "READY" : "NOT READY";
});

socket.on("lobby:player-left", () => {
    gameStarted = false;
    hide("game");
    show("lobby");
    setStatus("The other player disconnected.");
});

socket.on("lobby:error", setStatus);

function readyUp() {
    socket.emit("lobby:ready");
    $("readyButton").disabled = true;
    $("readyButton").textContent = "WAITING...";
}

$("code").addEventListener("input", event => {
    event.target.value = event.target.value.toUpperCase();
});

document.querySelectorAll(".difficulty-btn").forEach(button => {
    button.addEventListener("click", () => {
        selectedDifficulty = button.dataset.mode;

        document.querySelectorAll(".difficulty-btn").forEach(btn => {
            btn.classList.toggle("selected", btn === button);
        });
    });
});

function startGame() {
    socket.emit("game:start", {
        difficulty: selectedDifficulty
    });
}

socket.on("wheel:result", ({ category }) => {
    gameStarted = true;

    hide("lobby");
    show("game");

    $("category").textContent = "The wheel is spinning...";

    $("wheel").style.transform =
        `rotate(${360 * 5 + Math.random() * 360}deg)`;

    setTimeout(() => {
        $("category").textContent = category;
    }, 4000);
});

socket.on("topic:assigned", ({ topic }) => {
    $("secretTopic").textContent = topic;
    show("secretCard");
});

socket.on("game:started", () => {
    $("gameStatus").textContent =
        "Both players have received their secret topics.";
});

socket.on("lobby:ready-to-start", () => {
    if (isHost) {
        setStatus("Both players are ready. Choose a difficulty and start!");
    } else {
        setStatus("Both players are ready. Waiting for host to start.");
    }
});