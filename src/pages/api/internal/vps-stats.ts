import type { APIRoute } from 'astro';
import os from 'node:os';
import fs from 'node:fs';

let lastNetRead = {
  time: Date.now(),
  bytes: 0,
};

function getNetworkBytes() {
  try {
    const data = fs.readFileSync('/proc/net/dev', 'utf8');
    const lines = data.split('\n');
    let totalBytes = 0;
    for (const line of lines) {
      if (line.includes('eth0') || line.includes('enp') || line.includes('venet')) {
        const parts = line.trim().split(/\s+/);
        // Index 9 is transmit bytes in /proc/net/dev
        const txBytes = Number.parseInt(parts[9], 10);
        if (!Number.isNaN(txBytes)) {
          totalBytes += txBytes;
        }
      }
    }
    return totalBytes;
  } catch {
    return 0;
  }
}

// Initial read
lastNetRead.bytes = getNetworkBytes();

export const GET: APIRoute = async () => {
  const currentBytes = getNetworkBytes();
  const currentTime = Date.now();

  const deltaBytes = currentBytes - lastNetRead.bytes;
  const deltaTime = (currentTime - lastNetRead.time) / 1000;

  // Mbps calculation
  const bps = deltaTime > 0 ? (deltaBytes * 8) / deltaTime : 0;
  const mbps = bps / 1_000_000;

  lastNetRead = { time: currentTime, bytes: currentBytes };

  const load = os.loadavg()[0]; // 1 min load average
  const cpus = os.cpus().length;
  const cpuPercent = (load / cpus) * 100;

  return new Response(
    JSON.stringify({
      serverIp: '46.225.154.68', // Added to identify current server
      cpu: {
        load: load.toFixed(2),
        percent: cpuPercent.toFixed(0),
        cores: cpus,
      },
      bandwidth: {
        mbps: mbps.toFixed(1),
        totalTxGb: (currentBytes / 1_073_741_824).toFixed(2),
      },
      timestamp: new Date().toISOString(),
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    },
  );
};
