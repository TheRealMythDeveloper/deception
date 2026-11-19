
const socket = io();

const $ = id => document.getElementById(id);

let selectedDifficulty = "easy";
let isHost = false;
let gameStarted = false;
let assignedTopic = null;
let wheelFinished = false;
const show = id => $(id).classList.remove("hidden");
const hide = id => $(id).classList.add("hidden");
function addChatMessage(sender, message, isMine) {
    const history = $("chatHistory");

    // Remove the initial placeholder when the first message arrives
    const placeholder = history.querySelector(".chat-system-message");
    if (placeholder && history.children.length === 1) {
        placeholder.remove();
    }

    const wrapper = document.createElement("div");
    const mine = isMine ?? sender === window.myPlayerName;
    wrapper.className = `chat-message ${mine ? "mine" : "opponent"}`;

    const senderLabel = document.createElement("div");
    senderLabel.className = "chat-sender";
    senderLabel.textContent = sender;

    const bubble = document.createElement("div");
    bubble.className = "chat-bubble";
    bubble.textContent = message;

    wrapper.append(senderLabel, bubble);
    history.appendChild(wrapper);

    history.scrollTop = history.scrollHeight;
}function addChatSystemMessage(message) {
    const history = $("chatHistory");

    const systemMessage = document.createElement("div");
    systemMessage.className = "chat-system-message";
    systemMessage.textContent = message;

    history.appendChild(systemMessage);
    history.scrollTop = history.scrollHeight;
}

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
    isHost = true;

    $("lobbyCode").textContent = code;

    hide("home");
    show("lobby");
    hide("hostControls");
show("readyButton");

    setStatus(
        `Lobby created! Code: ${code} | Server: ${instanceId}`
    );
});

socket.on("lobby:joined", ({ code }) => {
    hide("home");
    show("lobby");
    hide("hostControls");
    show("readyButton");

    setStatus("Successfully joined lobby: " + code);
});socket.on("lobby:updated", list => {
    $("player1").textContent = list[0]?.name || "Waiting...";
    $("player2").textContent = list[1]?.name || "Waiting...";

    $("ready1").textContent = list[0]?.ready ? "READY" : "NOT READY";
    $("ready2").textContent = list[1]?.ready ? "READY" : "NOT READY";

    const myIndex = isHost ? 0 : 1;
    const me = list[myIndex];

    if (me) {
        $("readyButton").textContent =
            me.ready ? "UNREADY" : "READY";

        // Remember our own player name
        window.myPlayerName = me.name;
    }

    const allReady =
        list.length === 2 && list.every(player => player.ready);

    if (isHost) {
        if (allReady) {
            show("hostControls");
            hide("readyButton");
        } else {
            hide("hostControls");
            show("readyButton");
        }
    } else {
        show("readyButton");
    }
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
}

$("code").addEventListener("input", event => {
    event.target.value = event.target.value.toUpperCase();
});

document.querySelectorAll(".difficulty-btn").forEach(button => {
    button.addEventListener("click", () => {
        selectedDifficulty = button.dataset.mode;

        document.querySelectorAll(".difficulty-btn").forEach(btn => {
            btn.classList.toggle(
                "selected",
                btn.dataset.mode === selectedDifficulty
            );
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
    wheelFinished = false;
    assignedTopic = null;

    hide("lobby");
    show("game");
    hide("topicPopup");

    $("category").textContent = "SPINNING...";
    $("wheelInner").textContent = "?";

    // Reset the wheel before spinning
    $("wheel").style.transition = "none";
    $("wheel").style.transform = "rotate(0deg)";

    // Force the reset to register
    $("wheel").offsetHeight;

    // Start the spin
    $("wheel").style.transition = "transform 4s cubic-bezier(0.15, 0.15, 0.15, 1)";
    $("wheel").style.transform =
        `rotate(${360 * 6 + Math.random() * 360}deg)`;

    setTimeout(() => {
        $("category").textContent = category;
        $("wheelInner").textContent = category;
        wheelFinished = true;
        revealTopic();
    }, 4000);
});

socket.on("topic:assigned", ({ topic }) => {
    assignedTopic = topic;
    revealTopic();
});

function revealTopic() {
    if (!wheelFinished || !assignedTopic) return;

    $("secretTopic").textContent = assignedTopic;
    show("topicPopup");
}

socket.on("game:started", () => {
    $("gameStatus").textContent = "Both players have received their secret topics.";
});


socket.on("lobby:ready-to-start", () => {
    if (isHost) {
        setStatus("Both players are ready. Choose a difficulty and start!");
    } else {
        setStatus("Both players are ready. Waiting for host to start.");
    }
});
function continueGame() {
    
    if (!wheelFinished || !assignedTopic) return;
$("chatHistory").innerHTML = "";
addChatSystemMessage("The conversation has begun.");
$("questionCount").textContent = "0 / 10";
$("questionStatus").textContent = "";
    hide("topicPopup");
    hide("game");
    show("questions");

    $("questionTurn").textContent = "Question Phase";
    $("questionInfo").textContent =
        "The wheel is locked. No rerolls. Get ready to uncover your opponent's topic!";
}
function submitQuestion() {
    const text = $("questionInput").value.trim();

    if (!text) {
        $("questionStatus").textContent = "Enter a question first.";
        return;
    }

    socket.emit("question:submit", text);
    $("questionInput").value = "";
    $("questionStatus").textContent = "Question sent...";
}

function submitAnswer() {
    const text = $("answerInput").value.trim();

    if (!text) {
        $("questionStatus").textContent = "Enter an answer first.";
        return;
    }

    socket.emit("answer:submit", text);
    $("answerInput").value = "";
    $("questionStatus").textContent = "Answer sent...";
}
socket.on("question:turn", ({ phase, playerIndex, playerName, counts }) => {
    const myIndex = isHost ? 0 : 1;
    const isMyTurn = playerIndex === myIndex;

    hide("questionInputArea");
    hide("answerInputArea");

    $("questionInput").disabled = !isMyTurn;
    $("answerInput").disabled = !isMyTurn;

    $("questionStatus").textContent = "";

    if (counts) {
        const total = counts[0] + counts[1];
        $("questionCount").textContent = `${total} / 10`;
    }

    if (phase === "ASK") {
        if (isMyTurn) {
            show("questionInputArea");
            $("questionInput").disabled = false;
            $("questionTurn").textContent = "YOUR TURN: ASK A QUESTION";
        } else {
            $("questionTurn").textContent = `${playerName} is asking a question...`;
        }
    }

    if (phase === "ANSWER") {
        if (isMyTurn) {
            show("answerInputArea");
            $("answerInput").disabled = false;
            $("questionTurn").textContent = "YOUR TURN: ANSWER";
        } else {
            $("questionTurn").textContent = `${playerName} is answering...`;
        }
    }
});
socket.on("question:received", ({ question, asker }) => {
    addChatMessage(asker, question);
    $("questionTurn").textContent = `${asker} asked a question`;
    $("questionStatus").textContent = "";
});

socket.on("answer:received", ({ answer, answerer }) => {
    addChatMessage(answerer, answer);
    $("questionTurn").textContent = `${answerer} answered`;
    $("questionStatus").textContent = "";
});

socket.on("question:error", message => {
    $("questionStatus").textContent = message;
});

socket.on("question:finished", ({ counts }) => {
    hide("questionInputArea");
    hide("answerInputArea");

    $("questionCount").textContent =
        `Questions: ${counts[0] + counts[1]} / 10`;

    $("questionTurn").textContent = "QUESTION PHASE COMPLETE";
    $("questionStatus").textContent = "";

    showFinalPopup();
});
function launchConfetti() {
    const colors = ["#ffffff", "#8b5cf6", "#38bdf8", "#facc15", "#f472b6"];

    for (let i = 0; i < 90; i++) {
        const piece = document.createElement("div");
        piece.className = "confetti-piece";

        piece.style.left = Math.random() * 100 + "vw";
        piece.style.backgroundColor =
            colors[Math.floor(Math.random() * colors.length)];

        piece.style.animationDuration = (2 + Math.random() * 3) + "s";
        piece.style.animationDelay = Math.random() * 0.8 + "s";
        piece.style.width = (5 + Math.random() * 7) + "px";
        piece.style.height = (7 + Math.random() * 12) + "px";

        document.body.appendChild(piece);

        setTimeout(() => piece.remove(), 6000);
    }
}

function showFinalPopup() {
    show("finalPopup");

    const popup = $("finalPopup");

    popup.classList.remove("shake");
    void popup.offsetWidth;
    popup.classList.add("shake");

    launchConfetti();
}
function readyForFinal() {
    socket.emit("final:ready");
    $("finalReadyButton").disabled = true;
    $("finalPopup").querySelector("p").textContent =
        "You're ready! Waiting for the other player...";
}
socket.on("final:ready-state", ({ ready }) => {
    const myIndex = isHost ? 0 : 1;
    const opponentIndex = 1 - myIndex;

    if (ready[myIndex]) {
        $("finalReadyButton").disabled = true;
        $("finalPopup").querySelector("p").textContent =
            ready[opponentIndex]
                ? "Both players are ready!"
                : "You're ready! Waiting for the other player...";
    }
});

socket.on("final:begin", ({ difficulty }) => {
    hide("finalPopup");
    hide("questions");
    show("finalGuess");

    $("finalReadyButton").disabled = false;
    $("finalAnswerInput").disabled = false;
    $("finalSubmitButton").disabled = false;
    $("finalGuessStatus").textContent = "";

    if (difficulty === "easy") {
        $("guessInstructions").textContent =
            "EASY MODE: Enter ONE word. No spaces. Capitalize normally.";
        $("finalAnswerInput").placeholder = "One word...";
    } else {
        $("guessInstructions").textContent =
            "HARD MODE: Enter the full phrase. Include spaces and use normal capitalization.";
        $("finalAnswerInput").placeholder = "Enter the full phrase...";
    }
});

function submitFinalGuess() {
    const guess = $("finalAnswerInput").value.trim();

    if (!guess) {
        $("finalGuessStatus").textContent = "Enter your guess first.";
        return;
    }

    socket.emit("final:submit", guess);
    $("finalAnswerInput").disabled = true;
    $("finalSubmitButton").disabled = true;
    $("finalGuessStatus").textContent =
        "Guess locked. Waiting for the other player...";
}

socket.on("final:guess-progress", ({ submitted }) => {
    const myIndex = isHost ? 0 : 1;
    const opponentIndex = 1 - myIndex;

    if (submitted[myIndex]) {
        $("finalGuessStatus").textContent = submitted[opponentIndex]
            ? "Both guesses are locked. Revealing results..."
            : "Your guess is locked. Waiting for the other player...";
    }
});
socket.on("final:results", ({ results, duration }) => {
    hide("finalGuess");
    hide("finalPopup");
    hide("questions");
    show("scoreboard");

    const correctCount = results.filter(player => player.correct).length;

    if (correctCount === 2) {
        $("scoreboardTitle").textContent = "EVERYONE GOT IT!";
    } else if (correctCount === 1) {
        $("scoreboardTitle").textContent = "ONE VICTOR!";
    } else {
        $("scoreboardTitle").textContent = "NOBODY GOT IT!";
    }

    $("scoreboardResults").innerHTML = "";

    results.forEach(player => {
    const card = document.createElement("div");
    card.className = `score-result ${player.correct ? "correct" : "incorrect"}`;

    const heading = document.createElement("h3");
    heading.textContent = `${player.name} ${player.correct ? "✓" : "✗"}`;

    const guess = document.createElement("p");
    guess.textContent = `Guess: ${player.guess}`;

    const target = document.createElement("p");
    target.textContent = `Target: ${player.targetTopic}`;

    const resultText = document.createElement("strong");
    resultText.textContent = player.correct ? "CORRECT!" : "INCORRECT";

    card.append(heading, guess, target, resultText);
    $("scoreboardResults").appendChild(card);
});

    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;

    $("gameDuration").textContent =
        `Game duration: ${minutes}m ${seconds.toString().padStart(2, "0")}s`;
});
function playAgain() {
    $("rematchStatus").textContent = "Sending rematch vote...";
    socket.emit("game:again");
}
socket.on("game:again-progress", ({ votes }) => {
    const myIndex = isHost ? 0 : 1;
    const opponentIndex = 1 - myIndex;

    if (votes[myIndex]) {
        $("rematchStatus").textContent = votes[opponentIndex]
            ? "Both players voted. Resetting lobby..."
            : "You voted to play again. Waiting for your opponent...";
    }
});

socket.on("game:again-ready", () => {
    $("chatHistory").innerHTML = "";
$("questionCount").textContent = "0 / 10";
    gameStarted = false;
    assignedTopic = null;
    wheelFinished = false;

    hide("scoreboard");
    hide("finalGuess");
    hide("finalPopup");
    hide("questions");
    hide("game");

    show("lobby");
    show("readyButton");
    hide("hostControls");

    $("finalReadyButton").disabled = false;
    $("finalAnswerInput").disabled = false;
    $("finalSubmitButton").disabled = false;
    $("finalAnswerInput").value = "";

    $("rematchStatus").textContent = "";
    $("scoreboardResults").textContent = "";
    $("gameDuration").textContent = "";

    setStatus("Both players agreed! Ready for another game.");
});
function returnToMenu() {
    socket.emit("lobby:leave");

    gameStarted = false;
    assignedTopic = null;
    wheelFinished = false;
    isHost = false;
    selectedDifficulty = "easy";

    hide("lobby");
    hide("game");
    hide("questions");
    hide("finalPopup");
    hide("finalGuess");
    hide("scoreboard");

    show("home");

    $("status").textContent = "";
    $("rematchStatus").textContent = "";
}
function setupChatEnterKey() {
    $("questionInput").addEventListener("keydown", event => {
        if (event.key === "Enter") {
            event.preventDefault();
            submitQuestion();
        }
    });

    $("answerInput").addEventListener("keydown", event => {
        if (event.key === "Enter") {
            event.preventDefault();
            submitAnswer();
        }
    });
}

setupChatEnterKey();