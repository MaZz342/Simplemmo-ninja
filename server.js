require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const { startBrowser } = require('./browser');
const { startBotLoop, stopBotLoop } = require('./bot-logic');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let currentPage = null;
let botRunning = false;   // ← dit ontbrak → dit lost de ReferenceError op

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

io.on('connection', (socket) => {
    console.log('Dashboard verbonden');

    socket.on('start-browser', async () => {
        try {
            currentPage = await startBrowser(socket);
            socket.emit('browser-ready');
            socket.emit('bot-log', 'Browser geopend. Log in op SimpleMMO.');
        } catch (err) {
            socket.emit('bot-log', 'Fout bij openen browser: ' + err.message);
        }
    });

    socket.on('toggle-bot', (settings) => {
        if (!currentPage) {
            socket.emit('bot-log', '⚠️ Eerst de browser openen en inloggen!');
            return;
        }

        if (botRunning) {
            // Stop de bot
            stopBotLoop();
            botRunning = false;
            socket.emit('status', false);
            socket.emit('bot-log', '🛑 Bot gestopt');
        } else {
            // Start de bot
            startBotLoop(socket, currentPage, settings, { steps: 0, items: 0 });
            botRunning = true;
            socket.emit('status', true);
            socket.emit('bot-log', '🚀 Bot gestart');
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`SMMO Bot draait op http://localhost:${PORT}`);
});